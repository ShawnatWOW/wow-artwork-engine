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

test('approve/reject flips artwork status via updateArtwork', async () => {
  const repo = createMemoryRepo();
  const run = await repo.createRun({ weekOf: '2026-08-10', triggeredBy: 'test' });
  const a = await repo.insertArtwork({ runId: run.id, surface: 'spectacular', style: 'frame_break', mediaType: 'video', specKey: 'spectacular_wow1_8', status: 'ready' });

  assert.equal((await repo.updateArtwork(a.id, { status: 'approved' })).status, 'approved');
  assert.equal((await repo.updateArtwork(a.id, { status: 'rejected' })).status, 'rejected');
});
