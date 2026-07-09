import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runWeek } from '../src/services/orchestrator.js';
import { createMemoryRepo } from '../src/db/memoryRepo.js';
import { createLocalStore } from '../src/services/storage/local.js';
import { SURFACES } from '../src/services/generation/catalog.js';
import { motionProvider, stillProvider } from '../src/services/generation/fixture.js';
import ffmpeg from '../src/services/ffmpeg.js';

const execFileP = promisify(execFile);
async function hasFfmpeg() {
  try {
    await execFileP('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

const fixtureProviders = { mode: 'fixture', motion: motionProvider, still: stillProvider };

test('runWeek generates every surface, conforms to spec, and records artworks', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const base = await mkdtemp(path.join(os.tmpdir(), 'wae-orch-'));
  const repo = createMemoryRepo();
  const store = createLocalStore({ baseDir: base });
  try {
    const summary = await runWeek({
      weekOf: '2026-08-10',
      triggeredBy: 'test',
      deps: { repo, store, providers: fixtureProviders, optionsPerSurface: 1, duration: 1 },
    });

    // 1 spectacular + 3 EON faces (connected) + 1 EON single = 5 ready artworks.
    assert.equal(summary.status, 'complete');
    assert.equal(summary.counts.ready, 5);
    assert.equal(summary.counts.failed, 0);
    assert.equal(summary.counts.blocked, 0);

    const artworks = await repo.listArtworks(summary.runId);
    assert.equal(artworks.length, 5);
    assert.ok(artworks.every((a) => a.status === 'ready'));

    // The connected option wrote one eon_sequence linking three face artworks.
    const seqs = await repo.listEonSequences(summary.runId);
    assert.equal(seqs.length, 1);
    assert.ok(seqs[0].master_s3_key);
    assert.ok(seqs[0].face1_artwork_id && seqs[0].face2_artwork_id && seqs[0].face3_artwork_id);

    // Every final asset exists in the store and matches its spec exactly.
    const spectacular = artworks.find((a) => a.style === 'frame_break');
    const probedSpec = await ffmpeg.probe(store.localPath(spectacular.s3_key_final));
    assert.equal(probedSpec.width, 1692);
    assert.equal(probedSpec.height, 468);

    for (const face of artworks.filter((a) => a.style === 'eon_connected')) {
      const p = await ffmpeg.probe(store.localPath(face.s3_key_final));
      assert.equal(p.width, 256);
      assert.equal(p.height, 384);
    }

    const single = artworks.find((a) => a.style === 'eon_single');
    const probedSingle = await ffmpeg.probe(store.localPath(single.s3_key_final));
    assert.equal(probedSingle.width, 256);
    assert.equal(probedSingle.height, 384);

    // Thumbnails were captured for every ready artwork.
    assert.ok(artworks.every((a) => a.thumbnail_key));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('guardrail blocks a prompt BEFORE the provider is ever called (no spend)', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wae-orch-block-'));
  const repo = createMemoryRepo();
  const store = createLocalStore({ baseDir: base });

  // A provider that throws if invoked — proves generation never happened.
  const exploding = {
    mode: 'fixture',
    motion: { model: 'boom', generate: async () => { throw new Error('should not spend'); } },
    still: { model: 'boom', generate: async () => { throw new Error('should not spend'); } },
  };
  const blockAll = {
    checkPrompt: () => ({ allowed: false, reasons: ['nudity term: "test"'] }),
    reviewArtwork: async () => ({ allowed: true, reasons: [] }),
  };

  try {
    const summary = await runWeek({
      weekOf: '2026-08-10',
      triggeredBy: 'test',
      deps: {
        repo, store, providers: exploding, guardrails: blockAll,
        surfaces: SURFACES.filter((s) => s.key === 'spectacular'),
        optionsPerSurface: 1, duration: 1,
      },
    });

    assert.equal(summary.counts.blocked, 1);
    assert.equal(summary.counts.ready, 0);
    assert.equal(summary.status, 'failed'); // nothing usable produced

    const [artwork] = await repo.listArtworks(summary.runId);
    assert.equal(artwork.status, 'failed');
    assert.match(artwork.error, /guardrail/);
    // The block reason, not a provider error — confirms we never spent.
    assert.doesNotMatch(artwork.error, /should not spend/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
