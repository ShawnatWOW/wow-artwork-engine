import { test } from 'node:test';
import assert from 'node:assert/strict';

import config from '../src/config/index.js';
import { directStory } from '../src/services/generation/director.js';

test('directStory: no key or no image -> null, no network call, never throws', async () => {
  const saved = config.openai.apiKey;
  try {
    config.openai.apiKey = '';
    assert.equal(await directStory({ imageUrl: 'https://x/img.png' }), null);
    config.openai.apiKey = 'k';
    assert.equal(await directStory({ imageUrl: null }), null);
  } finally {
    config.openai.apiKey = saved;
  }
});

test('directStory: shot-list vocabulary in the LLM output is rejected (template fallback)', async () => {
  const saved = { key: config.openai.apiKey, fetch: globalThis.fetch };
  const respond = (story) => async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ story }) } }] }),
  });
  try {
    config.openai.apiKey = 'test-key';
    // A story that smuggles in an edit list must be refused...
    globalThis.fetch = respond('The fish swims for 5 seconds then we cut to the shark biting it hard and everything ends');
    assert.equal(await directStory({ imageUrl: 'https://x/img.png' }), null);
    // ...while a clean story passes through verbatim.
    const clean = 'The fish darts through the painted seaweed as the shark hunts it from the deep, weaving to the frame and back until the shark finally strikes';
    globalThis.fetch = respond(clean);
    assert.equal(await directStory({ imageUrl: 'https://x/img.png' }), clean);
  } finally {
    config.openai.apiKey = saved.key;
    globalThis.fetch = saved.fetch;
  }
});
