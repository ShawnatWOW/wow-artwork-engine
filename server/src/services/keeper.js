// "Keep & explore" keeper mechanics — the single-anchor-per-family rules the
// /keep and /promote endpoints enforce. Pulled out of the route so it is
// unit-testable with an injected repo (same inject-everything pattern as the
// orchestrator); the routes are thin HTTP wrappers over these.
//
// KEEPER (anchor) of a family = the family member that has a selections row.
// Exactly one per family. A FAMILY = designs sharing family_id (bootstrapped to
// the anchor's own id the first time it is kept/varied).

import { getRepo } from '../db/index.js';

// Remove the selection from every member of `artwork`'s family — optionally
// keeping one. Scoped to the run (family_id is unique within a run). A still
// that has never been kept/varied (family_id null) is a family of one: itself.
async function clearFamilySelections(repo, artwork, { exceptId = null } = {}) {
  const members = await repo.listArtworks(artwork.run_id);
  for (const m of members) {
    const inFamily = artwork.family_id ? m.family_id === artwork.family_id : m.id === artwork.id;
    if (inFamily && m.id !== exceptId) await repo.removeSelection(m.id);
  }
}

/**
 * Anchor a liked still as its family's keeper. Only stills can be kept. The
 * first keep bootstraps the family (family_id = the still's own id); selecting
 * it demotes any other keeper in the same family so there is exactly one.
 * @returns {Promise<object>} the updated artwork row.
 * @throws  {Error & {code}} not_a_still | artwork_not_found
 */
export async function keepArtwork({ artworkId, selectedBy = null, repo = getRepo() }) {
  const artwork = await repo.getArtwork(artworkId);
  if (!artwork) throw Object.assign(new Error('artwork_not_found'), { code: 'artwork_not_found' });
  if (artwork.stage !== 'still') throw Object.assign(new Error('Only style designs can be kept.'), { code: 'not_a_still' });

  // Bootstrap the family: a plain still becomes the anchor of its own family the
  // first time it is kept, so future variations can share the family_id.
  const familyId = artwork.family_id || artwork.id;
  const updated = await repo.updateArtwork(artworkId, { familyId });
  await repo.addSelection(artworkId, selectedBy);
  // Single keeper per family: drop the selection on every OTHER member.
  await clearFamilySelections(repo, updated, { exceptId: artworkId });
  return updated;
}

/**
 * Promote any family member (typically a variation) to be THE keeper: clear the
 * whole family's selections, then select this one. The original is never lost —
 * only the anchor's selection moves.
 * @returns {Promise<object>} the updated artwork row.
 * @throws  {Error & {code}} artwork_not_found
 */
export async function promoteArtwork({ artworkId, selectedBy = null, repo = getRepo() }) {
  const artwork = await repo.getArtwork(artworkId);
  if (!artwork) throw Object.assign(new Error('artwork_not_found'), { code: 'artwork_not_found' });
  await clearFamilySelections(repo, artwork);
  await repo.addSelection(artworkId, selectedBy);
  return repo.getArtwork(artworkId);
}

export default { keepArtwork, promoteArtwork };
