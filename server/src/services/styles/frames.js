// "Watching" a reference (Style Library, 2026-09-14).
//
// A reference can be a still (screenshot, saved image) or a video (an
// Instagram reel, a screen recording). Either way the analyst needs a small
// set of representative frames plus a sense of how much the piece MOVES —
// that motion signature feeds the motion prompt, not just the still.
//
// Frames are sampled uniformly across the clip (scene-change detection alone
// returns nothing for a slow single-shot reel and everything for a montage;
// uniform sampling is representative either way), capped at `maxFrames`, and
// downscaled to 768px so a dozen of them cost cents in vision tokens.
//
// The `build*Args` functions are pure (arg arrays) like ffmpeg.js; the async
// wrappers execute them.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import config from '../../config/index.js';
import { probe } from '../ffmpeg.js';

const execFileP = promisify(execFile);
const FFMPEG = () => config.ffmpeg.ffmpegPath;

export const FRAME_EDGE = 768;      // long edge of an analysis frame
export const THUMB_WIDTH = 640;     // card thumbnail width
const MOTION_SAMPLE_S = 60;         // analyse at most the first minute for motion

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|gif)$/i;
export const isVideoFile = (name = '') => VIDEO_EXT.test(name);

/** Uniformly sample `count` frames across `durationS` seconds. Pure. */
export function buildSampleArgs({ input, outPattern, count, durationS, edge = FRAME_EDGE }) {
  const n = Math.max(1, count);
  const scale = `scale='if(gt(iw,ih),${edge},-2)':'if(gt(iw,ih),-2,${edge})'`;
  if (!durationS || durationS <= 0 || n === 1) {
    // A still image (or an unprobeable clip): one frame.
    return ['-y', '-i', input, '-frames:v', '1', '-vf', scale, '-q:v', '3', outPattern];
  }
  // fps=n/duration lands one frame per equal slice; -frames:v caps the tail.
  return ['-y', '-i', input, '-vf', `fps=${n}/${durationS},${scale}`, '-frames:v', String(n), '-q:v', '3', outPattern];
}

/** A card thumbnail: first frame, fixed width, aspect kept. Pure. */
export function buildThumbArgs({ input, output, width = THUMB_WIDTH }) {
  return ['-y', '-i', input, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '3', output];
}

/**
 * Per-frame scene-change scores for the first minute, written by the
 * metadata filter to a side file (stdout is not safe with `-f null`). Pure.
 */
export function buildMotionArgs({ input, metaFile, seconds = MOTION_SAMPLE_S }) {
  return [
    '-y', '-i', input, '-t', String(seconds),
    '-vf', `scale=320:-2,select='gte(scene,0)',metadata=print:file=${metaFile}`,
    '-an', '-f', 'null', '-',
  ];
}

/**
 * Turn scene scores into the words the analyst (and the motion prompt) can
 * use. Scores are 0..1 differences between consecutive frames: a slow drift
 * sits under 0.02, lively single-shot animation 0.02–0.08, montages/cuts
 * above. Pure; exported for tests.
 */
export function motionSignature(scores) {
  if (!scores.length) return { energy: 'unknown', meanScore: 0, cuts: 0, description: 'a still image' };
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const cuts = scores.filter((s) => s >= 0.3).length;
  let energy = 'slow';
  if (mean >= 0.08 || cuts > 3) energy = 'kinetic';
  else if (mean >= 0.02) energy = 'lively';
  const description = {
    slow: 'slow, drifting, ambient motion — the picture breathes rather than moves',
    lively: 'continuous lively motion — constant flowing movement in one unbroken shot',
    kinetic: cuts > 3
      ? 'fast, punchy and cut-heavy — rapid changes, high energy, hard rhythm'
      : 'fast, kinetic, high-energy motion throughout',
  }[energy];
  return { energy, meanScore: Number(mean.toFixed(4)), cuts, description };
}

async function run(args) {
  try {
    await execFileP(FFMPEG(), args, { maxBuffer: 1024 * 1024 * 64 });
  } catch (err) {
    const tail = (err.stderr || '').toString().split('\n').slice(-6).join('\n');
    throw new Error(`ffmpeg failed: ${err.message}\n${tail}`);
  }
}

/**
 * Extract analysis frames + a card thumbnail + the motion signature.
 * @returns {Promise<{ frames: string[], thumbnail: string, isVideo: boolean,
 *   durationS: number|null, width, height, motion }>}
 */
export async function extractReference({ input, outDir, maxFrames = config.styles.maxFrames, filename = input }) {
  await mkdir(outDir, { recursive: true });
  let info = { width: null, height: null, duration: undefined };
  try { info = await probe(input); } catch { /* an image without a duration is fine */ }
  const durationS = Number.isFinite(info.duration) && info.duration > 0.5 ? info.duration : null;
  const isVideo = Boolean(durationS) || isVideoFile(filename);

  // One frame per second of clip at most — a 6s reel gets 6, a minute gets the cap.
  const count = durationS ? Math.max(1, Math.min(maxFrames, Math.ceil(durationS))) : 1;
  await run(buildSampleArgs({ input, outPattern: path.join(outDir, 'f%02d.jpg'), count, durationS }));
  const frames = (await readdir(outDir)).filter((f) => /^f\d+\.jpg$/.test(f)).sort().map((f) => path.join(outDir, f));
  if (!frames.length) throw new Error('No frames could be read from this file — try a PNG, JPG or MP4.');

  const thumbnail = path.join(outDir, 'thumb.jpg');
  await run(buildThumbArgs({ input, output: thumbnail }));

  let motion = motionSignature([]);
  if (durationS) {
    const metaFile = path.join(outDir, 'motion.txt');
    try {
      await run(buildMotionArgs({ input, metaFile }));
      const text = await readFile(metaFile, 'utf8');
      const scores = [...text.matchAll(/lavfi\.scene_score=([\d.]+)/g)].map((m) => Number(m[1])).filter(Number.isFinite);
      motion = motionSignature(scores);
    } catch {
      motion = { ...motionSignature([]), energy: 'unknown', description: 'motion could not be measured' };
    }
  }

  return { frames, thumbnail, isVideo, durationS, width: info.width ?? null, height: info.height ?? null, motion };
}

/** A width-bound JPEG of any image/video's first frame (aspect kept). */
export async function makeThumb({ input, output, width = THUMB_WIDTH }) {
  await run(buildThumbArgs({ input, output, width }));
  return { output };
}

export default { extractReference, makeThumb, motionSignature, buildSampleArgs, buildThumbArgs, buildMotionArgs, isVideoFile };
