import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryRepo } from '../src/db/memoryRepo.js';

test('selections: add is idempotent per artwork, scoped to a run, and removable', async () => {
  const repo = createMemoryRepo();
  const run = await repo.createRun({ weekOf: '2026-08-10', triggeredBy: 'test' });
  const a = await repo.insertArtwork({ runId: run.id, surface: 'eon', style: 'eon_single', mediaType: 'video', specKey: 'eon_face', status: 'ready' });
  const b = await repo.insertArtwork({ runId: run.id, surface: 'eon', style: 'eon_single', mediaType: 'video', specKey: 'eon_face', status: 'ready' });

  await repo.addSelection(a.id, 'reviewer@wow');
  await repo.addSelection(a.id, 'reviewer@wow'); // dup → still one row
  await repo.addSelection(b.id, 'reviewer@wow');

  let picks = await repo.listSelections(run.id);
  assert.equal(picks.length, 2);
  assert.deepEqual(picks.map((s) => s.artwork_id).sort((x, y) => x - y), [a.id, b.id]);

  await repo.removeSelection(a.id);
  picks = await repo.listSelections(run.id);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].artwork_id, b.id);

  // Selections from another run are not returned.
  const other = await repo.createRun({ weekOf: '2026-08-17', triggeredBy: 'test' });
  assert.equal((await repo.listSelections(other.id)).length, 0);
});

test('listAllDeliveries: cross-run history, newest first, artwork + run attached', async () => {
  const repo = createMemoryRepo();
  const run1 = await repo.createRun({ weekOf: '2026-08-10', triggeredBy: 'test' });
  const run2 = await repo.createRun({ weekOf: '2026-08-17', triggeredBy: 'test' });
  const a1 = await repo.insertArtwork({ runId: run1.id, surface: 'eon', style: 'eon_single', mediaType: 'video', specKey: 'eon_face', width: 1280, height: 1920, status: 'approved' });
  const a2 = await repo.insertArtwork({ runId: run2.id, surface: 'spectacular', style: 'frame_break', mediaType: 'video', specKey: 'spectacular_wow1_8', width: 3840, height: 1062, status: 'approved' });

  // Week-1 send is OLDER than week-2's — history must lead with week 2.
  await repo.insertDelivery({ artworkId: a1.id, method: 'drive', destination: 'https://drive/w1', status: 'sent', sentAt: '2026-08-11T10:00:00Z' });
  await repo.insertDelivery({ artworkId: a2.id, method: 'drive', destination: 'https://drive/w2', status: 'sent', sentAt: '2026-08-18T10:00:00Z' });
  // Never dated (offline write, created_at null too) → sinks to the bottom.
  await repo.insertDelivery({ artworkId: a1.id, method: 'local', destination: '/tmp/x', status: 'offline' });

  const all = await repo.listAllDeliveries();
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((d) => d.sent_at), ['2026-08-18T10:00:00Z', '2026-08-11T10:00:00Z', null]);
  // Each row carries its artwork + run context for the dashboard.
  assert.equal(all[0].artwork.surface, 'spectacular');
  assert.equal(all[0].run.week_of, '2026-08-17');
  assert.equal(all[1].artwork.surface, 'eon');
  assert.equal(all[1].run.week_of, '2026-08-10');
});

test('approve/reject flips artwork status via updateArtwork', async () => {
  const repo = createMemoryRepo();
  const run = await repo.createRun({ weekOf: '2026-08-10', triggeredBy: 'test' });
  const a = await repo.insertArtwork({ runId: run.id, surface: 'spectacular', style: 'frame_break', mediaType: 'video', specKey: 'spectacular_wow1_8', status: 'ready' });

  assert.equal((await repo.updateArtwork(a.id, { status: 'approved' })).status, 'approved');
  assert.equal((await repo.updateArtwork(a.id, { status: 'rejected' })).status, 'rejected');
});
