// Fixture generation provider.
//
// Synthesizes media locally with FFmpeg's lavfi sources so the ENTIRE pipeline
// (generate → conform → slice → review → deliver) runs end-to-end without
// touching a paid API. The default provider until live keys are confirmed.
//
// The motion fixture deliberately animates a box traveling left→right so that
// when an EON master is sliced, the shape visibly crosses pod boundaries —
// exactly the "traveling illusion" the EON spike needs to validate.

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

export const stillProvider = {
  model: MODEL_STILL,
  /** @returns {Promise<{path, model, width, height}>} */
  async generate({ width, height, output, prompt }) {
    const args = [
      '-y',
      '-f', 'lavfi',
      '-i',
      `gradients=s=${width}x${height}:c0=0x1b2a4a:c1=0xc04a6a:x0=0:y0=0:x1=${width}:y1=${height}`,
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
  async generate({ width, height, durationS = 6, fps = 30, output, prompt }) {
    const box = Math.round(Math.min(width, height) * 0.35);
    const filter =
      `[0][1]overlay=x='(main_w-overlay_w)*(t/${durationS})':` +
      `y=(main_h-overlay_h)/2:shortest=1,format=yuv420p[out]`;
    const args = [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=0x101820:s=${width}x${height}:d=${durationS}:r=${fps}`,
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
