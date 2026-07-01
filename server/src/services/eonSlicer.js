// EON slicer (Build Plan M1 · ffmpeg).
//
// An EON "connected" piece is generated as one wide 2:1 master
// (eon_master_3pod, 768x384). The three pods each display a 256-wide column,
// so a shape choreographed to cross the column boundaries reads as traveling
// from pod to pod. This module splits one master into three aligned faces.

import path from 'node:path';
import ffmpeg from './ffmpeg.js';

export const EON_FACE = { width: 256, height: 384 };
export const EON_MASTER = { width: 768, height: 384 };
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
 * Slice a 768x384 master video into three 256x384 face files.
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
