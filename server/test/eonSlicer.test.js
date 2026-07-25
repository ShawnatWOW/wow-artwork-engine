import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  computePanelCrops, sliceMaster, EON_FACE, EON_SPINE, EON_MASTER, POD_WIDTH,
} from '../src/services/eonSlicer.js';
import { SPECS } from '../src/services/generation/catalog.js';
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

test('computePanelCrops cuts each pod into its spine then its face, left to right', () => {
  const crops = computePanelCrops();
  assert.equal(crops.length, 6); // 3 pods x (spine + face)
  assert.deepEqual(crops.map((c) => c.label), [
    'pod1_spine', 'pod1_face', 'pod2_spine', 'pod2_face', 'pod3_spine', 'pod3_face',
  ]);
  // Offsets tile the master with no gaps and no overlap.
  assert.deepEqual(crops.map((c) => c.x), [
    0, EON_SPINE.width,
    POD_WIDTH, POD_WIDTH + EON_SPINE.width,
    POD_WIDTH * 2, POD_WIDTH * 2 + EON_SPINE.width,
  ]);
  const last = crops[crops.length - 1];
  assert.equal(last.x + last.width, EON_MASTER.width);
  assert.ok(crops.every((c) => c.height === EON_FACE.height));
});

test('computePanelCrops handles a single pod (the standalone pillar master)', () => {
  const crops = computePanelCrops({ pods: 1 });
  assert.deepEqual(crops.map((c) => c.label), ['pod1_spine', 'pod1_face']);
  assert.deepEqual(crops.map((c) => c.width), [EON_SPINE.width, EON_FACE.width]);
  assert.equal(crops[1].x + crops[1].width, SPECS.eon_master_pod.width);
});

test('computePanelCrops rejects a master that is not a whole number of pods', () => {
  assert.throws(() => computePanelCrops({ pods: 3, masterWidth: 3840 }), /must equal/);
});

test('sliceMaster produces spec-sized spine + face panels from a 3-pod master', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-eon-'));
  try {
    const master = path.join(dir, 'master.mp4');
    await motionProvider.generate({
      width: EON_MASTER.width, height: EON_MASTER.height, durationS: 2, output: master,
    });

    const panels = await sliceMaster({ masterPath: master, outDir: dir, duration: 2 });
    assert.equal(panels.length, 6);
    for (const panel of panels) {
      const probed = await ffmpeg.probe(panel.path);
      const spec = SPECS[panel.specKey];
      assert.equal(probed.width, spec.width, `${panel.label} width`);
      assert.equal(probed.height, spec.height, `${panel.label} height`);
    }
    assert.deepEqual(panels.map((p) => p.pod), [1, 1, 2, 2, 3, 3]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sliceMaster produces a spine + face from a single-pod master', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-eon-solo-'));
  try {
    const master = path.join(dir, 'master.mp4');
    const spec = SPECS.eon_master_pod;
    await motionProvider.generate({ width: spec.width, height: spec.height, durationS: 2, output: master });

    const panels = await sliceMaster({ masterPath: master, outDir: dir, pods: 1, duration: 2 });
    assert.deepEqual(panels.map((p) => p.label), ['pod1_spine', 'pod1_face']);
    const spine = await ffmpeg.probe(panels[0].path);
    assert.equal(spine.width, EON_SPINE.width);
    assert.equal(spine.height, EON_SPINE.height);
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
    await assert.rejects(
      () => sliceMaster({ masterPath: master, outDir: dir }),
      new RegExp(`expected ${EON_MASTER.width}x`),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
