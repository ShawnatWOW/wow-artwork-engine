// EON slicer (Build Plan M1 · ffmpeg).
//
// An EON "connected" piece is generated as one wide 2:1 master
// (eon_master_3pod). The three pods each play one third of its width, so a
// shape choreographed to cross the column boundaries reads as traveling from
// pod to pod. This module splits one master into three aligned faces.
// Dimensions derive from the catalog SPECS (4K-class since 2026-07-14) so the
// slicer can never drift from the delivery spec.

import path from 'node:path';
import ffmpeg from './ffmpeg.js';
import { SPECS } from './generation/catalog.js';

export const EON_FACE = { width: SPECS.eon_face.width, height: SPECS.eon_face.height };
export const EON_MASTER = { width: SPECS.eon_master_3pod.width, height: SPECS.eon_master_3pod.height };
export const POD_COUNT = 3;

/**
 * Compute the crop offsets for each face given a master width.
 * Pure + testable. Validates the master divides evenly into POD_COUNT faces.
 */
export function computeFaceCrops(masterWidth = EON_MASTER.width, faceWidth = EON_FACE.width) {
  if (masterWidth !== faceWidth * POD_COUNT) {
    throw new Error(
      `EON master width ${masterWidth} must equal ${faceWidth} x ${POD_COUNT} = ${faceWidth * POD_COUNT}`,
    );
  }
  return Array.from({ length: POD_COUNT }, (_, i) => ({
    pod: i + 1,
    x: i * faceWidth,
    y: 0,
    width: faceWidth,
    height: EON_FACE.height,
  }));
}

/**
 * Slice a conformed master video into three aligned face files.
 * @returns {Promise<Array<{pod, path, x, width, height}>>}
 */
export async function sliceMaster({ masterPath, outDir, basename = 'eon_face', duration }) {
  const master = await ffmpeg.probe(masterPath);
  if (master.width && master.width !== EON_MASTER.width) {
    // Conform-then-slice is the production path; here we fail loudly so a
    // mis-sized master is caught rather than silently mis-cropped.
    throw new Error(
      `Master is ${master.width}x${master.height}; expected ${EON_MASTER.width}x${EON_MASTER.height}. ` +
        'Conform the master to spec before slicing.',
    );
  }

  const crops = computeFaceCrops();
  const faces = [];
  for (const crop of crops) {
    const output = path.join(outDir, `${basename}_pod${crop.pod}.mp4`);
    await ffmpeg.cropColumn({
      input: masterPath,
      output,
      width: crop.width,
      height: crop.height,
      x: crop.x,
      y: crop.y,
      duration,
    });
    faces.push({ pod: crop.pod, path: output, x: crop.x, width: crop.width, height: crop.height });
  }
  return faces;
}

export default { EON_FACE, EON_MASTER, POD_COUNT, computeFaceCrops, sliceMaster };
