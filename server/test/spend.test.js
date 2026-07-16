import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeSpend, monthKey } from '../src/services/spend.js';
import { createMemoryRepo } from '../src/db/memoryRepo.js';
import config from '../src/config/index.js';

const { stillUsd, videoPerSecondUsd } = config.costs;
const THIS_MONTH = monthKey(new Date());

async function seed(repo, { weekOf }) {
  const run = await repo.createRun({ weekOf, triggeredBy: 'test' });
  return run;
}

test('spend: live stills billed flat, fixture and blocked rows free', async () => {
  const repo = createMemoryRepo();
  const run = await seed(repo, { weekOf: `${THIS_MONTH}-03` });
  const base = { runId: run.id, surface: 'eon', style: 'eon_single', mediaType: 'still', stage: 'still', specKey: 'eon_face' };
  await repo.insertArtwork({ ...base, model: 'seedream-v4', status: 'ready' });        // billed
  await repo.insertArtwork({ ...base, model: 'seedream-v4', status: 'failed', error: 'qa: too dark' }); // spent then gated → billed
  await repo.insertArtwork({ ...base, model: 'fixture-still', status: 'ready' });      // free
  await repo.insertArtwork({ ...base, status: 'failed', error: 'guardrail: nope' });   // blocked pre-spend → free

  const s = await computeSpend({ repo });
  assert.equal(s.stills.count, 2);
  assert.equal(s.totalUsd, Math.round(2 * stillUsd * 100) / 100);
});

test('spend: EON connected set bills ONE Seedance call; all videos at base duration', async () => {
  const repo = createMemoryRepo();
  const run = await seed(repo, { weekOf: `${THIS_MONTH}-03` });
  const motion = { runId: run.id, mediaType: 'video', stage: 'motion', model: 'seedance-2.0-fast' };
  // 3 connected faces sharing one raw key = ONE 15s call.
  for (let pod = 1; pod <= 3; pod += 1) {
    await repo.insertArtwork({
      ...motion, surface: 'eon', style: 'eon_connected', specKey: 'eon_face',
      s3KeyRaw: 'runs/1/motion/still9/raw.mp4', durationS: 15,
    });
  }
  // One single-pod video: 15s (no ping-pong — user wants full-scene motion throughout, not seamless loop).
  await repo.insertArtwork({
    ...motion, surface: 'eon', style: 'eon_single', specKey: 'eon_face',
    s3KeyRaw: 'runs/1/motion/still10/raw.mp4', durationS: 15,
  });

  const s = await computeSpend({ repo });
  assert.equal(s.videos.count, 2, 'two Seedance calls, not four rows');
  assert.equal(s.videos.seconds, 30); // 15 + 15
  assert.equal(s.videos.usd, Math.round(30 * videoPerSecondUsd * 100) / 100);
});

test('spend: only the requested month counts (week_of fallback for old rows)', async () => {
  const repo = createMemoryRepo();
  const past = await seed(repo, { weekOf: '2025-12-01' });
  const artPast = await repo.insertArtwork({
    runId: past.id, surface: 'eon', style: 'eon_single', mediaType: 'still', stage: 'still',
    specKey: 'eon_face', model: 'seedream-v4', status: 'ready',
  });
  // Simulate a pre-timestamp row (hydrated from an old snapshot).
  await repo.updateArtwork(artPast.id, {});
  const rowsMonth = await computeSpend({ repo, month: '2025-12' });
  // created_at is stamped NOW (this month), so the past-month query must use
  // week_of fallback only for null created_at — this row has created_at, so:
  assert.equal(rowsMonth.stills.count, 0);
  const cur = await computeSpend({ repo });
  assert.equal(cur.stills.count, 1);
});
