// Run orchestrator (Build Plan M1 · two-phase M2.5 — the generation engine).
//
// Two phases, gated on human approval so we never spend motion credits on a
// style Scott doesn't like:
//   Phase 1 — runWeek():   generate cheap Seedream STILLS (3 options/surface),
//                          each with its proposed Seedance motion prompt.
//   Phase 2 — animateRun(): for stills the reviewer APPROVED, run Seedance
//                          image-to-video off the still, then conform / slice.
//
// The guardrail runs BEFORE each provider call — before the still spend in
// Phase 1, and (the expensive one) before the motion spend in Phase 2.
//
// Every dependency is injected (repo, store, providers, guardrails) so the
// whole pipeline is unit-testable end-to-end on fixtures — no Postgres, no AWS,
// no spend.

import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';

import config from '../config/index.js';
import logger from '../config/logger.js';
import ffmpeg from './ffmpeg.js';
import { sliceMaster } from './eonSlicer.js';
import * as guardrailsModule from './guardrails.js';
import * as qaModule from './qa.js';
import { planJobs, POST, SURFACES, SPECS } from './generation/catalog.js';
import { buildStillPrompt, buildMotionPrompt } from './generation/prompts.js';
import { getProviders } from './generation/index.js';
import { getStore, artworkKey } from './storage/index.js';
import { getRepo } from '../db/index.js';
import { weekOfFor } from './dates.js';

const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
const thumbDims = (spec) => ({ width: even(spec.width / 2), height: even(spec.height / 2) });

function resolveDeps(deps) {
  return {
    repo: deps.repo || getRepo(),
    guardrails: deps.guardrails || guardrailsModule,
    qa: deps.qa || qaModule,
    duration: deps.duration ?? config.generation.durationS,
    fps: deps.fps ?? config.generation.fps,
  };
}

// ===========================================================================
// PHASE 1 — stills (style review)
// ===========================================================================

/**
 * Generate the week's still options (Phase 1). Cheap; nothing is animated yet.
 * @returns {Promise<{ runId, phase, status, weekOf, counts, artworks }>}
 */
export async function runWeek({ weekOf, triggeredBy = 'manual', onStart, deps = {} } = {}) {
  const { repo, guardrails, qa, duration, fps } = resolveDeps(deps);
  const store = deps.store || (await getStore());
  const providers = deps.providers || getProviders();
  const week = weekOf || weekOfFor();
  const jobs = planJobs({ surfaces: deps.surfaces, optionsPerSurface: deps.optionsPerSurface });

  const run = await repo.createRun({ weekOf: week, triggeredBy, status: 'running' });
  await onStart?.(run);
  logger.info({ runId: run.id, weekOf: week, options: jobs.length, mode: providers.mode || config.generationMode }, 'Phase 1 (stills) started');

  const workDir = deps.workDir || (await mkdtemp(path.join(os.tmpdir(), `wae-still-${run.id}-`)));
  const counts = { ready: 0, failed: 0, blocked: 0 };
  try {
    for (const job of jobs) {
      const r = await generateStill(job, { runId: run.id, weekOf: week, repo, store, providers, guardrails, qa, workDir });
      counts.ready += r.ready; counts.failed += r.failed; counts.blocked += r.blocked;
    }
    const status = counts.ready === 0 && counts.failed + counts.blocked > 0 ? 'failed' : 'complete';
    await repo.setRunStatus(run.id, status);
    logger.info({ runId: run.id, status, counts }, 'Phase 1 (stills) finished');
    return { runId: run.id, phase: 'stills', status, weekOf: week, counts, artworks: await repo.listArtworks(run.id) };
  } catch (err) {
    await repo.setRunStatus(run.id, 'failed', err.message);
    logger.error({ runId: run.id, err: err.message }, 'Phase 1 crashed');
    throw err;
  } finally {
    if (!deps.workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function generateStill(job, ctx) {
  const { runId, weekOf, repo, store, providers, guardrails, qa, workDir } = ctx;
  const prompt = buildStillPrompt({ style: job.style, specKey: job.specKey, option: job.option, weekOf });
  const motionPrompt = buildMotionPrompt({ style: job.style, specKey: job.specKey, option: job.option, weekOf });

  // Guardrail BEFORE the (cheap) still spend.
  const check = guardrails.checkPrompt(prompt);
  if (!check.allowed) {
    const reason = `guardrail: ${check.reasons.join('; ')}`;
    await repo.insertArtwork({
      runId, surface: job.surface, style: job.style, mediaType: 'still', stage: 'still',
      specKey: job.specKey, width: job.spec.width, height: job.spec.height,
      prompt, motionPrompt, status: 'failed', error: reason,
    });
    logger.warn({ runId, surface: job.key, option: job.option, reason }, 'Still prompt blocked before spend');
    return { ready: 0, failed: 0, blocked: 1 };
  }

  try {
    const dir = path.join(workDir, `${job.key}_opt${job.option}`);
    await mkdir(dir, { recursive: true });
    const stillPath = path.join(dir, 'still.png');
    const gen = await providers.still.generate({
      width: job.gen.width, height: job.gen.height, ratio: job.gen.ratio, output: stillPath, prompt,
    });
    const key = artworkKey({ runId, surfaceKey: job.key, option: job.option, name: 'still.png' });
    const put = await store.put({ key, sourcePath: stillPath });

    // QA gate BEFORE review: outdoor readability (art review 2026-07-10). The
    // file is stored either way so a failed card can still show what happened.
    const gate = await qa.lumaGate(stillPath);
    if (!gate.ok) {
      await repo.insertArtwork({
        runId, surface: job.surface, style: job.style, mediaType: 'still', stage: 'still',
        specKey: job.specKey, width: job.gen.width, height: job.gen.height,
        prompt, motionPrompt, model: gen.model, remoteUrl: gen.url ?? null,
        s3KeyFinal: put.key, thumbnailKey: put.key,
        status: 'failed', error: `qa: ${gate.reason}`,
      });
      logger.warn({ runId, surface: job.key, option: job.option, yavg: gate.yavg }, 'Still failed luma QA gate');
      return { ready: 0, failed: 1, blocked: 0 };
    }

    await repo.insertArtwork({
      runId, surface: job.surface, style: job.style, mediaType: 'still', stage: 'still',
      specKey: job.specKey, width: job.gen.width, height: job.gen.height,
      prompt, motionPrompt, model: gen.model,
      // Live providers return the fal-hosted URL; Phase 2 hands it to Seedance
      // as the image-to-video first frame (fixture mode has no URL).
      remoteUrl: gen.url ?? null,
      s3KeyFinal: put.key, thumbnailKey: put.key, status: 'ready',
      // Borderline-dark scenes reach review with an amber note (emissive LED
      // signs handle dark backgrounds; the reviewer decides).
      error: gate.warn ? `qa: ${gate.reason}` : null,
    });
    return { ready: 1, failed: 0, blocked: 0 };
  } catch (err) {
    logger.error({ runId, surface: job.key, option: job.option, err: err.message }, 'Still generation failed');
    await repo.insertArtwork({
      runId, surface: job.surface, style: job.style, mediaType: 'still', stage: 'still',
      specKey: job.specKey, width: job.spec.width, height: job.spec.height,
      prompt, motionPrompt, status: 'failed', error: err.message,
    });
    return { ready: 0, failed: 1, blocked: 0 };
  }
}

// ===========================================================================
// PHASE 2 — animate approved stills
// ===========================================================================

/**
 * Animate the run's APPROVED stills (Phase 2). By default only approved,
 * not-yet-animated, non-errored stills are processed (safe to call repeatedly).
 * Pass `stillIds` to explicitly (re-)animate specific stills — that bypasses
 * both the already-animated and the error skip (the retry path).
 * @returns {Promise<{ runId, phase, status, animated, counts, artworks }>}
 */
export async function animateRun({ runId, stillIds, triggeredBy = 'dashboard', onStart, deps = {} } = {}) {
  const { repo, guardrails, qa, duration, fps } = resolveDeps(deps);
  const store = deps.store || (await getStore());
  const providers = deps.providers || getProviders();

  const run = await repo.getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  // Mark running BEFORE responding to the route, so the dashboard reliably sees
  // status='running' on its immediate reload and starts polling (otherwise it
  // can read the stale 'complete' from Phase 1 and never poll — the UI looks
  // frozen while videos are actually being made).
  await repo.setRunStatus(runId, 'running');
  await onStart?.(run);

  const artworks = await repo.listArtworks(runId);
  const animatedStillIds = new Set(artworks.map((a) => a.source_still_id).filter(Boolean));
  const targeted = stillIds ? new Set(stillIds) : null;
  const toAnimate = artworks.filter((a) => {
    if (a.stage !== 'still' || a.status !== 'approved') return false;
    if (targeted) return targeted.has(a.id);
    // Bulk mode: skip already-animated stills AND ones whose last attempt
    // errored (e.g. a moderation refusal) — those need an explicit retry, not
    // a silent re-spend (UX review P0). "qa:"-prefixed notes are advisory
    // warnings (e.g. dark-scene), not failures — they don't block.
    const hardError = a.error && !a.error.startsWith('qa:');
    return !animatedStillIds.has(a.id) && !hardError;
  });
  logger.info({ runId, approved: toAnimate.length, targeted: Boolean(targeted), mode: providers.mode || config.generationMode }, 'Phase 2 (animate) started');

  const workDir = deps.workDir || (await mkdtemp(path.join(os.tmpdir(), `wae-motion-${runId}-`)));
  const counts = { ready: 0, failed: 0, blocked: 0 };
  try {
    for (const still of toAnimate) {
      // Guardrail BEFORE the expensive motion spend.
      const check = guardrails.checkPrompt(still.motion_prompt || '');
      if (!check.allowed) {
        await repo.updateArtwork(still.id, { error: `motion guardrail: ${check.reasons.join('; ')}` });
        counts.blocked += 1;
        continue;
      }
      try {
        counts.ready += await animateStill(still, { runId, repo, store, providers, qa, duration, fps, workDir });
        if (still.error) await repo.updateArtwork(still.id, { error: null }); // clear a stale retry error
      } catch (err) {
        logger.error({ runId, stillId: still.id, err: err.message }, 'Animation failed');
        await repo.updateArtwork(still.id, { error: err.message });
        counts.failed += 1;
      }
    }
    await repo.setRunStatus(runId, 'complete');
    logger.info({ runId, counts }, 'Phase 2 (animate) finished');
    return { runId, phase: 'motion', status: 'complete', animated: counts.ready, counts, artworks: await repo.listArtworks(runId) };
  } catch (err) {
    await repo.setRunStatus(runId, 'failed', err.message);
    throw err;
  } finally {
    if (!deps.workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Animate one approved still into its motion deliverable(s). Returns the number
// of motion artworks created (3 for an EON connected set, else 1).
async function animateStill(still, ctx) {
  const { runId, repo, store, providers, qa, duration, fps, workDir } = ctx;
  const surface = SURFACES.find((s) => s.style === still.style);
  if (!surface) throw new Error(`No surface for style "${still.style}"`);
  const finalSpec = SPECS[surface.specKey];

  const dir = path.join(workDir, `still${still.id}`);
  await mkdir(dir, { recursive: true });

  // Materialize the approved still as the first-frame reference (works for
  // local or S3 stores).
  const ref = path.join(dir, 'ref.png');
  await writeFile(ref, await store.getBuffer(still.s3_key_final));

  const raw = path.join(dir, 'raw.mp4');
  const gen = await providers.motion.generate({
    width: surface.gen.width, height: surface.gen.height, ratio: surface.gen.ratio,
    durationS: duration, fps, output: raw, prompt: still.motion_prompt,
    referenceImage: ref,                       // local file — fixture mode
    referenceImageUrl: still.remote_url ?? null, // fal-hosted URL — live Seedance
  });

  // Video models return their own frame shape (e.g. a 960x960 square) with the
  // input art letterboxed/extended inside. The TRUE content aspect is known —
  // it's the approved still's — so recover it deterministically: center-crop
  // the model output to the still's aspect ratio (no fragile bar detection).
  let content = raw;
  if (!String(gen.model || '').startsWith('fixture') && still.width && still.height) {
    try {
      const rawDims = await ffmpeg.probe(raw);
      const want = still.width / still.height;
      const got = rawDims.width / rawDims.height;
      if (rawDims.width && Math.abs(got - want) / want > 0.03) {
        const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
        let cw = rawDims.width;
        let ch = rawDims.height;
        if (got > want) cw = even(rawDims.height * want);
        else ch = even(rawDims.width / want);
        const cx = even((rawDims.width - cw) / 2);
        const cy = even((rawDims.height - ch) / 2);
        content = path.join(dir, 'content.mp4');
        await ffmpeg.cropColumn({ input: raw, output: content, width: cw, height: ch, x: cx, y: cy });
        logger.info({ stillId: still.id, raw: `${rawDims.width}x${rawDims.height}`, content: `${cw}x${ch}@${cx},${cy}` }, 'Recovered content band from model output');
      }
    } catch (err) {
      logger.warn({ stillId: still.id, err: err.message }, 'Content recovery failed; using raw output');
    }
  }

  // QA: measure saturation drift on the model's raw output (Seedance colors
  // drain over a clip). Warning only — stored on the motion rows.
  let driftWarn;
  try {
    const drift = await qa.satDrift(raw);
    if (drift.warn) driftWarn = `qa: ${drift.reason}`;
  } catch { /* QA measurement is best-effort; never fail the render on it */ }

  // Ambient surfaces get a palindrome pass so the clip loops seamlessly on the
  // sign (art review: mismatched endpoints pop every cycle). Doubles duration.
  let srcVideo = content;
  let effDuration = duration;
  if (surface.loop === 'pingpong') {
    srcVideo = path.join(dir, 'raw_loop.mp4');
    await ffmpeg.pingpong({ input: content, output: srcVideo });
    effDuration = duration * 2;
  }

  const keyBase = `runs/${runId}/motion/still${still.id}`;
  const key = (name) => `${keyBase}/${name}`;
  const rawPut = await store.put({ key: key('raw.mp4'), sourcePath: raw });

  const insertMotion = (extra) => repo.insertArtwork({
    runId, surface: surface.surface, style: surface.style, mediaType: 'video', stage: 'motion',
    sourceStillId: still.id, prompt: still.prompt, motionPrompt: still.motion_prompt, model: gen.model,
    s3KeyRaw: rawPut.key, error: driftWarn ?? null, ...extra,
  });

  if (surface.post === POST.EON_SLICE) {
    const master = path.join(dir, 'master.mp4');
    await ffmpeg.conform({ input: srcVideo, output: master, width: finalSpec.width, height: finalSpec.height, duration: effDuration, fps });
    const masterPut = await store.put({ key: key('master.mp4'), sourcePath: master });
    const faces = await sliceMaster({ masterPath: master, outDir: dir, duration: effDuration });

    const faceIds = [];
    for (const face of faces) {
      const td = thumbDims({ width: 256, height: 384 });
      const thumb = path.join(dir, `pod${face.pod}_thumb.jpg`);
      await ffmpeg.thumbnail({ input: face.path, output: thumb, width: td.width, height: td.height, atSeconds: Math.min(2, effDuration / 2) });
      const facePut = await store.put({ key: key(`pod${face.pod}.mp4`), sourcePath: face.path });
      const thumbPut = await store.put({ key: key(`pod${face.pod}_thumb.jpg`), sourcePath: thumb });
      const probed = await ffmpeg.probe(face.path);
      const a = await insertMotion({
        specKey: 'eon_face', width: face.width, height: face.height,
        durationS: Math.round(probed.duration ?? effDuration),
        s3KeyFinal: facePut.key, thumbnailKey: thumbPut.key, status: 'ready',
      });
      faceIds.push(a.id);
    }
    await repo.insertEonSequence({
      runId, masterS3Key: masterPut.key,
      face1ArtworkId: faceIds[0], face2ArtworkId: faceIds[1], face3ArtworkId: faceIds[2],
    });
    return 3;
  }

  // Spectacular (frame-break) and EON single: one motion artwork.
  const final = path.join(dir, 'final.mp4');
  if (surface.post === POST.FRAME_BREAK) {
    // Conform the content to the inner window FIRST (cover-crop), then draw
    // the black canvas + border around it. The old blind overshoot geometry
    // assumed a known input aspect and showed letterbox when the model
    // returned something else. True pop-out matting = Batch B.
    const inset = 48;
    const inner = path.join(dir, 'inner.mp4');
    await ffmpeg.conform({
      input: srcVideo, output: inner,
      width: finalSpec.width - inset * 2, height: finalSpec.height - inset * 2,
      duration: effDuration, fps,
    });
    await ffmpeg.frameBreakComposite({
      input: inner, output: final, canvasWidth: finalSpec.width, canvasHeight: finalSpec.height,
      inset, borderThickness: 5, overshoot: 0, duration: effDuration, fps,
    });
  } else {
    await ffmpeg.conform({ input: srcVideo, output: final, width: finalSpec.width, height: finalSpec.height, duration: effDuration, fps });
  }
  const td = thumbDims(finalSpec);
  const thumb = path.join(dir, 'thumb.jpg');
  await ffmpeg.thumbnail({ input: final, output: thumb, width: td.width, height: td.height, atSeconds: Math.min(2, effDuration / 2) });
  const finalPut = await store.put({ key: key('final.mp4'), sourcePath: final });
  const thumbPut = await store.put({ key: key('thumb.jpg'), sourcePath: thumb });
  const probed = await ffmpeg.probe(final);
  await insertMotion({
    specKey: surface.specKey, width: finalSpec.width, height: finalSpec.height,
    durationS: Math.round(probed.duration ?? effDuration),
    s3KeyFinal: finalPut.key, thumbnailKey: thumbPut.key, status: 'ready',
  });
  return 1;
}

export default { runWeek, animateRun };
