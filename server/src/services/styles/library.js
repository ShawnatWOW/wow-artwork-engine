// The Style Library (Shawn, 2026-09-14): the pool every design rolls from,
// now a table instead of a code constant. Scott adds styles from artwork he
// likes (services/styles/ingest.js) and they join the roll beside the 28
// built-ins — or he names one outright for any option slot.
//
// This module is the seam between the repo rows and prompts.styleFor: it
// seeds the built-ins, loads the enabled pool, and resolves what ONE design
// wears given the reviewer's pick (a key, "favorites", or random) and the
// keys it must avoid (its siblings, last batch's looks).

import { STYLE_POOL, styleFor } from '../generation/prompts.js';

// Fixed spelling of what a reviewer can ask for in a slot besides a key.
export const RANDOM = 'random';
export const FAVORITES = 'favorites';

/** A repo row → the shape prompts.js consumes. Pure. */
export function toLook(row) {
  const cast = row.cast && typeof row.cast === 'object' ? row.cast : {};
  const an = row.analysis && typeof row.analysis === 'object' ? row.analysis : {};
  return {
    id: row.id ?? null,
    key: row.key,
    label: row.label,
    style: row.style,
    cast: { keeper: cast.keeper ?? '', hero: cast.hero ?? '', companion: cast.companion ?? '' },
    favorite: Boolean(row.favorite),
    weight: Number(row.weight ?? 1) || 1,
    sourceType: row.source_type ?? 'builtin',
    // The STYLE LOCK (2026-09-15): the analyst's non-negotiable rules,
    // backdrop and colour rule — prompts.js writes them into every still so a
    // reference's treatment survives the scene boilerplate. Empty for the
    // built-ins (their sentence is the whole card), so their prompts are
    // unchanged.
    signature: Array.isArray(an.signature) ? an.signature.filter(Boolean).slice(0, 6) : [],
    backdrop: an.backdrop || '',
    colorRule: an.color_rule || '',
    palette: Array.isArray(an.palette) ? an.palette.slice(0, 6) : [],
  };
}

/** A look is usable only once it has a prompt sentence and a full cast. */
export function isComplete(row) {
  const c = row.cast || {};
  return Boolean(row.style && c.keeper && c.hero && c.companion);
}

/**
 * Seed the code pool into the table — insert-if-missing, never overwrite, so
 * a built-in the reviewer edited, favourited or disabled keeps that state.
 * Idempotent and cheap (one list + N misses); called at boot and before
 * every pool load.
 */
export async function ensureBuiltins(repo) {
  const have = new Set((await repo.listStyles()).map((r) => r.key));
  let added = 0;
  for (const s of STYLE_POOL) {
    if (have.has(s.key)) continue;
    await repo.insertStyle({ key: s.key, label: s.label, style: s.style, cast: s.cast, sourceType: 'builtin', status: 'ready' });
    added += 1;
  }
  return added;
}

/**
 * The library as generation sees it: `pool` = enabled + complete looks in
 * table order (the roll indexes into it, so order is part of determinism);
 * `byKey` = every complete look, disabled ones included, so an explicit pick
 * of a disabled style still works ("disabled" only removes it from the roll).
 */
export async function loadLibrary(repo) {
  await ensureBuiltins(repo);
  const rows = (await repo.listStyles()).filter((r) => r.status === 'ready' && isComplete(r));
  const all = rows.map(toLook);
  return {
    pool: all.filter((l, i) => rows[i].enabled !== false),
    byKey: new Map(all.map((l) => [l.key, l])),
  };
}

/**
 * Normalize the reviewer's picks from a request body into
 * { [surfaceKey]: { [option]: key | 'favorites' | 'random' } }. Accepts the
 * per-slot map the batch composer sends and tolerates junk (unknown surfaces
 * pass through — the orchestrator only reads the ones it plans). Pure.
 */
export function parsePicks(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [surface, slots] of Object.entries(input)) {
    if (!slots || typeof slots !== 'object') continue;
    const m = {};
    for (const [opt, v] of Object.entries(slots)) {
      const n = Number(opt);
      const key = String(v ?? '').trim();
      if (!Number.isInteger(n) || n < 1 || !key) continue;
      m[n] = key;
    }
    if (Object.keys(m).length) out[surface] = m;
  }
  return out;
}

/**
 * What one design wears. Explicit key → that style (even if disabled);
 * 'favorites' → a deterministic roll over the favourites (the whole pool if
 * there are none); anything else → the pool roll, skipping `exclude`.
 * Returns null only when the pool is empty (nothing enabled at all).
 */
export function resolveLook({ library, specKey, option, weekOf, pick, exclude = new Set() }) {
  const { pool, byKey } = library;
  const want = String(pick ?? RANDOM).trim();
  if (want && want !== RANDOM && want !== FAVORITES) {
    const hit = byKey.get(want);
    if (hit) return hit;
    // An unknown key (deleted since the composer loaded) falls through to a
    // random roll rather than failing the whole batch.
  }
  if (want === FAVORITES) {
    const favs = pool.filter((l) => l.favorite);
    if (favs.length) return styleFor({ specKey, option, weekOf, pool: favs, exclude });
  }
  return styleFor({ specKey, option, weekOf, pool, exclude });
}

/**
 * Keys a batch should avoid for one surface: the looks its OTHER live options
 * already wear (so three options are three worlds) plus, when the pool has
 * room, the looks that surface wore in the previous batch (so the same style
 * doesn't come straight back next week). Pure.
 */
export function excludeFor({ poolSize, taken = [], previous = [], slots = 1 }) {
  const ex = new Set(taken.filter(Boolean));
  const withPrev = new Set([...ex, ...previous.filter(Boolean)]);
  // Only honour the "not last week" rule when enough styles remain to fill
  // every slot with something new; otherwise it would exclude the pool.
  return poolSize - withPrev.size >= slots ? withPrev : ex;
}

export default { toLook, isComplete, ensureBuiltins, loadLibrary, parsePicks, resolveLook, excludeFor, RANDOM, FAVORITES };
