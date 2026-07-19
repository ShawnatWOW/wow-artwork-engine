// Month-to-date spend estimate — the dashboard's "what has THIS project cost"
// strip.
//
// Why this exists at all: the fal.ai account is SHARED across WOW Artwork,
// WOW Content Automation, and WOW Broken News. fal's own billing API
// (GET /v1/account/billing, /v1/account/focus) reports the three projects
// COMBINED and cannot isolate artwork. This per-generation estimate — computed
// from what THIS engine actually generated — is the only project-specific
// number. Reconcile the fal account total as an all-projects ceiling, never as
// the artwork figure.
//
// It's itemized per billable fal operation, at fal's real published prices
// (verified 2026-07-19), so it tracks an invoice rather than a blended guess:
//   still            → Seedream v4, $0.03 / image (flat)
//   Seedance seconds → per RAW second; rate depends on tier (std 1080p vs fast
//                      720p), read from the row's model string
//   Topaz seconds    → per second of output, only when the model string records
//                      that the upscale actually ran ('+topaz')
//
// Accuracy rules:
// - Fixtures are free — rows whose model starts with 'fixture' (or was never
//   set, e.g. a guardrail-blocked still that never called an API) are excluded.
// - A motion row bills a Seedance call ONLY if it produced raw output
//   (s3_key_raw set). An EON connected set is 3 rows from ONE call sharing that
//   raw key, so grouping by it bills the set once, not three times. Rows with
//   no raw key never completed a billable generation and are skipped.
// - Seconds are the row's RAW generation length (duration_s). Ping-pong was
//   retired 2026-07-16, so duration_s == raw for all current runs; a handful of
//   pre-retirement 30s ambient rows may read 2x — a negligible historical tail.
// - QA-failed stills still spent (generated on Seedream, then gated) — counted.

import config from '../config/index.js';

/** 'YYYY-MM' for a date-ish value (Date, ISO string, 'YYYY-MM-DD'), else null. */
export function monthKey(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 7);
}

const isLive = (a) => Boolean(a.model) && !String(a.model).startsWith('fixture');
const isFastTier = (model) => /fast/i.test(model || '');
const hasTopaz = (model) => /topaz/i.test(model || '');

/**
 * Estimated spend for one calendar month across all runs.
 * @param {{ repo, month?: string }} opts month defaults to the current month.
 * @returns {Promise<object>} itemized estimate; see `return` below for shape.
 */
export async function computeSpend({ repo, month } = {}) {
  const m = month || monthKey(new Date());
  const rates = config.costs;

  const runs = await repo.listRuns({ limit: 1000 });
  let stillCount = 0;
  // raw key → one Seedance call: { seconds, fast, topaz }. Dedupes EON faces.
  const calls = new Map();

  for (const run of runs) {
    const runMonth = monthKey(run.week_of) || monthKey(run.created_at);
    const artworks = await repo.listArtworks(run.id);
    for (const a of artworks) {
      if (!isLive(a)) continue;
      // Rows predating created_at stamping fall back to the run's week.
      if ((monthKey(a.created_at) || runMonth) !== m) continue;

      if (a.stage === 'still') {
        stillCount += 1;
      } else if (a.stage === 'motion') {
        const key = a.s3_key_raw;
        if (!key) continue; // no raw produced → this call never billed
        const seconds = a.duration_s || config.generation.durationS;
        const rec = calls.get(key) || {
          seconds: 0, fast: isFastTier(a.model), topaz: hasTopaz(a.model),
        };
        rec.seconds = Math.max(rec.seconds, seconds);
        // If any face of the set records Topaz/fast, treat the call that way.
        rec.fast = rec.fast || isFastTier(a.model);
        rec.topaz = rec.topaz || hasTopaz(a.model);
        calls.set(key, rec);
      }
    }
  }

  let seedanceUsd = 0;
  let topazUsd = 0;
  let videoSeconds = 0;
  let topazSeconds = 0;
  for (const rec of calls.values()) {
    const rate = rec.fast ? rates.seedanceFastPerSecondUsd : rates.seedanceStdPerSecondUsd;
    seedanceUsd += rec.seconds * rate;
    videoSeconds += rec.seconds;
    if (rec.topaz) {
      topazUsd += rec.seconds * rates.topazPerSecondUsd;
      topazSeconds += rec.seconds;
    }
  }

  const stillsUsd = stillCount * rates.stillUsd;
  const videosUsd = seedanceUsd + topazUsd; // full per-video cost (gen + upscale)
  const round = (n) => Math.round(n * 100) / 100;
  return {
    month: m,
    estimate: true,
    // Reminder for any UI: fal's account bill covers all three WOW projects.
    sharedAccount: true,
    stills: { count: stillCount, usd: round(stillsUsd) },
    // `videos.usd` is the combined gen+upscale cost so existing UIs stay correct.
    videos: { count: calls.size, seconds: round(videoSeconds), usd: round(videosUsd) },
    // Itemized so the dashboard can show where the money went.
    breakdown: {
      seedance: { seconds: round(videoSeconds), usd: round(seedanceUsd) },
      topaz: { seconds: round(topazSeconds), usd: round(topazUsd) },
    },
    totalUsd: round(stillsUsd + videosUsd),
    rates,
  };
}

export default { computeSpend, monthKey };
