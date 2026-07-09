// Run orchestrator (Build Plan M1 — the generation engine).
//
// Fans out `optionsPerSurface` (locked: 3) options for every surface in the
// catalog, tracks status in `generation_runs` / `artworks`, and writes every
// generated + conformed asset to the store. The guardrail runs BEFORE the
// provider is ever called, so a blocked prompt never spends a credit
// ("guardrail-before-spend").
//
// Every external dependency is injected (repo, store, providers, guardrails)
// so the whole pipeline is unit-testable end-to-end on fixtures with an
// in-memory repo and a temp local store — no Postgres, no AWS, no spend.

import path from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';

import config from '../config/index.js';
import logger from '../config/logger.js';
import ffmpeg from './ffmpeg.js';
import { sliceMaster } from './eonSlicer.js';
import * as guardrailsModule from './guardrails.js';
import { planJobs, POST } from './generation/catalog.js';
import { buildPrompt } from './generation/prompts.js';
import { getProviders } from './generation/index.js';
import { getStore, artworkKey } from './storage/index.js';
import { getRepo } from '../db/index.js';
import { weekOfFor } from './dates.js';

const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
const thumbDims = (spec) => ({ width: even(spec.width / 2), height: even(spec.height / 2) });

/**
 * Run one weekly generation batch.
 * @param {object} opts
 * @param {string} [opts.weekOf]       YYYY-MM-DD (defaults to this week's Monday)
 * @param {string} [opts.triggeredBy]  "cron" | user email
 * @param {(run) => void} [opts.onStart] called with the run row once created
 *                                       (lets a route respond before work finishes)
 * @param {object} [opts.deps]         { repo, store, providers, guardrails, surfaces, optionsPerSurface, duration, fps }
 * @returns {Promise<{ runId, status, weekOf, counts, artworks }>}
 */
export async function runWeek({ weekOf, triggeredBy = 'manual', onStart, deps = {} } = {}) {
  const repo = deps.repo || getRepo();
  const store = deps.store || (await getStore());
  const providers = deps.providers || getProviders();
  const guardrails = deps.guardrails || guardrailsModule;
  const duration = deps.duration ?? config.generation.durationS;
  const fps = deps.fps ?? config.generation.fps;
  const week = weekOf || weekOfFor();

  const jobs = planJobs({
    surfaces: deps.surfaces,
    optionsPerSurface: deps.optionsPerSurface,
  });

  const run = await repo.createRun({ weekOf: week, triggeredBy, status: 'running' });
  await onStart?.(run);
  logger.info(
    { runId: run.id, weekOf: week, jobs: jobs.length, mode: providers.mode || config.generationMode },
    'Weekly generation run started',
  );

  const workDir = deps.workDir || (await mkdtemp(path.join(os.tmpdir(), `wae-run-${run.id}-`)));
  const counts = { ready: 0, failed: 0, blocked: 0 };

  try {
    for (const job of jobs) {
      const result = await processJob(job, {
        runId: run.id, weekOf: week,
        repo, store, providers, guardrails, duration, fps, workDir,
      });
      counts.ready += result.ready;
      counts.failed += result.failed;
      counts.blocked += result.blocked;
    }

    // A run is "failed" only if it produced nothing usable; otherwise complete.
    const status = counts.ready === 0 && (counts.failed + counts.blocked) > 0 ? 'failed' : 'complete';
    await repo.setRunStatus(run.id, status);
    logger.info({ runId: run.id, status, counts }, 'Weekly generation run finished');

    const artworks = await repo.listArtworks(run.id);
    return { runId: run.id, status, weekOf: week, counts, artworks };
  } catch (err) {
    await repo.setRunStatus(run.id, 'failed', err.message);
    logger.error({ runId: run.id, err: err.message }, 'Weekly generation run crashed');
    throw err;
  } finally {
    if (!deps.workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Process a single surface/option job. Returns per-job tallies.
async function processJob(job, ctx) {
  const { runId, repo, store, providers, guardrails } = ctx;
  const prompt = buildPrompt({ style: job.style, specKey: job.specKey, option: job.option, weekOf: ctx.weekOf });

  // --- Guardrail BEFORE spend --------------------------------------------
  const check = guardrails.checkPrompt(prompt);
  if (!check.allowed) {
    const reason = `guardrail: ${check.reasons.join('; ')}`;
    await repo.insertArtwork({
      runId, surface: job.surface, style: job.style, mediaType: job.mediaType,
      specKey: job.specKey, width: job.spec.width, height: job.spec.height,
      prompt, status: 'failed', error: reason,
    });
    logger.warn({ runId, surface: job.key, option: job.option, reason }, 'Prompt blocked before spend');
    return { ready: 0, failed: 0, blocked: 1 };
  }

  try {
    if (job.post === POST.EON_SLICE) {
      await processEonConnected(job, ctx, prompt);
      return { ready: 3, failed: 0, blocked: 0 };
    }
    await processSingle(job, ctx, prompt);
    return { ready: 1, failed: 0, blocked: 0 };
  } catch (err) {
    logger.error({ runId, surface: job.key, option: job.option, err: err.message }, 'Job failed');
    await repo.insertArtwork({
      runId, surface: job.surface, style: job.style, mediaType: job.mediaType,
      specKey: job.specKey, width: job.spec.width, height: job.spec.height,
      prompt, status: 'failed', error: err.message,
    });
    return { ready: 0, failed: 1, blocked: 0 };
  }
}

// Spectacular (frame-break) and EON single: one artwork, generate → conform → thumb.
async function processSingle(job, ctx, prompt) {
  const { runId, repo, store, providers, guardrails, duration, fps, workDir } = ctx;
  const dir = path.join(workDir, `${job.key}_opt${job.option}`);
  await mkdir(dir, { recursive: true });

  // Insert as generating so status transitions are observable.
  const artwork = await repo.insertArtwork({
    runId, surface: job.surface, style: job.style, mediaType: job.mediaType,
    specKey: job.specKey, prompt, status: 'generating',
  });

  const raw = path.join(dir, 'raw.mp4');
  const gen = await generate(job, { providers, duration, fps, output: raw, prompt });

  const final = path.join(dir, 'final.mp4');
  if (job.post === POST.FRAME_BREAK) {
    await ffmpeg.frameBreakComposite({
      input: raw, output: final,
      canvasWidth: job.spec.width, canvasHeight: job.spec.height,
      inset: 48, borderThickness: 5, overshoot: 70, duration, fps,
    });
  } else {
    await ffmpeg.conform({
      input: raw, output: final,
      width: job.spec.width, height: job.spec.height, duration, fps,
    });
  }

  const td = thumbDims(job.spec);
  const thumb = path.join(dir, 'thumb.jpg');
  await ffmpeg.thumbnail({ input: final, output: thumb, width: td.width, height: td.height, atSeconds: Math.min(2, duration / 2) });

  // Post-generation guardrail hook (pass-through in fixture mode).
  const review = await guardrails.reviewArtwork({ path: final, specKey: job.specKey });
  if (!review.allowed) throw new Error(`guardrail (post-gen): ${review.reasons.join('; ')}`);

  const key = (name) => artworkKey({ runId, surfaceKey: job.key, option: job.option, name });
  const rawPut = await store.put({ key: key('raw.mp4'), sourcePath: raw });
  const finalPut = await store.put({ key: key('final.mp4'), sourcePath: final });
  const thumbPut = await store.put({ key: key('thumb.jpg'), sourcePath: thumb });

  const probed = await ffmpeg.probe(final);
  await repo.updateArtwork(artwork.id, {
    width: job.spec.width, height: job.spec.height,
    durationS: Math.round(probed.duration ?? duration),
    model: gen.model, s3KeyRaw: rawPut.key, s3KeyFinal: finalPut.key,
    thumbnailKey: thumbPut.key, status: 'ready',
  });
}

// EON connected: one 768x384 master → three 256x384 faces + an eon_sequence.
async function processEonConnected(job, ctx, prompt) {
  const { runId, repo, store, providers, duration, fps, workDir } = ctx;
  const dir = path.join(workDir, `${job.key}_opt${job.option}`);
  await mkdir(dir, { recursive: true });

  const rawMaster = path.join(dir, 'master_raw.mp4');
  const gen = await generate(job, { providers, duration, fps, output: rawMaster, prompt });

  const master = path.join(dir, 'master.mp4');
  await ffmpeg.conform({
    input: rawMaster, output: master,
    width: job.spec.width, height: job.spec.height, duration, fps,
  });

  const faces = await sliceMaster({ masterPath: master, outDir: dir, duration });

  const key = (name) => artworkKey({ runId, surfaceKey: job.key, option: job.option, name });
  const rawMasterPut = await store.put({ key: key('master_raw.mp4'), sourcePath: rawMaster });
  const masterPut = await store.put({ key: key('master.mp4'), sourcePath: master });

  const faceArtworkIds = [];
  for (const face of faces) {
    const td = thumbDims({ width: 256, height: 384 });
    const thumb = path.join(dir, `pod${face.pod}_thumb.jpg`);
    await ffmpeg.thumbnail({ input: face.path, output: thumb, width: td.width, height: td.height, atSeconds: Math.min(2, duration / 2) });

    const facePut = await store.put({ key: key(`pod${face.pod}.mp4`), sourcePath: face.path });
    const thumbPut = await store.put({ key: key(`pod${face.pod}_thumb.jpg`), sourcePath: thumb });
    const probed = await ffmpeg.probe(face.path);

    const artwork = await repo.insertArtwork({
      runId, surface: 'eon', style: 'eon_connected', mediaType: 'video',
      specKey: 'eon_face', width: face.width, height: face.height,
      durationS: Math.round(probed.duration ?? duration),
      prompt, model: gen.model,
      s3KeyRaw: rawMasterPut.key, s3KeyFinal: facePut.key, thumbnailKey: thumbPut.key,
      status: 'ready',
    });
    faceArtworkIds.push(artwork.id);
  }

  await repo.insertEonSequence({
    runId, masterS3Key: masterPut.key,
    face1ArtworkId: faceArtworkIds[0], face2ArtworkId: faceArtworkIds[1], face3ArtworkId: faceArtworkIds[2],
  });
}

// Dispatch to the right provider. Fixture uses width/height; the live fal
// provider uses `ratio` — we pass both so either resolves what it needs.
async function generate(job, { providers, duration, fps, output, prompt }) {
  if (job.gen.kind === 'still') {
    return providers.still.generate({ width: job.gen.width, height: job.gen.height, output, prompt });
  }
  return providers.motion.generate({
    width: job.gen.width, height: job.gen.height, ratio: job.gen.ratio,
    durationS: duration, fps, output, prompt,
  });
}

export default { runWeek };
