#!/usr/bin/env node
// SPIKE — Frame-break prototype (Build Plan §7).
//
// Generate one Spectacular subject clip, then composite it onto the
// 1692x468 black canvas with the subject crossing the inner border so it
// reads as 3D depth (the black border is the style, not a workaround).
//
// Runs entirely on fixtures (no paid APIs). Output lands in scripts/spikes/out/.
//
//   node scripts/spikes/frame_break.js
//
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import ffmpeg from '../../server/src/services/ffmpeg.js';
import { getProviders } from '../../server/src/services/generation/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'out', 'frame_break');

const SPEC = { width: 1692, height: 468 }; // spectacular_wow1_8
const DURATION_S = 6;

async function main() {
  await mkdir(OUT, { recursive: true });
  const { still, motion } = getProviders(); // fixture by default

  // 1. Generate the subject scene at a high-res standard ratio (16:9 here).
  //    A real run would prompt Seedance/Nano Banana; the fixture stands in.
  const subject = path.join(OUT, 'subject.mp4');
  console.log('› generating subject clip (fixture)…');
  await motion.generate({ width: 1280, height: 720, durationS: DURATION_S, output: subject });

  // 2. Composite onto the 1692x468 black canvas, subject overshooting the
  //    inner frame's top edge — the frame-break pop-out.
  const final = path.join(OUT, 'spectacular_frame_break.mp4');
  console.log('› compositing onto 1692x468 black canvas…');
  await ffmpeg.frameBreakComposite({
    input: subject,
    output: final,
    canvasWidth: SPEC.width,
    canvasHeight: SPEC.height,
    inset: 48,
    borderThickness: 5,
    overshoot: 70,
    duration: DURATION_S,
  });

  // 3. Thumbnail for the dashboard grid.
  const thumb = path.join(OUT, 'thumb.jpg');
  await ffmpeg.thumbnail({ input: final, output: thumb, width: 564, height: 156, atSeconds: 2 });

  // 4. Verify the output matches spec exactly.
  const probed = await ffmpeg.probe(final);
  const ok = probed.width === SPEC.width && probed.height === SPEC.height;
  console.log(`\n✓ frame-break output: ${final}`);
  console.log(`  dimensions: ${probed.width}x${probed.height} (expected ${SPEC.width}x${SPEC.height}) ${ok ? 'OK' : 'MISMATCH'}`);
  console.log(`  duration:   ${probed.duration?.toFixed(2)}s`);
  console.log(`  thumbnail:  ${thumb}`);
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error('frame-break spike failed:', err.message);
  process.exit(1);
});
