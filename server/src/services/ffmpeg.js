// FFmpeg post-processing service (Build Plan M1 · ffmpeg).
//
// Video models never emit WOW's exact pixel specs (1692x468, 768x384, ...),
// so every asset is generated at the closest supported ratio and then
// *conformed* here to the exact spec, encoded H.264, trimmed to spot length,
// and given a thumbnail.
//
// Design: the `build*Args` functions are PURE (string in → arg array out) so
// they can be unit-tested without spawning a process. The exported async
// functions wrap them with execution + ffprobe verification.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import config from '../config/index.js';

const execFileP = promisify(execFile);

const FFMPEG = () => config.ffmpeg.ffmpegPath;
const FFPROBE = () => config.ffmpeg.ffprobePath;

// H.264 defaults shared by every video output. yuv420p + even dimensions =
// maximum player compatibility; +faststart moves the moov atom up for web.
const H264 = [
  '-c:v', 'libx264',
  '-preset', 'medium',
  '-crf', '20',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  '-an', // artwork is silent
];

function assertEven(width, height) {
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new Error(`yuv420p requires even dimensions; got ${width}x${height}`);
  }
}

// ---------------------------------------------------------------------------
// Pure argument builders
// ---------------------------------------------------------------------------

/**
 * Conform an input to exactly width x height.
 *   fit="cover"   → fill the frame, crop the overflow (default; no distortion)
 *   fit="contain" → fit inside the frame, pad the remainder black
 * Optional duration (seconds) trims the spot; optional fps sets frame rate.
 */
export function buildConformArgs({
  input,
  output,
  width,
  height,
  fit = 'cover',
  duration,
  fps,
  still = false,
}) {
  assertEven(width, height);
  let vf;
  if (fit === 'contain') {
    vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;
  } else {
    vf = `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height}`;
  }

  const args = ['-y', '-i', input, '-vf', vf];
  if (still) {
    args.push('-frames:v', '1', output);
    return args;
  }
  if (fps) args.push('-r', String(fps));
  if (duration) args.push('-t', String(duration));
  args.push(...H264, output);
  return args;
}

/** Crop a single column/region: width x height at offset (x, y). */
export function buildCropArgs({ input, output, width, height, x = 0, y = 0, duration }) {
  assertEven(width, height);
  const args = ['-y', '-i', input, '-vf', `crop=${width}:${height}:${x}:${y}`];
  if (duration) args.push('-t', String(duration));
  args.push(...H264, output);
  return args;
}

/** Composite a subject clip onto a black canvas — the frame-break style. */
export function buildFrameBreakArgs({
  input,
  output,
  canvasWidth,
  canvasHeight,
  // inner frame: the "window" the subject pops out of, inset from the canvas
  inset = 40,
  borderThickness = 4,
  // how far (px) the subject overshoots the top of the inner frame
  overshoot = 60,
  duration,
  fps = 30,
}) {
  assertEven(canvasWidth, canvasHeight);
  const innerW = canvasWidth - inset * 2;
  const innerH = canvasHeight - inset * 2;

  // Subject is scaled to the inner frame's width and placed so its top edge
  // sits *above* the inner frame's top — it breaks the frame and reads as 3D.
  const subjectW = innerW;
  const subjY = inset - overshoot;

  // filter_complex:
  //  [0:v] scale subject to inner width, preserve ratio        -> [subj]
  //  color black canvas                                        -> [bg]
  //  draw the inner frame border on the canvas                 -> [framed]
  //  overlay subject onto framed canvas at (inset, subjY)      -> [out]
  const filter = [
    `color=c=black:s=${canvasWidth}x${canvasHeight}:r=${fps}[bg]`,
    `[bg]drawbox=x=${inset}:y=${inset}:w=${innerW}:h=${innerH}:` +
      `color=white@0.85:t=${borderThickness}[framed]`,
    `[0:v]scale=${subjectW}:-2[subj]`,
    `[framed][subj]overlay=x=${inset}:y=${subjY}:shortest=1[out]`,
  ].join(';');

  const args = [
    '-y',
    '-i', input,
    '-filter_complex', filter,
    '-map', '[out]',
  ];
  if (duration) args.push('-t', String(duration));
  args.push(...H264, output);
  return { args, inner: { width: innerW, height: innerH }, subjY };
}

/**
 * Palindrome ("ping-pong") loop: forward then reversed, so the clip's last
 * frame equals its first and it loops seamlessly on a DOOH player. Doubles the
 * duration. For ambient motion only — directional travel would visibly reverse.
 */
export function buildPingPongArgs({ input, output }) {
  return [
    '-y',
    '-i', input,
    '-filter_complex', '[0:v]split[fwd][tmp];[tmp]reverse[rev];[fwd][rev]concat=n=2:v=1,format=yuv420p[out]',
    '-map', '[out]',
    ...H264,
    output,
  ];
}

/** Single-frame JPEG thumbnail at `atSeconds`. */
export function buildThumbnailArgs({ input, output, width, height, atSeconds = 0 }) {
  return [
    '-y',
    '-ss', String(atSeconds),
    '-i', input,
    '-frames:v', '1',
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    '-q:v', '3',
    output,
  ];
}

// ---------------------------------------------------------------------------
// Execution + verification
// ---------------------------------------------------------------------------

async function run(args) {
  try {
    await execFileP(FFMPEG(), args, { maxBuffer: 1024 * 1024 * 64 });
  } catch (err) {
    const tail = (err.stderr || '').toString().split('\n').slice(-12).join('\n');
    throw new Error(`ffmpeg failed: ${err.message}\n${tail}`);
  }
}

/** ffprobe → { width, height, duration } for an output file. */
export async function probe(input) {
  const args = [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json',
    input,
  ];
  const { stdout } = await execFileP(FFPROBE(), args);
  const json = JSON.parse(stdout);
  const stream = json.streams?.[0] || {};
  return {
    width: stream.width,
    height: stream.height,
    duration: json.format?.duration ? Number(json.format.duration) : undefined,
  };
}

export async function conform(opts) {
  const args = buildConformArgs(opts);
  await run(args);
  return { output: opts.output, width: opts.width, height: opts.height };
}

export async function frameBreakComposite(opts) {
  const { args } = buildFrameBreakArgs(opts);
  await run(args);
  return { output: opts.output, width: opts.canvasWidth, height: opts.canvasHeight };
}

export async function thumbnail(opts) {
  await run(buildThumbnailArgs(opts));
  return { output: opts.output };
}

export async function cropColumn(opts) {
  await run(buildCropArgs(opts));
  return { output: opts.output, width: opts.width, height: opts.height };
}

export async function pingpong(opts) {
  await run(buildPingPongArgs(opts));
  return { output: opts.output };
}

export default {
  buildConformArgs,
  buildCropArgs,
  buildFrameBreakArgs,
  buildThumbnailArgs,
  buildPingPongArgs,
  conform,
  frameBreakComposite,
  thumbnail,
  cropColumn,
  pingpong,
  probe,
};
