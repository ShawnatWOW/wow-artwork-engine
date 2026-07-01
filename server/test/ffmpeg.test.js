import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import ffmpeg, {
  buildConformArgs,
  buildCropArgs,
  buildFrameBreakArgs,
  buildThumbnailArgs,
} from '../src/services/ffmpeg.js';
import { motionProvider, stillProvider } from '../src/services/generation/fixture.js';

const execFileP = promisify(execFile);
async function hasFfmpeg() {
  try {
    await execFileP('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

// ---- Pure builder tests (no process) ----

test('buildConformArgs cover crops to exact size', () => {
  const args = buildConformArgs({ input: 'in.mp4', output: 'out.mp4', width: 1692, height: 468 });
  const vf = args[args.indexOf('-vf') + 1];
  assert.match(vf, /scale=1692:468:force_original_aspect_ratio=increase/);
  assert.match(vf, /crop=1692:468/);
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('yuv420p'));
});

test('buildConformArgs contain pads instead of cropping', () => {
  const args = buildConformArgs({
    input: 'in.mp4', output: 'out.mp4', width: 256, height: 384, fit: 'contain',
  });
  const vf = args[args.indexOf('-vf') + 1];
  assert.match(vf, /force_original_aspect_ratio=decrease/);
  assert.match(vf, /pad=256:384/);
});

test('buildConformArgs applies duration trim', () => {
  const args = buildConformArgs({
    input: 'in.mp4', output: 'out.mp4', width: 256, height: 384, duration: 15,
  });
  assert.equal(args[args.indexOf('-t') + 1], '15');
});

test('buildConformArgs rejects odd dimensions (yuv420p)', () => {
  assert.throws(() => buildConformArgs({ input: 'i', output: 'o', width: 255, height: 384 }));
});

test('buildCropArgs places the crop at the right offset', () => {
  const args = buildCropArgs({ input: 'm.mp4', output: 'f.mp4', width: 256, height: 384, x: 512 });
  const vf = args[args.indexOf('-vf') + 1];
  assert.equal(vf, 'crop=256:384:512:0');
});

test('buildFrameBreakArgs builds an overlay that overshoots the inner frame', () => {
  const { args, inner, subjY } = buildFrameBreakArgs({
    input: 'subj.mp4', output: 'out.mp4', canvasWidth: 1692, canvasHeight: 468,
    inset: 40, overshoot: 60,
  });
  assert.deepEqual(inner, { width: 1612, height: 388 });
  assert.equal(subjY, -20); // inset(40) - overshoot(60) → above the frame
  const fc = args[args.indexOf('-filter_complex') + 1];
  assert.match(fc, /color=c=black:s=1692x468/);
  assert.match(fc, /overlay=x=40:y=-20/);
});

test('buildThumbnailArgs grabs one frame at the given time', () => {
  const args = buildThumbnailArgs({ input: 'v.mp4', output: 't.jpg', width: 256, height: 384, atSeconds: 2 });
  assert.equal(args[args.indexOf('-ss') + 1], '2');
  assert.equal(args[args.indexOf('-frames:v') + 1], '1');
  assert.equal(args[args.length - 1], 't.jpg');
  const vf = args[args.indexOf('-vf') + 1];
  assert.match(vf, /crop=256:384/);
});

// ---- End-to-end tests (require ffmpeg) ----

test('conform produces an exact-spec H.264 file', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-ff-'));
  try {
    const src = path.join(dir, 'src.mp4');
    await motionProvider.generate({ width: 640, height: 360, durationS: 2, output: src });

    const out = path.join(dir, 'spec.mp4');
    await ffmpeg.conform({ input: src, output: out, width: 1692, height: 468, duration: 1 });

    const probed = await ffmpeg.probe(out);
    assert.equal(probed.width, 1692);
    assert.equal(probed.height, 468);
    assert.ok(probed.duration <= 1.5, `duration ${probed.duration} should be ~1s`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('thumbnail produces a sized still', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-th-'));
  try {
    const src = path.join(dir, 'src.png');
    await stillProvider.generate({ width: 800, height: 600, output: src });
    const out = path.join(dir, 'thumb.jpg');
    await ffmpeg.thumbnail({ input: src, output: out, width: 256, height: 384 });
    const probed = await ffmpeg.probe(out);
    assert.equal(probed.width, 256);
    assert.equal(probed.height, 384);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
