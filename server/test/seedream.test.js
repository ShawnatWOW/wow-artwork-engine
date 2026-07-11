import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fitDims } from '../src/services/generation/seedream.js';
import { SURFACES } from '../src/services/generation/catalog.js';

test('fitDims scales proportionally into [960, 4096] without distorting ratio', () => {
  // Too small on one axis → scale up, ratio preserved.
  const up = fitDims(1536, 768);
  assert.equal(up.width / up.height, 2);
  assert.ok(up.height >= 960);
  // Already in range → untouched.
  assert.deepEqual(fitDims(2048, 1024), { width: 2048, height: 1024 });
  // Too large → scale down under 4096.
  const down = fitDims(8192, 4096);
  assert.ok(down.width <= 4096 && down.height <= 4096);
  assert.equal(down.width / down.height, 2);
});

test('every catalog gen size is already Seedream-valid (no scaling surprises live)', () => {
  for (const s of SURFACES) {
    const fitted = fitDims(s.gen.width, s.gen.height);
    assert.deepEqual(fitted, { width: s.gen.width, height: s.gen.height },
      `${s.key} gen ${s.gen.width}x${s.gen.height} would be rescaled to ${fitted.width}x${fitted.height}`);
  }
});
