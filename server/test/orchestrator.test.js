import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runWeek, animateRun } from '../src/services/orchestrator.js';
import { createMemoryRepo } from '../src/db/memoryRepo.js';
import { createLocalStore } from '../src/services/storage/local.js';
import { SURFACES } from '../src/services/generation/catalog.js';
import { motionProvider, stillProvider } from '../src/services/generation/fixture.js';
import ffmpeg from '../src/services/ffmpeg.js';

const execFileP = promisify(execFile);
async function hasFfmpeg() {
  try { await execFileP('ffmpeg', ['-version']); return true; } catch { return false; }
}
const providers = { mode: 'fixture', motion: motionProvider, still: stillProvider };

async function harness() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wae-orch-'));
  return { base, repo: createMemoryRepo(), store: createLocalStore({ baseDir: base }) };
}

test('Phase 1: runWeek generates one still per surface/option (nothing animated)', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const { base, repo, store } = await harness();
  try {
    const summary = await runWeek({
      weekOf: '2026-08-10', triggeredBy: 'test',
      deps: { repo, store, providers, optionsPerSurface: 1, duration: 1 },
    });
    assert.equal(summary.phase, 'stills');
    assert.equal(summary.status, 'complete');
    assert.equal(summary.counts.ready, 3); // spectacular + eon_connected + eon_single

    const stills = await repo.listArtworks(summary.runId);
    assert.equal(stills.length, 3);
    assert.ok(stills.every((a) => a.stage === 'still' && a.media_type === 'still' && a.status === 'ready'));
    assert.ok(stills.every((a) => a.prompt && a.motion_prompt), 'each still carries a still + motion prompt');

    // The still is a real image at its generation size.
    const spec = stills.find((a) => a.style === 'frame_break');
    const probed = await ffmpeg.probe(store.localPath(spec.s3_key_final));
    assert.equal(probed.width, 1280);
    assert.equal(probed.height, 720);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('Phase 2: animateRun animates ONLY approved stills, conformed to spec, linked back', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const { base, repo, store } = await harness();
  try {
    const { runId } = await runWeek({ weekOf: '2026-08-10', triggeredBy: 'test', deps: { repo, store, providers, optionsPerSurface: 1, duration: 1 } });
    const stills = await repo.listArtworks(runId);
    for (const s of stills) await repo.updateArtwork(s.id, { status: 'approved' }); // approve all 3

    const summary = await animateRun({ runId, deps: { repo, store, providers, duration: 1 } });
    // spectacular 1 + eon_single 1 + eon_connected 3 faces = 5 motion artworks.
    assert.equal(summary.counts.ready, 5);

    const all = await repo.listArtworks(runId);
    const motions = all.filter((a) => a.stage === 'motion');
    assert.equal(motions.length, 5);
    assert.ok(motions.every((m) => m.media_type === 'video' && m.status === 'ready' && m.source_still_id));

    // Motions are conformed to the exact sign specs.
    const spec = motions.find((m) => m.style === 'frame_break');
    let p = await ffmpeg.probe(store.localPath(spec.s3_key_final));
    assert.equal(p.width, 1692); assert.equal(p.height, 468);
    for (const face of motions.filter((m) => m.style === 'eon_connected')) {
      p = await ffmpeg.probe(store.localPath(face.s3_key_final));
      assert.equal(p.width, 256); assert.equal(p.height, 384);
    }
    assert.equal((await repo.listEonSequences(runId)).length, 1);

    // Idempotent: re-animating produces nothing new.
    const again = await animateRun({ runId, deps: { repo, store, providers, duration: 1 } });
    assert.equal(again.counts.ready, 0);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('guardrail blocks the MOTION spend before Seedance is ever called', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const { base, repo, store } = await harness();
  const exploding = {
    mode: 'fixture',
    still: stillProvider, // Phase 1 still is allowed
    motion: { model: 'boom', generate: async () => { throw new Error('should not spend'); } },
  };
  // Motion prompts contain "motion"; still prompts don't — use that to block
  // only the Seedance (motion) spend.
  const blockMotion = {
    checkPrompt: (p) => (/\bmotion\b/i.test(p) ? { allowed: false, reasons: ['test motion block'] } : { allowed: true, reasons: [] }),
    reviewArtwork: async () => ({ allowed: true, reasons: [] }),
  };
  try {
    const spectacularOnly = SURFACES.filter((s) => s.key === 'spectacular');
    const { runId } = await runWeek({ weekOf: '2026-08-10', triggeredBy: 'test', deps: { repo, store, providers: exploding, surfaces: spectacularOnly, optionsPerSurface: 1, duration: 1 } });
    const [still] = await repo.listArtworks(runId);
    await repo.updateArtwork(still.id, { status: 'approved' });

    const summary = await animateRun({ runId, deps: { repo, store, providers: exploding, guardrails: blockMotion, duration: 1 } });
    assert.equal(summary.counts.blocked, 1);
    assert.equal(summary.counts.ready, 0);
    // No motion produced, and the recorded error is the guardrail — not a provider spend.
    const motions = (await repo.listArtworks(runId)).filter((a) => a.stage === 'motion');
    assert.equal(motions.length, 0);
    const updated = await repo.getArtwork(still.id);
    assert.match(updated.error, /motion guardrail/);
    assert.doesNotMatch(updated.error || '', /should not spend/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('Phase 1 guardrail blocks a still prompt before the still spend', async (t) => {
  const { base, repo, store } = await harness();
  const explodingStill = {
    mode: 'fixture',
    still: { model: 'boom', generate: async () => { throw new Error('should not spend') } },
    motion: motionProvider,
  };
  const blockAll = { checkPrompt: () => ({ allowed: false, reasons: ['nudity'] }), reviewArtwork: async () => ({ allowed: true, reasons: [] }) };
  try {
    const summary = await runWeek({
      weekOf: '2026-08-10', triggeredBy: 'test',
      deps: { repo, store, providers: explodingStill, guardrails: blockAll, surfaces: SURFACES.filter((s) => s.key === 'spectacular'), optionsPerSurface: 1, duration: 1 },
    });
    assert.equal(summary.counts.blocked, 1);
    const [a] = await repo.listArtworks(summary.runId);
    assert.equal(a.status, 'failed');
    assert.match(a.error, /guardrail/);
    assert.doesNotMatch(a.error, /should not spend/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
