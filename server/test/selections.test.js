import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryRepo } from '../src/db/memoryRepo.js';
import { keepArtwork, unkeepArtwork, promoteArtwork } from '../src/services/keeper.js';

// A still row helper for the "keep & explore" family tests — no generation
// needed; the keeper logic only reads/writes rows + selections.
const stillIn = (repo, runId, extra = {}) => repo.insertArtwork({
  runId, surface: 'eon', style: 'eon_single', mediaType: 'still', stage: 'still',
  specKey: 'eon_face', width: 1280, height: 1920, status: 'ready', ...extra,
});
const pickIds = async (repo, runId) =>
  (await repo.listSelections(runId)).map((s) => s.artwork_id).sort((x, y) => x - y);

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

test('lineage columns round-trip on insert + update (family_id, parent_artwork_id, change_note)', async () => {
  const repo = createMemoryRepo();
  const run = await repo.createRun({ weekOf: '2026-08-10', triggeredBy: 'test' });

  // Explicit lineage on insert.
  const v = await stillIn(repo, run.id, { familyId: 7, parentArtworkId: 3, changeNote: 'made the sky teal' });
  assert.equal(v.family_id, 7);
  assert.equal(v.parent_artwork_id, 3);
  assert.equal(v.change_note, 'made the sky teal');

  // Absent → all null (a plain still never kept/varied).
  const plain = await stillIn(repo, run.id);
  assert.equal(plain.family_id, null);
  assert.equal(plain.parent_artwork_id, null);
  assert.equal(plain.change_note, null);

  // updateArtwork maps the camelCase inputs to the snake_case columns.
  const updated = await repo.updateArtwork(plain.id, { familyId: plain.id, changeNote: 'x' });
  assert.equal(updated.family_id, plain.id);
  assert.equal(updated.change_note, 'x');
});

test('keep: bootstraps the family and enforces exactly one keeper per family', async () => {
  const repo = createMemoryRepo();
  const run = await repo.createRun({ weekOf: '2026-08-10', triggeredBy: 'test' });
  const A = await stillIn(repo, run.id);
  const unrelated = await stillIn(repo, run.id); // a different design on the surface

  // Keep A → family_id bootstraps to A.id and A is selected.
  const keptA = await keepArtwork({ artworkId: A.id, repo });
  assert.equal(keptA.family_id, A.id);
  assert.deepEqual(await pickIds(repo, run.id), [A.id]);

  // Two variations of A (as varyStill would insert them).
  const V1 = await stillIn(repo, run.id, { familyId: A.id, parentArtworkId: A.id });
  const V2 = await stillIn(repo, run.id, { familyId: A.id, parentArtworkId: A.id });

  // Keep a variation → it becomes the ONLY selected member of the family; A is
  // demoted. The unrelated design is never touched.
  await keepArtwork({ artworkId: V1.id, repo });
  assert.deepEqual(await pickIds(repo, run.id), [V1.id]);
  assert.equal((await repo.listSelections(run.id)).some((s) => s.artwork_id === unrelated.id), false);
  void V2;

  // Keeping a VIDEO keeps the design behind it (Shawn, 2026-07-26): a video is
  // a render OF a design, so exploring from it means exploring that design.
  const video = await repo.insertArtwork({
    runId: run.id, surface: 'eon', style: 'eon_single', mediaType: 'video', stage: 'motion',
    specKey: 'eon_face', status: 'ready', sourceStillId: unrelated.id,
  });
  const keptFromVideo = await keepArtwork({ artworkId: video.id, repo });
  assert.equal(keptFromVideo.id, unrelated.id, 'the DESIGN is kept, not the video row');
  // The video row itself is never selected — only the design behind it. V1 stays
  // selected too: it anchors a DIFFERENT family, and each family has its own keeper.
  assert.deepEqual(await pickIds(repo, run.id), [V1.id, unrelated.id].sort((a, b) => a - b));
  assert.equal((await repo.listSelections(run.id)).some((s) => s.artwork_id === video.id), false);

  // A video with no design behind it has nothing to explore — say so plainly.
  const orphan = await repo.insertArtwork({ runId: run.id, surface: 'eon', style: 'eon_single', mediaType: 'video', stage: 'motion', specKey: 'eon_face', status: 'ready' });
  await assert.rejects(() => keepArtwork({ artworkId: orphan.id, repo }), /no design behind it/);
});

// QA 2026-07-26: un-keeping dropped the selection but left family_id set, so
// the next plain SAVE re-promoted the design to a full exploration anchor —
// the dashboard tells Save from Keep by family_id.
test('unkeep: clears a lone design\'s family marker, but never orphans variations', async () => {
  const repo = createMemoryRepo();
  const run = await repo.createRun({ weekOf: '2026-08-10', triggeredBy: 'test' });

  // A design kept and then un-kept goes fully back to being a plain design.
  const solo = await stillIn(repo, run.id);
  await keepArtwork({ artworkId: solo.id, repo });
  assert.equal((await repo.getArtwork(solo.id)).family_id, solo.id);
  await unkeepArtwork({ artworkId: solo.id, repo });
  assert.equal((await repo.getArtwork(solo.id)).family_id, null, 'a lone design must not stay anchored');
  assert.deepEqual(await pickIds(repo, run.id), []);

  // With variations in the family the marker MUST survive, or they orphan.
  const anchor = await stillIn(repo, run.id);
  await keepArtwork({ artworkId: anchor.id, repo });
  const variation = await stillIn(repo, run.id, { familyId: anchor.id, parentArtworkId: anchor.id });
  await unkeepArtwork({ artworkId: anchor.id, repo });
  assert.equal((await repo.getArtwork(anchor.id)).family_id, anchor.id, 'family with members must stay intact');
  assert.equal((await repo.getArtwork(variation.id)).family_id, anchor.id);
});

test('promote: a variation becomes the keeper; the original is never lost', async () => {
  const repo = createMemoryRepo();
  const run = await repo.createRun({ weekOf: '2026-08-10', triggeredBy: 'test' });
  const A = await stillIn(repo, run.id);
  await keepArtwork({ artworkId: A.id, repo }); // A is the keeper
  const B = await stillIn(repo, run.id, { familyId: A.id, parentArtworkId: A.id });

  await promoteArtwork({ artworkId: B.id, repo });
  assert.deepEqual(await pickIds(repo, run.id), [B.id], 'B is the sole keeper');
  // A still exists (the original is never deleted), just no longer selected.
  assert.ok(await repo.getArtwork(A.id));
  assert.equal((await repo.getArtwork(A.id)).status, 'ready');
});

test('approve/reject flips artwork status via updateArtwork', async () => {
  const repo = createMemoryRepo();
  const run = await repo.createRun({ weekOf: '2026-08-10', triggeredBy: 'test' });
  const a = await repo.insertArtwork({ runId: run.id, surface: 'spectacular', style: 'frame_break', mediaType: 'video', specKey: 'spectacular_wow1_8', status: 'ready' });

  assert.equal((await repo.updateArtwork(a.id, { status: 'approved' })).status, 'approved');
  assert.equal((await repo.updateArtwork(a.id, { status: 'rejected' })).status, 'rejected');
});
