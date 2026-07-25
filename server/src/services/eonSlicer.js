// EON slicer (Build Plan M1 · ffmpeg · spine-aware since 2026-07-25).
//
// An EON pod is a wrapped 3D surface: a narrow LED **spine** down its left
// side plus its **face** (WOW template spec sheet — face 256x384, spine 64x384
// panel-native). Artwork is generated as ONE continuous panorama covering every
// pod slab side by side, then cut into the individual panels here, so the art
// genuinely wraps around each corner rather than the spine being bolted on.
//
// Layout of the master, left to right as a driver sees it:
//
//   |spine1|   face1   |spine2|   face2   |spine3|   face3   |
//   |<------ pod 1 --->|<------ pod 2 --->|<------ pod 3 --->|
//
// A pod slab is spine + face wide, so an N-pod master is N x POD_WIDTH. For
// the 3-pod master that puts the pod boundaries at exactly 1/3 and 2/3 of the
// frame — which is what lets the 3-act choreography in prompts.js ("one act
// per third") line up with the physical structure.
//
// Dimensions derive from the catalog SPECS (4K-class since 2026-07-14) so the
// slicer can never drift from the delivery spec.

import path from 'node:path';
import ffmpeg from './ffmpeg.js';
import { SPECS, EON_POD, POD_WIDTH } from './generation/catalog.js';

export const EON_FACE = { width: SPECS.eon_face.width, height: SPECS.eon_face.height };
export const EON_SPINE = { width: SPECS.eon_spine.width, height: SPECS.eon_spine.height };
export const EON_MASTER = { width: SPECS.eon_master_3pod.width, height: SPECS.eon_master_3pod.height };
export const POD_COUNT = 3;
export { POD_WIDTH };

/** Stable panel id — used for storage keys, the artworks.panel column and Jeff's filenames. */
export const panelLabel = ({ pod, kind }) => `pod${pod}_${kind}`;

/**
 * Compute the crop rectangle for every panel of an N-pod master.
 * Pure + testable. Validates that the master is exactly N pod slabs wide, so a
 * mis-sized master can never be silently mis-cut.
 * @returns {Array<{pod, kind, specKey, label, x, y, width, height}>} left to right
 */
export function computePanelCrops({ pods = POD_COUNT, masterWidth } = {}) {
  const width = masterWidth ?? pods * POD_WIDTH;
  if (width !== pods * POD_WIDTH) {
    throw new Error(
      `EON master width ${width} must equal ${POD_WIDTH} x ${pods} = ${pods * POD_WIDTH} ` +
        `(one pod = spine ${EON_SPINE.width} + face ${EON_FACE.width})`,
    );
  }
  const panels = [];
  for (let pod = 1; pod <= pods; pod += 1) {
    let x = (pod - 1) * POD_WIDTH;
    for (const { kind, specKey } of EON_POD) {
      const spec = SPECS[specKey];
      panels.push({ pod, kind, specKey, label: panelLabel({ pod, kind }), x, y: 0, width: spec.width, height: spec.height });
      x += spec.width;
    }
  }
  return panels;
}

/**
 * Cut a conformed master video into its individual spine + face files.
 * @returns {Promise<Array<{pod, kind, specKey, label, path, x, width, height}>>}
 */
export async function sliceMaster({ masterPath, outDir, basename = 'eon', pods = POD_COUNT, duration }) {
  const expected = pods * POD_WIDTH;
  const master = await ffmpeg.probe(masterPath);
  if (master.width && master.width !== expected) {
    // Conform-then-slice is the production path; here we fail loudly so a
    // mis-sized master is caught rather than silently mis-cropped.
    throw new Error(
      `Master is ${master.width}x${master.height}; expected ${expected}x${SPECS.eon_face.height}. ` +
        'Conform the master to spec before slicing.',
    );
  }

  const panels = [];
  for (const crop of computePanelCrops({ pods, masterWidth: expected })) {
    const output = path.join(outDir, `${basename}_${crop.label}.mp4`);
    await ffmpeg.cropColumn({
      input: masterPath,
      output,
      width: crop.width,
      height: crop.height,
      x: crop.x,
      y: crop.y,
      duration,
    });
    panels.push({ ...crop, path: output });
  }
  return panels;
}

export default { EON_FACE, EON_SPINE, EON_MASTER, POD_COUNT, POD_WIDTH, panelLabel, computePanelCrops, sliceMaster };
