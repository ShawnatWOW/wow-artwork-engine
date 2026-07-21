// Canonical fal.ai price book — the single source of truth for what a fal
// generation costs, shared (by copy) across every WOW project that bills the
// same fal account: WOW Artwork + WOW Content Automation. (WOW Broken News
// does NOT use fal — it's an OpenAI/Gemini bill — so it does not use this.)
//
// WHY THIS EXISTS: the three dashboards each grew their own rate card and they
// disagreed — Content Automation priced the Seedance /fast tier at $0.022/s
// (~11x too low), Artwork used a flat $0.10/s, etc. One shared account with
// divergent estimates = the "singular insane cost" nobody could reconcile.
//
// HOW fal ACTUALLY BILLS (verified 2026-07-19 against fal model pages):
//   Seedance 2.0 (video)  — token formula, NOT a flat per-second rate:
//       tokens = (width * height * durationS * 24) / 1024
//       cost   = tokens/1000 * ratePer1k
//     The 24 is fal's fixed multiplier (a frame-equivalent constant, not the
//     clip's real fps). ratePer1k depends on tier: standard $0.014, fast
//     $0.0112. Because it's pixel-based it prices ANY aspect exactly — which
//     matters here: our billboards are 21:9 and 2:3, never 16:9, so a flat
//     per-second rate is always wrong.
//   Topaz upscale (video) — per second of OUTPUT, tiered by output pixels:
//       <=720p $0.01, <=1080p $0.02, >1080p (our 4K) $0.08; x2 at >=60fps.
//   Seedream v4 (still)   — flat $0.03 per image.
//
// Every rate is overridable via env so the book tracks fal without a deploy.
// KEEP IN SYNC with wow-contract-query/server/modules/pricing/falPricing.js.

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

// fal's fixed token multiplier in the Seedance formula (not the clip fps).
export const SEEDANCE_TOKEN_MULTIPLIER = 24;
export const SEEDANCE_TOKENS_PER_UNIT = 1024;

// $ per 1,000 tokens by Seedance tier. Verified: standard 720p -> $0.3024/s,
// standard 1080p -> $0.682/s, fast 720p -> $0.2419/s.
export const SEEDANCE_RATE_PER_1K = {
  standard: num(process.env.FAL_PRICE_SEEDANCE_STD_PER_1K, 0.014),
  fast: num(process.env.FAL_PRICE_SEEDANCE_FAST_PER_1K, 0.0112),
};

// Topaz upscale $ per output second, tiered by output resolution (megapixels).
export const TOPAZ_PER_SECOND = {
  sd: num(process.env.FAL_PRICE_TOPAZ_SD_PER_S, 0.01), // <=720p
  hd: num(process.env.FAL_PRICE_TOPAZ_HD_PER_S, 0.02), // <=1080p
  uhd: num(process.env.FAL_PRICE_TOPAZ_UHD_PER_S, 0.08), // >1080p (our 4K path)
};

export const SEEDREAM_PER_IMAGE = num(process.env.FAL_PRICE_SEEDREAM_PER_IMAGE, 0.03);

// Pixel thresholds for the Topaz tier (1080p and 720p reference pixel counts).
const PX_1080P = 1920 * 1080;
const PX_720P = 1280 * 720;

const round4 = (n) => Math.round(n * 1e4) / 1e4;

/** Seedance tier from a model string ('...fast...' -> fast, else standard). */
export function seedanceTier(model = '') {
  return /fast/i.test(model) ? 'fast' : 'standard';
}

/** True if a model string records that the Topaz upscale ran ('+topaz'). */
export function usedTopaz(model = '') {
  return /topaz/i.test(model);
}

/** fal's Seedance token count for an output clip. Pure. */
export function seedanceTokens({ width, height, durationS }) {
  return (width * height * durationS * SEEDANCE_TOKEN_MULTIPLIER) / SEEDANCE_TOKENS_PER_UNIT;
}

/**
 * Exact Seedance USD for one clip at its real output dimensions + duration.
 * @param {{width:number,height:number,durationS:number,tier?:'standard'|'fast'}} o
 */
export function seedanceCostUsd({ width, height, durationS, tier = 'standard' }) {
  if (!width || !height || !durationS) return 0;
  const rate = SEEDANCE_RATE_PER_1K[tier] ?? SEEDANCE_RATE_PER_1K.standard;
  return round4((seedanceTokens({ width, height, durationS }) / 1000) * rate);
}

/**
 * Exact Topaz upscale USD for one clip, tiered by OUTPUT pixels.
 * @param {{width:number,height:number,durationS:number,fps?:number}} o
 */
export function topazCostUsd({ width, height, durationS, fps = 30 }) {
  if (!width || !height || !durationS) return 0;
  const px = width * height;
  const perSec = px > PX_1080P ? TOPAZ_PER_SECOND.uhd : px > PX_720P ? TOPAZ_PER_SECOND.hd : TOPAZ_PER_SECOND.sd;
  const mult = fps >= 60 ? 2 : 1;
  return round4(perSec * durationS * mult);
}

/** Seedream still USD. Flat per image. */
export function seedreamCostUsd({ count = 1 } = {}) {
  return round4(count * SEEDREAM_PER_IMAGE);
}

// Pixel budget fal targets per tier: standard renders ~1080p-class (2.07MP),
// fast ~720p-class (0.92MP). Seedance downscales our 4K gen target to this tier,
// so the BILLED pixels are this budget in the clip's aspect — NOT the 4K final
// dims (those are what Topaz bills). Keeping the budget in the real aspect is
// what makes an ultra-wide 21:9 clip correctly cost more than a 16:9 one.
const TIER_PIXEL_BUDGET = { standard: 1920 * 1080, fast: 1280 * 720 };

/**
 * The dimensions Seedance actually renders (and bills) for a clip of a given
 * aspect at a given tier: the tier's pixel budget, shaped to `aspect` (W/H),
 * rounded to even. Pure.
 */
export function renderDimsForTier(aspect, tier = 'standard') {
  const budget = TIER_PIXEL_BUDGET[tier] ?? TIER_PIXEL_BUDGET.standard;
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const height = even(Math.sqrt(budget / aspect));
  const width = even(aspect * height);
  return { width, height };
}

// Canonical 16:9 dims for a fal resolution string — for callers (e.g. Content
// Automation) that only know the resolution tier, not exact output pixels.
const RESOLUTION_DIMS = {
  '480p': { width: 854, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

/** Output dims for a resolution string ('720p'…), defaulting to 720p. Pure. */
export function dimsForResolution(resolution = '720p') {
  return RESOLUTION_DIMS[resolution] || RESOLUTION_DIMS['720p'];
}

/**
 * Extract the fal request_id from a status_url like
 * https://queue.fal.run/<app>/requests/<id>/status — the reconciliation key.
 * Returns null if not a fal queue URL.
 */
export function requestIdFromStatusUrl(statusUrl = '') {
  const m = String(statusUrl).match(/\/requests\/([^/]+)/);
  return m ? m[1] : null;
}

/**
 * Total USD for one finished video: Seedance generation (+ Topaz upscale if it
 * ran). Itemized so a dashboard can show where the money went. `outWidth/Height`
 * are the FINAL (upscaled) dims; `genWidth/Height` are the Seedance render dims
 * — pass them separately because Seedance bills the 1080p render, Topaz bills
 * the 4K output. When only final dims are known, pass them as both.
 */
export function videoCostUsd({
  genWidth, genHeight, outWidth, outHeight, durationS, tier = 'standard', topaz = false, fps = 30,
}) {
  const seedance = seedanceCostUsd({ width: genWidth, height: genHeight, durationS, tier });
  const upscale = topaz ? topazCostUsd({ width: outWidth, height: outHeight, durationS, fps }) : 0;
  return { seedance, topaz: upscale, total: round4(seedance + upscale) };
}

/**
 * Verified reference per-second rates at canonical resolutions — for display,
 * sanity checks, and tests. Derived from the formulas above, NOT authoritative
 * on their own (the formulas are). Keep these matching fal's published page.
 */
export const REFERENCE_PER_SECOND = {
  seedance_standard_720p: seedanceCostUsd({ width: 1280, height: 720, durationS: 1, tier: 'standard' }),
  seedance_standard_1080p: seedanceCostUsd({ width: 1920, height: 1080, durationS: 1, tier: 'standard' }),
  seedance_fast_720p: seedanceCostUsd({ width: 1280, height: 720, durationS: 1, tier: 'fast' }),
  topaz_uhd: TOPAZ_PER_SECOND.uhd,
  seedream_still: SEEDREAM_PER_IMAGE,
};

export default {
  seedanceTier, usedTopaz, seedanceTokens, seedanceCostUsd, topazCostUsd,
  seedreamCostUsd, renderDimsForTier, dimsForResolution, videoCostUsd,
  requestIdFromStatusUrl, REFERENCE_PER_SECOND,
  SEEDANCE_RATE_PER_1K, TOPAZ_PER_SECOND, SEEDREAM_PER_IMAGE,
};
