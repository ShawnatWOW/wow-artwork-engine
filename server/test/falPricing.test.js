import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  seedanceCostUsd, topazCostUsd, seedreamCostUsd, videoCostUsd,
  seedanceTier, usedTopaz, REFERENCE_PER_SECOND,
} from '../src/services/generation/falPricing.js';

// Within a cent of fal's published per-second numbers (the whole point: our
// formula must reproduce fal's real billing, not a guess).
const near = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test('Seedance token formula reproduces fal\'s verified per-second prices', () => {
  // Standard tier: 720p -> $0.3024/s, 1080p -> $0.682/s.
  near(seedanceCostUsd({ width: 1280, height: 720, durationS: 1, tier: 'standard' }), 0.3024);
  near(seedanceCostUsd({ width: 1920, height: 1080, durationS: 1, tier: 'standard' }), 0.682);
  // Fast tier: 720p -> $0.2419/s.
  near(seedanceCostUsd({ width: 1280, height: 720, durationS: 1, tier: 'fast' }), 0.2419);
});

test('Seedance scales linearly with duration and pixels (any aspect, not just 16:9)', () => {
  const oneSec = seedanceCostUsd({ width: 1920, height: 1080, durationS: 1, tier: 'standard' });
  near(seedanceCostUsd({ width: 1920, height: 1080, durationS: 15, tier: 'standard' }), oneSec * 15);
  // Ultra-wide 21:9-ish at "1080p class" costs by its true pixels, not a flat rate.
  const wide = seedanceCostUsd({ width: 2560, height: 1080, durationS: 1, tier: 'standard' });
  near(wide, seedanceCostUsd({ width: 1920, height: 1080, durationS: 1 }) * (2560 / 1920));
});

test('Topaz tiers by output pixels; our 4K path is the >1080p rate', () => {
  // 3840x1062 (spectacular 4K) and 1280x1920 (EON 4K) are both >1080p pixels -> $0.08/s.
  near(topazCostUsd({ width: 3840, height: 1062, durationS: 1 }), 0.08);
  near(topazCostUsd({ width: 1280, height: 1920, durationS: 1 }), 0.08);
  // A 1280x720 output is the cheap tier.
  near(topazCostUsd({ width: 1280, height: 720, durationS: 1 }), 0.01);
  // 60fps doubles.
  near(topazCostUsd({ width: 3840, height: 1062, durationS: 1, fps: 60 }), 0.16);
});

test('a full 15s 4K video itemizes to ~$11.40 (Seedance 1080p + Topaz 4K)', () => {
  const c = videoCostUsd({
    genWidth: 1920, genHeight: 1080, outWidth: 3840, outHeight: 1062,
    durationS: 15, tier: 'standard', topaz: true,
  });
  near(c.seedance, 10.23, 0.05); // 15 * 0.682
  near(c.topaz, 1.20, 0.01); // 15 * 0.08
  near(c.total, 11.43, 0.05);
});

test('Seedream still is flat $0.03/image', () => {
  assert.equal(seedreamCostUsd({ count: 1 }), 0.03);
  assert.equal(seedreamCostUsd({ count: 9 }), 0.27);
});

test('model-string helpers pick tier and detect Topaz', () => {
  assert.equal(seedanceTier('seedance-2.0@fal'), 'standard');
  assert.equal(seedanceTier('bytedance/seedance-2.0/fast/image-to-video'), 'fast');
  assert.equal(usedTopaz('seedance-2.0@fal+topaz2x'), true);
  assert.equal(usedTopaz('seedance-2.0@fal'), false);
});

test('reference table matches the verified fal page', () => {
  near(REFERENCE_PER_SECOND.seedance_standard_720p, 0.3024);
  near(REFERENCE_PER_SECOND.seedance_standard_1080p, 0.682);
  near(REFERENCE_PER_SECOND.seedance_fast_720p, 0.2419);
  assert.equal(REFERENCE_PER_SECOND.topaz_uhd, 0.08);
  assert.equal(REFERENCE_PER_SECOND.seedream_still, 0.03);
});
