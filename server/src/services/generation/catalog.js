// Generation catalog — WHAT a weekly run produces (Build Plan §4, §5).
//
// Pure data + helpers, no I/O, so it is trivially unit-testable and the
// orchestrator stays a thin coordinator. Two constants:
//   SPECS    — the exact pixel specs (mirrors migrations/002_seed_specs.sql /
//              Build Plan §4). The DB `specs` table remains source of truth;
//              this constant is what the media pipeline conforms to.
//   SURFACES — the generation targets for a week. Each expands into
//              `optionsPerSurface` (locked: 3) options.

import config from '../../config/index.js';

// key → exact output pixels. Locked; do not drift from the seed.
export const SPECS = {
  spectacular_wow1_8: { surface: 'spectacular', width: 1692, height: 468 },
  eon_face: { surface: 'eon', width: 256, height: 384 },
  eon_spine: { surface: 'eon', width: 64, height: 384 },
  eon_master_3pod: { surface: 'eon', width: 768, height: 384 },
};

// Post-processing kinds the orchestrator knows how to run:
//   frame_break → composite subject onto the black canvas (the 3D style)
//   conform     → scale/crop straight to the target spec
//   eon_slice   → conform to the 768x384 master, then slice into 3 faces
export const POST = { FRAME_BREAK: 'frame_break', CONFORM: 'conform', EON_SLICE: 'eon_slice' };

// The surfaces generated every week. `gen` is the ratio/size handed to the
// model (a standard ratio at high res); the pipeline conforms to `specKey`.
// Gen sizes: high-res standard ratios, every dimension >= 960 (Seedream's
// minimum) so live stills keep their exact aspect; FFmpeg conforms downstream.
export const SURFACES = [
  {
    key: 'spectacular',
    surface: 'spectacular',
    specKey: 'spectacular_wow1_8',
    style: 'frame_break', // the WOW signature 3D frame-break look
    mediaType: 'video',
    gen: { kind: 'motion', width: 1920, height: 1080, ratio: '16:9' },
    post: POST.FRAME_BREAK,
  },
  {
    key: 'eon_connected',
    surface: 'eon',
    specKey: 'eon_master_3pod',
    style: 'eon_connected', // one wide master that travels across the 3 pods
    mediaType: 'video',
    gen: { kind: 'motion', width: 2048, height: 1024, ratio: '2:1' },
    post: POST.EON_SLICE,
  },
  {
    key: 'eon_single',
    surface: 'eon',
    specKey: 'eon_face',
    style: 'eon_single', // a standalone single-face piece
    mediaType: 'video',
    gen: { kind: 'motion', width: 1024, height: 1536, ratio: '2:3' },
    post: POST.CONFORM,
  },
];

/**
 * Expand the catalog into a flat job list for one run: every surface × option.
 * Pure. @returns {Array<{ surface, specKey, style, option, spec }>}
 */
export function planJobs({ surfaces = SURFACES, optionsPerSurface = config.optionsPerSurface } = {}) {
  const jobs = [];
  for (const s of surfaces) {
    const spec = SPECS[s.specKey];
    if (!spec) throw new Error(`Unknown spec_key "${s.specKey}" for surface "${s.key}"`);
    for (let option = 1; option <= optionsPerSurface; option += 1) {
      jobs.push({ ...s, option, spec });
    }
  }
  return jobs;
}

export default { SPECS, SURFACES, POST, planJobs };
