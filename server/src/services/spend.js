// Month-to-date spend estimate — the dashboard's "what has this cost us" strip.
//
// Computed from what the engine actually generated (no provider billing API):
//   still  → flat rate per live Seedream image
//   video  → rate per second of RAW Seedance output
// Estimates only; rates are env-tunable (COST_STILL_USD, COST_VIDEO_PER_SECOND_USD)
// so they can track fal's pricing without a code change.
//
// Accuracy details that matter:
// - Fixture generations are free — rows whose model starts with 'fixture' (or
//   was never set, e.g. guardrail-blocked before spend) are excluded.
// - An EON connected set is 3 artwork rows from ONE Seedance call (the sliced
//   master) — motion rows are grouped by their shared raw key so a set bills
//   once, not three times.
// - Ping-pong surfaces store the DOUBLED final duration (a 15s clip loops out
//   to 30s); billing uses the raw seconds, so those are halved.
// - QA-failed stills still spent (generated, then gated) — they count.

import config from '../config/index.js';
import { SURFACES } from './generation/catalog.js';

const PINGPONG_STYLES = new Set(SURFACES.filter((s) => s.loop === 'pingpong').map((s) => s.style));

/** 'YYYY-MM' for a date-ish value (Date, ISO string, 'YYYY-MM-DD'), else null. */
export function monthKey(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 7);
}

const isLive = (a) => Boolean(a.model) && !String(a.model).startsWith('fixture');

/**
 * Estimated spend for one calendar month across all runs.
 * @param {{ repo, month?: string }} opts month defaults to the current month.
 * @returns {Promise<{month, stills:{count,usd}, videos:{count,seconds,usd}, totalUsd, rates, estimate:true}>}
 */
export async function computeSpend({ repo, month } = {}) {
  const m = month || monthKey(new Date());
  const rates = config.costs;

  const runs = await repo.listRuns({ limit: 1000 });
  let stillCount = 0;
  const videoCalls = new Map(); // raw key → billed seconds (one Seedance call)

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
        const key = a.s3_key_raw || `motion-${a.id}`;
        const finalS = a.duration_s || config.generation.durationS;
        const rawS = PINGPONG_STYLES.has(a.style) ? finalS / 2 : finalS;
        videoCalls.set(key, Math.max(videoCalls.get(key) || 0, rawS));
      }
    }
  }

  const videoSeconds = [...videoCalls.values()].reduce((s, v) => s + v, 0);
  const stillsUsd = stillCount * rates.stillUsd;
  const videosUsd = videoSeconds * rates.videoPerSecondUsd;
  const round = (n) => Math.round(n * 100) / 100;
  return {
    month: m,
    estimate: true,
    stills: { count: stillCount, usd: round(stillsUsd) },
    videos: { count: videoCalls.size, seconds: round(videoSeconds), usd: round(videosUsd) },
    totalUsd: round(stillsUsd + videosUsd),
    rates,
  };
}

export default { computeSpend, monthKey };
