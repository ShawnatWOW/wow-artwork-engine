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

// --- Seedance moderation refusal → plain language (2026-08-26) --------------

import { videoUrlOf } from '../src/services/generation/fal.js';

test('videoUrlOf translates a content_policy_violation into reviewer language', () => {
  const refusal = {
    detail: [{
      loc: ['body', 'image_url'],
      msg: 'The images or videos provided may contain likenesses of real people or other private information that cannot be processed.',
      type: 'content_policy_violation',
    }],
  };
  assert.throws(() => videoUrlOf(refusal, 'Seedance'),
    /looks too much like a real person[\s\S]*Replace or Tweak/,
    'the card must say what happened and what fixes it');
  // Other failures keep the raw detail path.
  assert.throws(() => videoUrlOf({ detail: 'boom' }, 'Seedance'), /returned no video url: boom/);
  // A good result still returns its url.
  assert.equal(videoUrlOf({ video: { url: 'https://v/x.mp4' } }, 'Seedance'), 'https://v/x.mp4');
});
