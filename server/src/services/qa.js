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

export const LUMA_MIN = 55;
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

/** Gate a still on outdoor readability. @returns {{ok, yavg, reason?}} */
export async function lumaGate(imagePath, { min = LUMA_MIN, max = LUMA_MAX } = {}) {
  const yavg = await measureLuma(imagePath);
  if (yavg < min) return { ok: false, yavg, reason: `average luma ${yavg.toFixed(0)}/255 — too dark to read in direct sunlight` };
  if (yavg > max) return { ok: false, yavg, reason: `average luma ${yavg.toFixed(0)}/255 — near-white, reads as a blank panel at distance` };
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

export default { measureLuma, lumaGate, satDrift, LUMA_MIN, LUMA_MAX, SAT_DRIFT_WARN };
