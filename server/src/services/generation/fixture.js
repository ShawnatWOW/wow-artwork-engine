// Fixture generation provider.
//
// Synthesizes media locally with FFmpeg's lavfi sources so the ENTIRE pipeline
// (still → review → animate → conform → slice → deliver) runs end-to-end
// without touching a paid API. The default provider until live keys are set.
//
// - stillProvider: a gradient whose colors are derived from the prompt, so the
//   three style options per surface look visibly different (stand-in for
//   Seedream). It IS the first-frame reference the motion step animates.
// - motionProvider: animates a box traveling left→right; when given a
//   `referenceImage` (the approved still) it uses it as the moving background,
//   mimicking Seedance image-to-video. The travel makes the EON pod-to-pod
//   illusion visible after slicing.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import config from '../../config/index.js';

const execFileP = promisify(execFile);
const FFMPEG = () => config.ffmpeg.ffmpegPath;

async function run(args) {
  await execFileP(FFMPEG(), args, { maxBuffer: 1024 * 1024 * 64 });
}

export const MODEL_STILL = 'fixture:gradient';
export const MODEL_MOTION = 'fixture:traveling-box';

// Two hex colors deterministically derived from the prompt (FNV-1a). Channels
// are clamped to a mid-range so fixture stills always pass the luma QA gate
// (the gate exists to catch real-model failures, not synthetic gradients).
function colorsFromPrompt(prompt) {
  let h = 0x811c9dc5;
  for (const ch of String(prompt || 'wow')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  const mid = (byte) => 0x50 + (byte % 0x60); // each channel in [0x50, 0xAF]
  const hex = (n) => [(n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
    .map((b) => mid(b).toString(16).padStart(2, '0')).join('');
  return [hex(h), hex((h >>> 9) ^ 0x3ad6c2)];
}

export const stillProvider = {
  model: MODEL_STILL,
  /** @returns {Promise<{path, model, width, height, prompt}>} */
  async generate({ width, height, output, prompt }) {
    const [c0, c1] = colorsFromPrompt(prompt);
    const args = [
      '-y',
      '-f', 'lavfi',
      '-i', `gradients=s=${width}x${height}:c0=0x${c0}:c1=0x${c1}:x0=0:y0=0:x1=${width}:y1=${height}`,
      '-frames:v', '1',
      output,
    ];
    await run(args);
    return { path: output, model: MODEL_STILL, width, height, prompt };
  },
};

export const motionProvider = {
  model: MODEL_MOTION,
  /** @returns {Promise<{path, model, width, height, durationS, jobId}>} */
  async generate({ width, height, durationS = 6, fps = 30, output, prompt, referenceImage }) {
    const box = Math.round(Math.min(width, height) * 0.35);

    // Background: the reference still (image-to-video) if provided, else a flat
    // color. Box overlay travels left→right so pod-to-pod travel is visible.
    const bgInput = referenceImage
      ? ['-loop', '1', '-t', String(durationS), '-i', referenceImage]
      : ['-f', 'lavfi', '-i', `color=c=0x101820:s=${width}x${height}:d=${durationS}:r=${fps}`];
    const bgPrep = referenceImage
      ? `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1[bg];`
      : '';
    const bgLabel = referenceImage ? '[bg]' : '[0]';
    const filter =
      `${bgPrep}${bgLabel}[1]overlay=x='(main_w-overlay_w)*(t/${durationS})':` +
      `y=(main_h-overlay_h)/2:shortest=1,format=yuv420p[out]`;

    const args = [
      '-y',
      ...bgInput,
      '-f', 'lavfi',
      '-i', `color=c=0xE0A040:s=${box}x${box}:d=${durationS}:r=${fps}`,
      '-filter_complex', filter,
      '-map', '[out]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
      output,
    ];
    await run(args);
    return {
      path: output,
      model: MODEL_MOTION,
      width,
      height,
      durationS,
      jobId: `fixture-${width}x${height}-${durationS}s`,
      prompt,
    };
  },
};

export default { stillProvider, motionProvider };
