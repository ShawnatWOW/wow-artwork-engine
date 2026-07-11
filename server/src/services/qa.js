// Automated art QA gates (art-director review, 2026-07-10).
//
// Two cheap FFmpeg-based measurements that catch the failure modes the first
// live run actually produced:
//   - lumaGate(still):   average luma outside [55, 200] is unreadable outdoors
//                        (too dark washes out in sun; near-white reads blank).
//                        Blocks a still BEFORE the reviewer sees it.
//   - satDrift(video):   Seedance saturation drains over a clip; compare the
//                        first vs last frame's average saturation and WARN when
//                        the drop is visible (the loop restart "flashes" color).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import config from '../config/index.js';

const execFileP = promisify(execFile);
const FFMPEG = () => config.ffmpeg.ffmpegPath;

// Calibration (2026-07-10, second live run): billboards are EMISSIVE — a
// bright subject on a deep black background is classic LED art and can average
// luma 25–55 while being perfectly readable. Only near-black mud hard-fails;
// the dark-but-plausible zone gets a WARNING and reaches the reviewer.
export const LUMA_HARD_MIN = 25;
export const LUMA_WARN_BELOW = 55;
export const LUMA_MAX = 200;
export const SAT_DRIFT_WARN = 0.3; // warn when >30% of the starting saturation is lost

async function signalstats(args) {
  // signalstats emits per-frame metadata lines on stderr via metadata=print.
  const { stderr } = await execFileP(FFMPEG(), args, { maxBuffer: 1024 * 1024 * 16 });
  return stderr;
}

function parseStat(out, key) {
  const m = [...String(out).matchAll(new RegExp(`lavfi\\.signalstats\\.${key}=([0-9.]+)`, 'g'))];
  if (!m.length) throw new Error(`ffmpeg signalstats produced no ${key}`);
  return Number(m[m.length - 1][1]);
}

/** Average luma (0-255) of an image. */
export async function measureLuma(imagePath) {
  const out = await signalstats([
    '-i', imagePath,
    '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG',
    '-frames:v', '1', '-f', 'null', '-',
  ]);
  return parseStat(out, 'YAVG');
}

/**
 * Gate a still on outdoor readability.
 * @returns {{ok, yavg, warn?, reason?}} — ok:false blocks; warn surfaces an
 * amber note on an otherwise-ready card (reviewer decides).
 */
export async function lumaGate(imagePath, { hardMin = LUMA_HARD_MIN, warnBelow = LUMA_WARN_BELOW, max = LUMA_MAX } = {}) {
  const yavg = await measureLuma(imagePath);
  if (yavg < hardMin) return { ok: false, yavg, reason: `average luma ${yavg.toFixed(0)}/255 — near-black mud, unreadable in daylight` };
  if (yavg > max) return { ok: false, yavg, reason: `average luma ${yavg.toFixed(0)}/255 — near-white, reads as a blank panel at distance` };
  if (yavg < warnBelow) {
    return { ok: true, yavg, warn: true, reason: `dark scene (avg luma ${yavg.toFixed(0)}/255) — strong on an LED sign at night, double-check daytime readability` };
  }
  return { ok: true, yavg };
}

/** Average saturation of one frame at `at` seconds (or 'last'). */
async function frameSat(videoPath, at) {
  const seek = at === 'last' ? ['-sseof', '-0.3'] : ['-ss', String(at)];
  const out = await signalstats([
    ...seek, '-i', videoPath,
    '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.SATAVG',
    '-frames:v', '1', '-f', 'null', '-',
  ]);
  return parseStat(out, 'SATAVG');
}

/**
 * Measure saturation drift across a clip. @returns {{first, last, drop, warn, reason?}}
 * drop = fraction of starting saturation lost by the final frame.
 */
export async function satDrift(videoPath, { warnAt = SAT_DRIFT_WARN } = {}) {
  const first = await frameSat(videoPath, 0.1);
  const last = await frameSat(videoPath, 'last');
  const drop = first > 1 ? Math.max(0, (first - last) / first) : 0;
  const warn = drop > warnAt;
  return {
    first, last, drop, warn,
    ...(warn ? { reason: `saturation fades ${(drop * 100).toFixed(0)}% over the clip — colors drain; consider re-animating` } : {}),
  };
}

export default { measureLuma, lumaGate, satDrift, LUMA_HARD_MIN, LUMA_WARN_BELOW, LUMA_MAX, SAT_DRIFT_WARN };
