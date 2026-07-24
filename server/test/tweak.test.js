import { test } from 'node:test';
import assert from 'node:assert/strict';

import config from '../src/config/index.js';
import { refineTweak } from '../src/services/generation/tweak.js';

// refineTweak must NEVER throw and must NEVER hit the network without a key —
// with no OpenAI key a tweak degrades to a labeled re-roll (original prompt kept,
// the instruction becomes the change note). We force the no-key path by blanking
// config.openai.apiKey (read at call time), so this test never touches OpenAI.
test('refineTweak: no API key → returns the original prompt + instruction note, never throws', async () => {
  const saved = config.openai.apiKey;
  config.openai.apiKey = '';
  try {
    const original = 'A calm teal spiral filling the frame, high-contrast lighting.';
    const r = await refineTweak({ prompt: original, instruction: 'make it red', style: 'eon_single' });
    assert.equal(r.prompt, original, 'original prompt preserved verbatim');
    assert.equal(r.changeNote, 'make it red', 'instruction becomes the change note');
  } finally {
    config.openai.apiKey = saved;
  }
});

test('refineTweak: empty inputs fall back without a network call', async () => {
  const saved = config.openai.apiKey;
  config.openai.apiKey = 'sk-test-should-not-be-used';
  try {
    // No prompt / no instruction → short-circuits to the fallback (no fetch).
    assert.deepEqual(await refineTweak({ prompt: '', instruction: 'x' }), { prompt: '', changeNote: 'x' });
    assert.deepEqual(await refineTweak({ prompt: 'keep me', instruction: '  ' }), { prompt: 'keep me', changeNote: '' });
  } finally {
    config.openai.apiKey = saved;
  }
});
