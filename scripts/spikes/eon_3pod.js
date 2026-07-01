#!/usr/bin/env node
// SPIKE — EON 3-pod traveling prototype (Build Plan §7).
//
// Generate one 768x384 master, conform it to spec, slice into three 256x384
// faces, and confirm a shape reads as traveling pod→pod when the three play
// in sequence. The fixture motion animates a box left→right, so after slicing
// the box should appear in pod 1, then pod 2, then pod 3 over time.
//
// Runs entirely on fixtures (no paid APIs). Output in scripts/spikes/out/.
//
//   node scripts/spikes/eon_3pod.js
//
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import ffmpeg from '../../server/src/services/ffmpeg.js';
import { sliceMaster, EON_MASTER, EON_FACE } from '../../server/src/services/eonSlicer.js';
import { getProviders } from '../../server/src/services/generation/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'out', 'eon_3pod');
const DURATION_S = 6;

async function main() {
  await mkdir(OUT, { recursive: true });
  const { motion } = getProviders(); // fixture by default

  // 1. Generate the wide connected master near 2:1, high res.
  const rawMaster = path.join(OUT, 'master_raw.mp4');
  console.log('› generating 2:1 connected master (fixture)…');
  await motion.generate({ width: 1536, height: 768, durationS: DURATION_S, output: rawMaster });

  // 2. Conform to the exact eon_master_3pod spec (768x384).
  const master = path.join(OUT, 'master_768x384.mp4');
  console.log('› conforming master to 768x384…');
  await ffmpeg.conform({
    input: rawMaster,
    output: master,
    width: EON_MASTER.width,
    height: EON_MASTER.height,
    duration: DURATION_S,
  });

  // 3. Slice into three 256x384 faces.
  console.log('› slicing into three 256x384 faces…');
  const faces = await sliceMaster({ masterPath: master, outDir: OUT, duration: DURATION_S });

  // 4. Build a side-by-side "sequence" proof so the travel reads in one file
  //    (the dashboard shows the three pods side by side before sending).
  const sequence = path.join(OUT, 'sequence_side_by_side.mp4');
  console.log('› stitching faces side-by-side for the travel check…');
  await stitchSideBySide(faces.map((f) => f.path), sequence, DURATION_S);

  // 5. Verify every face matches spec.
  let allOk = true;
  console.log('\n✓ EON 3-pod outputs:');
  for (const face of faces) {
    const p = await ffmpeg.probe(face.path);
    const ok = p.width === EON_FACE.width && p.height === EON_FACE.height;
    allOk = allOk && ok;
    console.log(`  pod ${face.pod}: ${face.path}  ${p.width}x${p.height} ${ok ? 'OK' : 'MISMATCH'}`);
  }
  console.log(`  master:   ${master}`);
  console.log(`  sequence: ${sequence}  (box should cross pod1→pod2→pod3)`);
  if (!allOk) process.exit(1);
}

// Lay the three faces side by side with a gap, matching how the pods sit on
// the EON network, so the traveling illusion can be eyeballed in one clip.
async function stitchSideBySide(facePaths, output, duration) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileP = promisify(execFile);
  const gap = 24;
  const w = EON_FACE.width;
  const h = EON_FACE.height;
  const totalW = w * 3 + gap * 2;
  const filter = [
    `color=c=0x000000:s=${totalW}x${h}:d=${duration}:r=30[bg]`,
    `[bg][0:v]overlay=x=0:y=0[a]`,
    `[a][1:v]overlay=x=${w + gap}:y=0[b]`,
    `[b][2:v]overlay=x=${(w + gap) * 2}:y=0,format=yuv420p[out]`,
  ].join(';');
  const args = [
    '-y',
    '-i', facePaths[0], '-i', facePaths[1], '-i', facePaths[2],
    '-filter_complex', filter,
    '-map', '[out]',
    '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    output,
  ];
  await execFileP('ffmpeg', args, { maxBuffer: 1024 * 1024 * 64 });
}

main().catch((err) => {
  console.error('EON 3-pod spike failed:', err.message);
  process.exit(1);
});
