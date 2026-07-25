#!/usr/bin/env node
// SPIKE — EON 3-pod traveling prototype (Build Plan §7).
//
// Generate one wrapped master, conform it to spec, cut it into every pod's
// spine + face, and confirm a shape reads as traveling pod→pod when they play
// in sequence. The fixture motion animates a box left→right, so after slicing
// the box should appear in pod 1, then pod 2, then pod 3 over time — crossing
// each pod's spine on its way in.
//
// Runs entirely on fixtures (no paid APIs). Output in scripts/spikes/out/.
//
//   node scripts/spikes/eon_3pod.js
//
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import ffmpeg from '../../server/src/services/ffmpeg.js';
import { sliceMaster, EON_MASTER, POD_COUNT } from '../../server/src/services/eonSlicer.js';
import { SPECS } from '../../server/src/services/generation/catalog.js';
import { getProviders } from '../../server/src/services/generation/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'out', 'eon_3pod');
const DURATION_S = 6;

async function main() {
  await mkdir(OUT, { recursive: true });
  const { motion } = getProviders(); // fixture by default

  // 1. Generate the wide connected master at the wrapped 2.5:1 aspect.
  const rawMaster = path.join(OUT, 'master_raw.mp4');
  console.log('› generating 2.5:1 wrapped master (fixture)…');
  await motion.generate({ width: 1920, height: 768, durationS: DURATION_S, output: rawMaster });

  // 2. Conform to the exact eon_master_3pod spec.
  const master = path.join(OUT, `master_${EON_MASTER.width}x${EON_MASTER.height}.mp4`);
  console.log(`› conforming master to ${EON_MASTER.width}x${EON_MASTER.height}…`);
  await ffmpeg.conform({
    input: rawMaster,
    output: master,
    width: EON_MASTER.width,
    height: EON_MASTER.height,
    duration: DURATION_S,
  });

  // 3. Cut every pod's spine + face out of it.
  console.log(`› cutting ${POD_COUNT} pods into spine + face…`);
  const panels = await sliceMaster({ masterPath: master, outDir: OUT, duration: DURATION_S });

  // 4. Build a side-by-side "sequence" proof so the travel reads in one file
  //    (this is the layout the dashboard shows before sending).
  const sequence = path.join(OUT, 'sequence_side_by_side.mp4');
  console.log('› stitching pods side-by-side for the travel + wrap check…');
  await stitchSideBySide(panels, sequence, DURATION_S);

  // 5. Verify every panel matches its own spec.
  let allOk = true;
  console.log('\n✓ EON 3-pod outputs:');
  for (const panel of panels) {
    const spec = SPECS[panel.specKey];
    const p = await ffmpeg.probe(panel.path);
    const ok = p.width === spec.width && p.height === spec.height;
    allOk = allOk && ok;
    console.log(`  ${panel.label.padEnd(11)}: ${panel.path}  ${p.width}x${p.height} ${ok ? 'OK' : 'MISMATCH'}`);
  }
  console.log(`  master:   ${master}`);
  console.log(`  sequence: ${sequence}  (box should cross pod1→pod2→pod3, over each spine on the way)`);
  if (!allOk) process.exit(1);
}

// Lay the pods side by side the way they physically stand: each pod's spine
// hard against its face (they meet at a corner, no gap), with a gap between
// pods — so both the pod→pod travel and the corner wrap can be eyeballed in
// one clip.
async function stitchSideBySide(panels, output, duration) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileP = promisify(execFile);
  const gap = 24;
  const h = SPECS.eon_face.height;

  // Walk the panels left to right, opening a gap whenever a new pod starts.
  let x = 0;
  const placed = panels.map((panel, i) => {
    if (i > 0 && panel.kind === 'spine') x += gap; // new pod
    const at = x;
    x += panel.width;
    return { panel, x: at };
  });

  const filter = [`color=c=0x000000:s=${x}x${h}:d=${duration}:r=30[bg]`];
  placed.forEach(({ x: at }, i) => {
    const from = i === 0 ? '[bg]' : `[v${i - 1}]`;
    const to = i === placed.length - 1 ? ',format=yuv420p[out]' : `[v${i}]`;
    filter.push(`${from}[${i}:v]overlay=x=${at}:y=0${to}`);
  });

  const args = [
    '-y',
    ...placed.flatMap(({ panel }) => ['-i', panel.path]),
    '-filter_complex', filter.join(';'),
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
