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
import { buildStillPrompt, buildMotionPrompt, sanitizeMotionPrompt } from './generation/prompts.js';
import { refineTweak } from './generation/tweak.js';
import { resolveDesign } from './keeper.js';
import falPricing from './generation/falPricing.js';
import { getProviders } from './generation/index.js';
import { getStore, artworkKey } from './storage/index.js';
import { getRepo } from '../db/index.js';
import { weekOfFor } from './dates.js';

// Ceiling on one "Add another design" click. Each still is a real (small)
// spend, so the button can't be turned into an unbounded batch by a stray
// payload — the reviewer clicks again if they want more.
const MAX_ADD_AT_ONCE = 3;

const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
const thumbDims = (spec) => ({ width: even(spec.width / 2), height: even(spec.height / 2) });

// Review-grid preview size. Nothing on the dashboard renders a design wider
// than ~1400 CSS px, so a 4096px master is ~50x more bytes than the screen can
// use. Caps the long edge and keeps the aspect exactly.
const PREVIEW_MAX_EDGE = 1280;
function previewDims(width, height, maxEdge = PREVIEW_MAX_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: even(width * scale), height: even(height * scale) };
}

/**
 * Divide ONE fal bill across the rows it produced, weighted (EON panels are
 * weighted by width — a face is 4x a spine). The last row absorbs the rounding
 * remainder so the per-row ledger sums to exactly `total`, which is what
 * spend.js re-adds when it prices a call from its rows. Pure.
 * @returns {number[]} one USD amount per weight, in order
 */
export function allocateCost(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const round = (n) => Math.round(n * 1e4) / 1e4;
  let spent = 0;
  return weights.map((w, i) => {
    const usd = i === weights.length - 1 ? round(total - spent) : round((total * w) / sum);
    spent += usd;
    return usd;
  });
}

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
    // Live progress for the dashboard ("Creating designs… 3/9").
    let done = 0;
    await repo.setRunProgress?.(run.id, { phase: 'designs', done, total: jobs.length });
    for (const job of jobs) {
      const r = await generateStill(job, { runId: run.id, weekOf: week, repo, store, providers, guardrails, qa, workDir });
      counts.ready += r.ready; counts.failed += r.failed; counts.blocked += r.blocked;
      done += 1;
      await repo.setRunProgress?.(run.id, { phase: 'designs', done, total: jobs.length });
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
  // promptSeed defaults to the week — regeneration salts it (see
  // regenerateStills) so fresh options don't repeat the retired designs.
  const seed = ctx.promptSeed || weekOf;
  // "Keep & explore" callers (varyStill/tweakStill) pass an explicit prompt to
  // re-run verbatim or after an LLM edit — use it as-is (skipping the template
  // rebuild) and still run the guardrail on it below. Lineage threads the family
  // links through to EVERY insert path (ready, qa-failed, blocked, error) so a
  // variation stays attached to its family even if it fails.
  const prompt = ctx.promptOverride ?? buildStillPrompt({ style: job.style, specKey: job.specKey, option: job.option, weekOf: seed });
  const motionPrompt = ctx.motionPromptOverride ?? buildMotionPrompt({ style: job.style, specKey: job.specKey, option: job.option, weekOf: seed });
  const lineage = {
    familyId: ctx.familyId ?? null,
    parentArtworkId: ctx.parentArtworkId ?? null,
    changeNote: ctx.changeNote ?? null,
  };

  // Guardrail BEFORE the (cheap) still spend.
  const check = guardrails.checkPrompt(prompt);
  if (!check.allowed) {
    const reason = `guardrail: ${check.reasons.join('; ')}`;
    await repo.insertArtwork({
      runId, surface: job.surface, style: job.style, mediaType: 'still', stage: 'still',
      specKey: job.specKey, width: job.spec.width, height: job.spec.height,
      prompt, motionPrompt, status: 'failed', error: reason, ...lineage,
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
    // Every generation gets its own file. Keying on (run, surface, option slot)
    // alone meant a variation, a re-roll or a per-design regenerate silently
    // overwrote the design it was spawned from — the kept "original" was still
    // a row, but its pixels had been replaced. The sequence is the count of
    // stills the run has already produced, so it is unique and monotonic
    // (generation is sequential) without needing the not-yet-assigned row id.
    const priorStills = (await repo.listArtworks(runId)).filter((a) => a.stage === 'still').length;
    const key = artworkKey({
      runId, surfaceKey: job.key, option: job.option, variant: `g${priorStills + 1}`, name: 'still.png',
    });
    const put = await store.put({ key, sourcePath: stillPath });

    // A REAL thumbnail. The design-review grid used to point at this key for
    // both the full image and the "thumbnail", so opening a week downloaded
    // nine 4K PNGs — measured at 2.4-4.8 MB each, ~30 MB before a single card
    // had pixels, and ~50 MB of decode memory apiece. That was the "slow and
    // laggy" complaint (perf audit, 2026-07-26). A JPEG capped at 1280 on the
    // long edge is ~45 KB — the same picture at review size, ~50x smaller.
    // Best-effort: if it fails, fall back to the master so a card is never blank.
    let thumbKey = put.key;
    try {
      const td = previewDims(job.gen.width, job.gen.height);
      const thumbPath = path.join(dir, 'still_thumb.jpg');
      await ffmpeg.thumbnail({ input: stillPath, output: thumbPath, width: td.width, height: td.height });
      const thumbPut = await store.put({
        key: artworkKey({ runId, surfaceKey: job.key, option: job.option, variant: `g${priorStills + 1}`, name: 'still_thumb.jpg' }),
        sourcePath: thumbPath,
      });
      thumbKey = thumbPut.key;
    } catch (err) {
      logger.warn({ runId, surface: job.key, err: err.message }, 'Still thumbnail failed; serving the full image');
    }

    // The Seedream image was billed the moment it generated ($0.03 flat), even
    // if it then fails QA — record the immutable cost. Fixtures are free.
    const stillLive = !String(gen.model || '').startsWith('fixture');
    const stillLedger = {
      falRequestId: stillLive ? gen.jobId ?? null : null,
      costUsd: stillLive ? falPricing.seedreamCostUsd({ count: 1 }) : 0,
    };

    // QA gate BEFORE review: outdoor readability (art review 2026-07-10). The
    // file is stored either way so a failed card can still show what happened.
    const gate = await qa.lumaGate(stillPath);
    if (!gate.ok) {
      await repo.insertArtwork({
        runId, surface: job.surface, style: job.style, mediaType: 'still', stage: 'still',
        specKey: job.specKey, width: job.gen.width, height: job.gen.height,
        prompt, motionPrompt, model: gen.model, remoteUrl: gen.url ?? null,
        s3KeyFinal: put.key, thumbnailKey: thumbKey,
        status: 'failed', error: `qa: ${gate.reason}`, ...stillLedger, ...lineage,
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
      s3KeyFinal: put.key, thumbnailKey: thumbKey, status: 'ready',
      // Borderline-dark scenes reach review with an amber note (emissive LED
      // signs handle dark backgrounds; the reviewer decides).
      error: gate.warn ? `qa: ${gate.reason}` : null, ...stillLedger, ...lineage,
    });
    return { ready: 1, failed: 0, blocked: 0 };
  } catch (err) {
    logger.error({ runId, surface: job.key, option: job.option, err: err.message }, 'Still generation failed');
    await repo.insertArtwork({
      runId, surface: job.surface, style: job.style, mediaType: 'still', stage: 'still',
      specKey: job.specKey, width: job.spec.width, height: job.spec.height,
      prompt, motionPrompt, status: 'failed', error: err.message, ...lineage,
    });
    return { ready: 0, failed: 1, blocked: 0 };
  }
}

/**
 * Regenerate the still options for ONE surface inside an existing run —
 * the per-sign "Redo unsaved designs" button. Unapproved, unsaved stills for
 * that surface are retired (status 'superseded', hidden by the dashboard) and
 * ONLY their option slots are refilled; approved stills, SAVED stills (a
 * selections row — Scott's "keep this one while I re-roll the rest",
 * 2026-07-21) and any videos already made are untouched. Other surfaces are
 * never touched — that's the whole point (UX feedback 2026-07-14: the global
 * regenerate forced a re-spend across every sign).
 * @returns {Promise<{ runId, phase, status, surface, counts, artworks }>}
 */
export async function regenerateStills({ runId, surfaceKey, triggeredBy = 'dashboard', onStart, deps = {} } = {}) {
  const { repo, guardrails, qa } = resolveDeps(deps);
  const store = deps.store || (await getStore());
  const providers = deps.providers || getProviders();

  const surface = (deps.surfaces || SURFACES).find((s) => s.key === surfaceKey);
  if (!surface) throw new Error(`Unknown surface "${surfaceKey}"`);
  const run = await repo.getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  const week = run.week_of;
  const existing = await repo.listArtworks(runId);
  const mine = existing.filter((a) => a.stage === 'still' && a.style === surface.style);
  // "Saved" = the reviewer bookmarked it (selections row) — protected from
  // regeneration exactly like an approved design, but without committing to it.
  const selections = await repo.listSelections(runId);
  const savedIds = new Set(selections.map((s) => s.artwork_id));
  // Skip variations too (a parent_artwork_id): "keep & explore" designs are
  // managed inside their family (re-roll / tweak / promote), never nuked by a
  // whole-surface re-roll — same protection as kept/approved/superseded.
  const toRetire = mine.filter((x) => x.status !== 'approved' && x.status !== 'superseded' && !savedIds.has(x.id) && !x.parent_artwork_id);
  // Refuse BEFORE flipping the run to 'running' (and before onStart resolves
  // the route) — nothing changed, so the run must stay reviewable and the
  // dashboard gets a clean 409 instead of a phantom in-progress state.
  if (toRetire.length === 0) {
    throw Object.assign(
      new Error('Every design for this sign is saved or approved — unsave one first if you want to replace it.'),
      { code: 'nothing_to_regenerate' },
    );
  }
  // Mark running BEFORE onStart — same polling-race lesson as animateRun.
  await repo.setRunStatus(runId, 'running');
  await onStart?.(run);

  for (const a of toRetire) {
    await repo.updateArtwork(a.id, { status: 'superseded' });
  }

  // Salt the prompt seed with the attempt number. Prompts are deterministic in
  // (week, surface, option) — without the salt, "new designs" would rebuild the
  // exact themes and choreography that were just retired.
  const perBatch = deps.optionsPerSurface ?? config.optionsPerSurface;
  const attempt = Math.max(1, Math.ceil(mine.length / perBatch));
  const promptSeed = `${week}#r${attempt}`;

  // Replace ONLY the retired option slots — a full planJobs batch here would
  // balloon the section past optionsPerSurface whenever something was kept.
  // Slot recovery mirrors regenerateStill: the storage key records the slot
  // (runs/<id>/<surface>/opt<n>/still.png); keyless rows fall back to slot 1.
  const allJobs = planJobs({ surfaces: [surface], optionsPerSurface: deps.optionsPerSurface });
  const slots = [...new Set(toRetire.map((a) => {
    const m = /\/opt(\d+)\//.exec(a.s3_key_final || a.thumbnail_key || '');
    return m ? Number(m[1]) : 1;
  }))];
  const usedOptions = new Set();
  const jobs = [];
  for (const slot of slots) {
    // A slot from an older, larger batch may not exist in today's plan — fall
    // back to the first job not already claimed by another retired slot.
    const job = allJobs.find((j) => j.option === slot && !usedOptions.has(j.option))
      || allJobs.find((j) => !usedOptions.has(j.option));
    if (!job) continue;
    usedOptions.add(job.option);
    jobs.push(job);
  }
  logger.info({ runId, surface: surfaceKey, attempt, options: jobs.length, kept: mine.length - toRetire.length, triggeredBy, mode: providers.mode || config.generationMode }, 'Per-surface regenerate started');

  const workDir = deps.workDir || (await mkdtemp(path.join(os.tmpdir(), `wae-regen-${runId}-`)));
  const counts = { ready: 0, failed: 0, blocked: 0 };
  try {
    let done = 0;
    await repo.setRunProgress?.(runId, { phase: 'designs', done, total: jobs.length });
    for (const job of jobs) {
      const r = await generateStill(job, { runId, weekOf: week, promptSeed, repo, store, providers, guardrails, qa, workDir });
      counts.ready += r.ready; counts.failed += r.failed; counts.blocked += r.blocked;
      done += 1;
      await repo.setRunProgress?.(runId, { phase: 'designs', done, total: jobs.length });
    }
    const status = counts.ready === 0 && counts.failed + counts.blocked > 0 ? 'failed' : 'complete';
    await repo.setRunStatus(runId, status);
    logger.info({ runId, surface: surfaceKey, status, counts }, 'Per-surface regenerate finished');
    return { runId, phase: 'stills', status, surface: surfaceKey, counts, artworks: await repo.listArtworks(runId) };
  } catch (err) {
    await repo.setRunStatus(runId, 'failed', err.message);
    logger.error({ runId, surface: surfaceKey, err: err.message }, 'Per-surface regenerate crashed');
    throw err;
  } finally {
    if (!deps.workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * ADD more design options to ONE surface inside an existing run — the per-sign
 * "Add another design" button. Nothing is retired: every existing design (liked
 * or not, saved or not, approved or not) stays exactly where it is and the new
 * options land beside them in fresh slots.
 *
 * This is the counterpart to regenerateStills, which REPLACES. Scott's case
 * (2026-07-26): "I may like all 3 Spectacular pieces but want to see a 4th" —
 * regenerate refuses outright once everything is saved or approved, because
 * replacing is exactly what he doesn't want.
 *
 * The new option's slot number also drives its theme + choreography (prompts
 * are seeded on the option), so a 4th design is a genuinely different piece
 * rather than another roll of the same three.
 * @returns {Promise<{ runId, phase, status, surface, added, counts, artworks }>}
 */
export async function addStills({ runId, surfaceKey, count = 1, triggeredBy = 'dashboard', onStart, deps = {} } = {}) {
  const { repo, guardrails, qa } = resolveDeps(deps);
  const store = deps.store || (await getStore());
  const providers = deps.providers || getProviders();

  const surface = (deps.surfaces || SURFACES).find((s) => s.key === surfaceKey);
  if (!surface) throw new Error(`Unknown surface "${surfaceKey}"`);
  const run = await repo.getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  const wanted = Math.max(1, Math.min(Number(count) || 1, MAX_ADD_AT_ONCE));
  const existing = await repo.listArtworks(runId);
  // Next free slot = one past the highest this surface has EVER used, including
  // superseded designs — reusing a retired design's slot would hand the new
  // piece that design's theme, which is the opposite of "show me another one".
  const mine = existing.filter((a) => a.stage === 'still' && a.style === surface.style);
  const highest = mine.reduce((max, a) => {
    const m = /\/opt(\d+)\//.exec(a.s3_key_final || a.thumbnail_key || '');
    return Math.max(max, m ? Number(m[1]) : 0);
  }, 0);
  const firstSlot = Math.max(highest, mine.length) + 1;

  // Mark running BEFORE onStart — same polling-race lesson as animateRun.
  await repo.setRunStatus(runId, 'running');
  await onStart?.(run);

  // planJobs is 1..N; we take only the tail slots we're adding.
  const allJobs = planJobs({ surfaces: [surface], optionsPerSurface: firstSlot + wanted - 1 });
  const jobs = allJobs.filter((j) => j.option >= firstSlot);
  logger.info({ runId, surface: surfaceKey, firstSlot, adding: jobs.length, triggeredBy, mode: providers.mode || config.generationMode }, 'Add designs started');

  const workDir = deps.workDir || (await mkdtemp(path.join(os.tmpdir(), `wae-add-${runId}-`)));
  const counts = { ready: 0, failed: 0, blocked: 0 };
  try {
    let done = 0;
    await repo.setRunProgress?.(runId, { phase: 'designs', done, total: jobs.length });
    for (const job of jobs) {
      const r = await generateStill(job, { runId, weekOf: run.week_of, repo, store, providers, guardrails, qa, workDir });
      counts.ready += r.ready; counts.failed += r.failed; counts.blocked += r.blocked;
      done += 1;
      await repo.setRunProgress?.(runId, { phase: 'designs', done, total: jobs.length });
    }
    const status = counts.ready === 0 && counts.failed + counts.blocked > 0 ? 'failed' : 'complete';
    await repo.setRunStatus(runId, status);
    logger.info({ runId, surface: surfaceKey, status, counts }, 'Add designs finished');
    return { runId, phase: 'stills', status, surface: surfaceKey, added: counts.ready, counts, artworks: await repo.listArtworks(runId) };
  } catch (err) {
    await repo.setRunStatus(runId, 'failed', err.message);
    logger.error({ runId, surface: surfaceKey, err: err.message }, 'Add designs crashed');
    throw err;
  } finally {
    if (!deps.workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Regenerate ONE design (a single still option) — the per-card "New design"
 * button. Only the clicked design is retired and replaced; its siblings, all
 * other surfaces, approved stills and existing videos are untouched. (UX
 * feedback 2026-07-21: per-surface regen still rebuilt 3 designs when the
 * reviewer only disliked one.)
 * @returns {Promise<{ runId, phase, status, artworkId, counts }>}
 */
export async function regenerateStill({ artworkId, triggeredBy = 'dashboard', onStart, deps = {} } = {}) {
  const { repo, guardrails, qa } = resolveDeps(deps);
  const store = deps.store || (await getStore());
  const providers = deps.providers || getProviders();

  const still = await repo.getArtwork(artworkId);
  if (!still) throw new Error(`Artwork ${artworkId} not found`);
  if (still.stage !== 'still') throw new Error('Only style designs can be regenerated');
  if (still.status === 'superseded') throw new Error('This design was already replaced');
  const surface = (deps.surfaces || SURFACES).find((s) => s.style === still.style);
  if (!surface) throw new Error(`No surface for style "${still.style}"`);
  const run = await repo.getRun(still.run_id);
  if (!run) throw new Error(`Run ${still.run_id} not found`);

  // Which option slot does this card occupy? The storage key records it
  // (runs/<id>/<surface>/opt<n>/still.png); blocked rows without a key fall
  // back to slot 1 — the slot only steers theme rotation, nothing structural.
  const optMatch = /\/opt(\d+)\//.exec(still.s3_key_final || still.thumbnail_key || '');
  const option = optMatch ? Number(optMatch[1]) : 1;

  // Mark running BEFORE onStart — same polling-race lesson as animateRun.
  await repo.setRunStatus(run.id, 'running');
  await onStart?.(run);
  await repo.updateArtwork(still.id, { status: 'superseded' });

  // Salt the seed with THIS card's id: deterministic, but guaranteed different
  // from the design being replaced and from every earlier regen attempt.
  const promptSeed = `${run.week_of}#a${still.id}`;
  const jobs = planJobs({ surfaces: [surface], optionsPerSurface: deps.optionsPerSurface });
  const job = jobs.find((j) => j.option === option) || jobs[0];
  logger.info({ runId: run.id, artworkId, surface: surface.key, option, triggeredBy, mode: providers.mode || config.generationMode }, 'Per-design regenerate started');

  const workDir = deps.workDir || (await mkdtemp(path.join(os.tmpdir(), `wae-regen1-${run.id}-`)));
  try {
    await repo.setRunProgress?.(run.id, { phase: 'designs', done: 0, total: 1 });
    const counts = await generateStill(job, { runId: run.id, weekOf: run.week_of, promptSeed, repo, store, providers, guardrails, qa, workDir });
    await repo.setRunProgress?.(run.id, { phase: 'designs', done: 1, total: 1 });
    const status = counts.ready === 0 ? 'failed' : 'complete';
    await repo.setRunStatus(run.id, status);
    logger.info({ runId: run.id, artworkId, status }, 'Per-design regenerate finished');
    return { runId: run.id, phase: 'stills', status, artworkId, counts };
  } catch (err) {
    await repo.setRunStatus(run.id, 'failed', err.message);
    logger.error({ runId: run.id, artworkId, err: err.message }, 'Per-design regenerate crashed');
    throw err;
  } finally {
    if (!deps.workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ===========================================================================
// KEEP & EXPLORE — variations of a liked still (re-roll / plain-language tweak)
// ===========================================================================

/**
 * Shared machinery for a "keep & explore" variation: generate ONE new still
 * into `source`'s family from an explicit prompt. Mirrors regenerateStill's
 * run-status / workDir / progress / error handling — the only differences are
 * that the PROMPT is supplied (not template-rebuilt) and the new row carries the
 * family lineage. `resolvePrompt(source)` returns { promptOverride, changeNote }
 * and runs AFTER the fast 202 (so a tweak's LLM edit is off the request path).
 * @returns {Promise<{ runId, phase, status, artworkId, counts }>}
 */
async function spawnVariation({ source, resolvePrompt, triggeredBy, onStart, deps, label }) {
  const { repo, guardrails, qa } = resolveDeps(deps);
  const store = deps.store || (await getStore());
  const providers = deps.providers || getProviders();

  const surface = (deps.surfaces || SURFACES).find((s) => s.style === source.style);
  if (!surface) throw new Error(`No surface for style "${source.style}"`);
  const run = await repo.getRun(source.run_id);
  if (!run) throw new Error(`Run ${source.run_id} not found`);

  // Bootstrap the family: the first keep/vary/tweak of a plain still makes it the
  // anchor of its own family (family_id = its own id) so every variation shares it.
  let familyId = source.family_id;
  if (!familyId) {
    familyId = source.id;
    await repo.updateArtwork(source.id, { familyId });
  }

  // The option slot only supplies the surface's gen dims (the PROMPT is an
  // override); reuse regenerateStill's slot recovery from the storage key.
  const optMatch = /\/opt(\d+)\//.exec(source.s3_key_final || source.thumbnail_key || '');
  const option = optMatch ? Number(optMatch[1]) : 1;
  const jobs = planJobs({ surfaces: [surface], optionsPerSurface: deps.optionsPerSurface });
  const job = jobs.find((j) => j.option === option) || jobs[0];

  // Mark running BEFORE onStart — same polling-race lesson as animateRun.
  await repo.setRunStatus(run.id, 'running');
  await onStart?.(run);
  // Resolve the prompt after the 202 has been sent (a tweak's LLM call happens
  // here, in the background, not while the reviewer's request is blocking).
  const { promptOverride, changeNote = null } = await resolvePrompt(source);
  logger.info({ runId: run.id, artworkId: source.id, familyId, surface: surface.key, label, triggeredBy, mode: providers.mode || config.generationMode }, `${label} started`);

  const workDir = deps.workDir || (await mkdtemp(path.join(os.tmpdir(), `wae-${label}-${run.id}-`)));
  try {
    await repo.setRunProgress?.(run.id, { phase: 'designs', done: 0, total: 1 });
    const counts = await generateStill(job, {
      runId: run.id, weekOf: run.week_of, repo, store, providers, guardrails, qa, workDir,
      promptOverride, motionPromptOverride: source.motion_prompt,
      familyId, parentArtworkId: source.id, changeNote,
    });
    await repo.setRunProgress?.(run.id, { phase: 'designs', done: 1, total: 1 });
    const status = counts.ready === 0 ? 'failed' : 'complete';
    await repo.setRunStatus(run.id, status);
    logger.info({ runId: run.id, artworkId: source.id, status }, `${label} finished`);
    return { runId: run.id, phase: 'stills', status, artworkId: source.id, counts };
  } catch (err) {
    await repo.setRunStatus(run.id, 'failed', err.message);
    logger.error({ runId: run.id, artworkId: source.id, err: err.message }, `${label} crashed`);
    throw err;
  } finally {
    if (!deps.workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * RE-ROLL a liked still: generate a fresh take by re-running its STORED prompt
 * verbatim (Seedream is stochastic, so the same prompt yields a new version of
 * the same piece). The new still joins the source's family; the source is
 * untouched. @returns {Promise<{ runId, phase, status, artworkId, counts }>}
 */
export async function varyStill({ artworkId, triggeredBy = 'dashboard', onStart, deps = {} } = {}) {
  const { repo } = resolveDeps(deps);
  const card = await repo.getArtwork(artworkId);
  if (!card) throw new Error(`Artwork ${artworkId} not found`);
  // A video resolves to the design behind it: another "version" of a video is
  // a new DESIGN for Scott to approve and animate, never an automatic re-render.
  const source = await resolveDesign({ artwork: card, repo });
  if (source.status === 'superseded') throw new Error('This design was already replaced');
  return spawnVariation({
    source, triggeredBy, onStart, deps, label: 'vary',
    // Re-roll reuses the stored prompt exactly; no change note.
    resolvePrompt: (s) => ({ promptOverride: s.prompt, changeNote: null }),
  });
}

/**
 * PLAIN-LANGUAGE TWEAK of a liked still: an LLM edits ONLY the reviewer's
 * requested change into the source's existing prompt (everything else
 * preserved), then that edited prompt is generated as a new same-family still
 * carrying the change note. The refiner is injectable (deps.refineTweak) so
 * tests run offline. @returns {Promise<{ runId, phase, status, artworkId, counts }>}
 */
export async function tweakStill({ artworkId, instruction, triggeredBy = 'dashboard', onStart, deps = {} } = {}) {
  const { repo } = resolveDeps(deps);
  const card = await repo.getArtwork(artworkId);
  if (!card) throw new Error(`Artwork ${artworkId} not found`);
  const source = await resolveDesign({ artwork: card, repo });
  if (source.status === 'superseded') throw new Error('This design was already replaced');
  // Injectable so tests never hit the network; refineTweak itself never throws
  // (falls back to the original prompt + the instruction as the note).
  const refine = deps.refineTweak || refineTweak;
  return spawnVariation({
    source, triggeredBy, onStart, deps, label: 'tweak',
    resolvePrompt: async (s) => {
      const { prompt, changeNote } = await refine({ prompt: s.prompt, instruction, style: s.style });
      return { promptOverride: prompt, changeNote };
    },
  });
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
    // Live progress for the dashboard ("Making videos… 1/3"). One unit per
    // still being animated (an EON set is one Seedance call → one unit).
    let done = 0;
    await repo.setRunProgress?.(runId, { phase: 'videos', done, total: toAnimate.length });
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
      done += 1;
      await repo.setRunProgress?.(runId, { phase: 'videos', done, total: toAnimate.length });
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

  // Stills generated 2026-07-25..30 stored a motion prompt naming "vertical
  // bands at the one-third and two-thirds lines" — vocabulary Seedance
  // literalized into painted white lines at exactly those positions in the
  // finished pillar videos (Scott, 2026-07-31). Stripping the sentence here,
  // at the one place the motion spend happens, fixes re-animation of every
  // affected still without touching stored data. No-op on current prompts.
  const motionPrompt = sanitizeMotionPrompt(still.motion_prompt);

  const dir = path.join(workDir, `still${still.id}`);
  await mkdir(dir, { recursive: true });

  // Materialize the approved still as the first-frame reference (works for
  // local or S3 stores).
  const ref = path.join(dir, 'ref.png');
  await writeFile(ref, await store.getBuffer(still.s3_key_final));

  const raw = path.join(dir, 'raw.mp4');
  const gen = await providers.motion.generate({
    width: surface.gen.width, height: surface.gen.height, ratio: surface.gen.ratio,
    durationS: duration, fps, output: raw, prompt: motionPrompt,
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

  // Immutable cost ledger, computed here where BOTH the Seedance 1080p render
  // dims and the 4K final dims are known. Billed on the RAW generation seconds
  // (`duration`) — ping-pong doubles playback locally at no fal cost. Fixtures
  // are free. See services/generation/falPricing.js for the rate book.
  const live = !String(gen.model || '').startsWith('fixture');
  const tier = falPricing.seedanceTier(gen.model);
  const aspect = finalSpec.width / finalSpec.height;
  const render = falPricing.renderDimsForTier(aspect, tier);
  const seedanceUsd = live ? falPricing.seedanceCostUsd({ ...render, durationS: duration, tier }) : 0;
  const topazUsd = live && falPricing.usedTopaz(gen.model)
    ? falPricing.topazCostUsd({ width: finalSpec.width, height: finalSpec.height, durationS: duration, fps })
    : 0;
  const callCostUsd = Math.round((seedanceUsd + topazUsd) * 1e4) / 1e4;
  // One fal call = one bill. EON_SLICE stores a row per panel cut from that
  // single call, so the bill is divided across them; every other surface is one
  // row = full cost. `usd` is an absolute amount (see allocateCost).
  const ledger = (usd = callCostUsd) => ({
    falRequestId: live ? gen.jobId ?? null : null,
    upscaleRequestId: live ? gen.upscaleJobId ?? null : null,
    costUsd: live ? Math.round(usd * 1e4) / 1e4 : 0,
  });

  const insertMotion = (extra) => repo.insertArtwork({
    runId, surface: surface.surface, style: surface.style, mediaType: 'video', stage: 'motion',
    sourceStillId: still.id, prompt: still.prompt, motionPrompt, model: gen.model,
    s3KeyRaw: rawPut.key, error: driftWarn ?? null, ...extra,
  });

  if (surface.post === POST.EON_SLICE) {
    // The wrapped master covers every pod slab side by side (spine + face per
    // pod). Conform it, then cut each panel out so the art carries around the
    // corner onto the spine instead of the spine being a separate afterthought.
    const pods = surface.pods ?? 3;
    const master = path.join(dir, 'master.mp4');
    await ffmpeg.conform({ input: srcVideo, output: master, width: finalSpec.width, height: finalSpec.height, duration: effDuration, fps });
    const masterPut = await store.put({ key: key('master.mp4'), sourcePath: master });
    const panels = await sliceMaster({ masterPath: master, outDir: dir, pods, duration: effDuration });

    // One fal bill, divided across the panels by how much of the master each
    // one is (a face is 4x a spine), remainder on the last so the ledger rows
    // sum to EXACTLY what the call cost.
    const shares = allocateCost(callCostUsd, panels.map((p) => p.width));

    const ids = {};
    for (const [i, panel] of panels.entries()) {
      const td = thumbDims(SPECS[panel.specKey]);
      const thumb = path.join(dir, `${panel.label}_thumb.jpg`);
      await ffmpeg.thumbnail({ input: panel.path, output: thumb, width: td.width, height: td.height, atSeconds: Math.min(2, effDuration / 2) });
      const panelPut = await store.put({ key: key(`${panel.label}.mp4`), sourcePath: panel.path });
      const thumbPut = await store.put({ key: key(`${panel.label}_thumb.jpg`), sourcePath: thumb });
      const probed = await ffmpeg.probe(panel.path);
      const a = await insertMotion({
        specKey: panel.specKey, panel: panel.label,
        width: panel.width, height: panel.height,
        durationS: Math.round(probed.duration ?? effDuration),
        s3KeyFinal: panelPut.key, thumbnailKey: thumbPut.key, status: 'ready',
        ...ledger(shares[i]),
      });
      ids[panel.label] = a.id;
    }
    await repo.insertEonSequence({
      runId, masterS3Key: masterPut.key,
      face1ArtworkId: ids.pod1_face, face2ArtworkId: ids.pod2_face, face3ArtworkId: ids.pod3_face,
      spine1ArtworkId: ids.pod1_spine, spine2ArtworkId: ids.pod2_spine, spine3ArtworkId: ids.pod3_spine,
    });
    return panels.length;
  }

  // Spectacular (frame-break): one motion artwork. Both EON surfaces cut into
  // panels above — a single pillar has a spine too, so it is never a lone face.
  //
  // FRAME_BREAK no longer composites a border in post (Shawn, 2026-07-21: a
  // post-drawn letterbox clips the art BEHIND the frame — nothing can ever pop
  // out of a border that's painted on top afterwards). The 3D frame now lives
  // IN the generation: the still prompt paints a trompe-l'oeil black border
  // into the scene and the motion prompt drives the subject through it, over
  // and in front — so the pop-out is real pixels, model-rendered. Here we just
  // conform full-bleed to spec like every other surface.
  const final = path.join(dir, 'final.mp4');
  await ffmpeg.conform({ input: srcVideo, output: final, width: finalSpec.width, height: finalSpec.height, duration: effDuration, fps });
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
    ...ledger(),
  });
  return 1;
}

export default { runWeek, animateRun, regenerateStills, addStills, regenerateStill, varyStill, tweakStill, allocateCost };
