import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { computeFaceCrops, sliceMaster, EON_FACE, EON_MASTER } from '../src/services/eonSlicer.js';
import ffmpeg from '../src/services/ffmpeg.js';
import { motionProvider } from '../src/services/generation/fixture.js';

const execFileP = promisify(execFile);
async function hasFfmpeg() {
  try {
    await execFileP('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

test('computeFaceCrops splits 768 into three aligned 256-wide faces', () => {
  const crops = computeFaceCrops();
  assert.equal(crops.length, 3);
  assert.deepEqual(crops.map((c) => c.x), [0, 256, 512]);
  assert.ok(crops.every((c) => c.width === EON_FACE.width && c.height === EON_FACE.height));
});

test('computeFaceCrops rejects a master that does not divide evenly', () => {
  assert.throws(() => computeFaceCrops(700));
});

test('sliceMaster produces three aligned 256x384 faces from a 768x384 master', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-eon-'));
  try {
    const master = path.join(dir, 'master.mp4');
    await motionProvider.generate({
      width: EON_MASTER.width, height: EON_MASTER.height, durationS: 2, output: master,
    });

    const faces = await sliceMaster({ masterPath: master, outDir: dir, duration: 2 });
    assert.equal(faces.length, 3);
    for (const face of faces) {
      const probed = await ffmpeg.probe(face.path);
      assert.equal(probed.width, 256);
      assert.equal(probed.height, 384);
    }
    assert.deepEqual(faces.map((f) => f.pod), [1, 2, 3]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sliceMaster rejects a mis-sized master', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-eon-bad-'));
  try {
    const master = path.join(dir, 'bad.mp4');
    await motionProvider.generate({ width: 640, height: 384, durationS: 1, output: master });
    await assert.rejects(() => sliceMaster({ masterPath: master, outDir: dir }), /expected 768x384/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
