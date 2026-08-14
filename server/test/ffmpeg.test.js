import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import ffmpeg, {
  buildConformArgs,
  buildFramePlateArgs,
  buildFramePlateFilter,
  applyFramePlate,
  buildCropArgs,
  buildFrameBreakArgs,
  buildThumbnailArgs,
  buildLastFrameArgs,
  buildConcatArgs,
} from '../src/services/ffmpeg.js';
import { motionProvider, stillProvider } from '../src/services/generation/fixture.js';

const execFileP = promisify(execFile);
// Run ffmpeg directly (fixtures for the plate tests); capture stderr for probes.
const run = (args) => execFileP('ffmpeg', args, { maxBuffer: 1024 * 1024 * 64 });
const runCapture = (args) => execFileP('ffmpeg', args, { maxBuffer: 1024 * 1024 * 64 }).catch((e) => e);
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

test('buildLastFrameArgs seeks from the end and keeps the final decoded frame', () => {
  const args = buildLastFrameArgs({ input: 'a.mp4', output: 'last.png' });
  // -sseof BEFORE -i (input option), -update so the last write wins.
  assert.ok(args.indexOf('-sseof') < args.indexOf('-i'));
  assert.equal(args[args.indexOf('-sseof') + 1], '-0.5');
  assert.ok(args.includes('-update'));
  assert.equal(args.at(-1), 'last.png');
});

test('buildConcatArgs joins segments with a filter concat and re-encode', () => {
  const args = buildConcatArgs({ inputs: ['a.mp4', 'b.mp4'], output: 'joined.mp4', fps: 30 });
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.equal(filter, '[0:v][1:v]concat=n=2:v=1:a=0[out]');
  assert.ok(args.includes('libx264')); // re-encode, never stream-copy across encoders
  assert.equal(args.at(-1), 'joined.mp4');
  assert.throws(() => buildConcatArgs({ inputs: ['only.mp4'], output: 'x.mp4' }), /at least 2/);
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

// ---------------------------------------------------------------------------
// Frame plate (Scott, 2026-08-07): the spectacular's perimeter band is
// COMPOSITED, never generated — models paint frames as scenery inside the
// picture, so only compositing guarantees the outermost pixels are black and
// the piece sits flush against the billboard structure's bezel.

test('buildFramePlateFilter: solid perimeter band + stepped depth, exact dims', () => {
  const vf = buildFramePlateFilter({ width: 3840, height: 1062, band: 52 });
  const boxes = vf.split(',');
  assert.equal(boxes.length, 4); // solid band + 3 depth steps
  assert.match(boxes[0], /^drawbox=x=0:y=0:w=3840:h=1062:t=52:color=black@1$/);
  // depth steps sit INSIDE the band and fade
  assert.match(boxes[1], /color=black@0\.55/);
  assert.match(boxes[3], /color=black@0\.15/);
});

test('frame plate: outer band probes pure black on a bright still and a video', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-plate-'));
  try {
    const W = 1280; const H = 354; const BAND = 18;

    const stripLuma = async (input, crop) => {
      // signalstats emits per-frame metadata on stderr via metadata=print
      // (same probe qa.js uses); average across frames.
      const { stderr } = await runCapture(['-i', input, '-vf', `crop=${crop},signalstats,metadata=print:key=lavfi.signalstats.YAVG`, '-f', 'null', '-']);
      const m = [...String(stderr).matchAll(/lavfi\.signalstats\.YAVG=([0-9.]+)/g)];
      assert.ok(m.length, 'probe produced YAVG');
      return m.reduce((sum, x) => sum + Number(x[1]), 0) / m.length;
    };

    // A worst-case WHITE canvas: any perimeter leak shows up as luma.
    const white = path.join(dir, 'white.png');
    await run(['-y', '-f', 'lavfi', '-i', `color=c=white:s=${W}x${H}`, '-frames:v', '1', white]);
    const framed = path.join(dir, 'framed.png');
    await applyFramePlate({ input: white, output: framed, width: W, height: H, band: BAND, still: true });

    // Outermost half-band strips: pure black (allow codec noise).
    assert.ok(await stripLuma(framed, `${W}:${BAND / 2}:0:0`) < 20, 'top band black');
    assert.ok(await stripLuma(framed, `${W}:${BAND / 2}:0:${H - BAND / 2}`) < 20, 'bottom band black');
    assert.ok(await stripLuma(framed, `${BAND / 2}:${H}:0:0`) < 22, 'left band black');
    // Center untouched: still white.
    assert.ok(await stripLuma(framed, `100:100:${W / 2 - 50}:${H / 2 - 50}`) > 200, 'center untouched');

    // Video: band present on first AND last frame of a bright clip.
    const clip = path.join(dir, 'clip.mp4');
    await run(['-y', '-f', 'lavfi', '-i', `color=c=white:s=${W}x${H}:d=1:r=10`, '-pix_fmt', 'yuv420p', clip]);
    const framedClip = path.join(dir, 'framed.mp4');
    await applyFramePlate({ input: clip, output: framedClip, width: W, height: H, band: BAND });
    assert.ok(await stripLuma(framedClip, `${W}:${BAND / 2}:0:0`) < 22, 'video band black across frames');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('computeBarCrop: pure geometry — letterbox, pillarbox, and no-bars cases', () => {
  const AR = 3840 / 1062; // the spectacular
  // Seedance letterboxes the wide art in a taller canvas: strip top/bottom only.
  const lb = ffmpeg.computeBarCrop({ rawWidth: 1824, rawHeight: 1080, wantAspect: AR });
  assert.equal(lb.bars, 'horizontal');
  assert.equal(lb.width, 1824, 'letterbox never touches width');
  assert.equal(lb.x, 0);
  assert.ok(Math.abs(lb.height - 1824 / AR) <= 2);
  assert.ok(lb.y > 0 && lb.y * 2 + lb.height <= 1080);
  // Pillarbox: strip left/right only.
  const pb = ffmpeg.computeBarCrop({ rawWidth: 2000, rawHeight: 400, wantAspect: 4 });
  assert.equal(pb.bars, 'vertical');
  assert.equal(pb.height, 400);
  assert.equal(pb.width, 1600);
  assert.equal(pb.x, 200);
  // Near-match -> no bars to strip.
  assert.equal(ffmpeg.computeBarCrop({ rawWidth: 3840, rawHeight: 1062, wantAspect: AR }), null);
  assert.equal(ffmpeg.computeBarCrop({ rawWidth: 0, rawHeight: 100, wantAspect: AR }), null);
});
