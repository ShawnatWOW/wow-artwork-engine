import test from 'node:test';
import assert from 'node:assert/strict';
import { chatBody } from '../src/services/openaiChat.js';

test('newer families: no temperature, max_completion_tokens, a thinking level', () => {
  const b = chatBody('gpt-6-luna', { max_tokens: 800, temperature: 0.2, response_format: { type: 'json_object' }, messages: [] });
  assert.equal(b.model, 'gpt-6-luna');
  assert.equal(b.max_tokens, undefined);
  assert.equal(b.temperature, undefined);
  assert.equal(b.max_completion_tokens, 800);
  assert.equal(b.reasoning_effort, 'none');
  assert.deepEqual(b.response_format, { type: 'json_object' });
});

test('older families pass through untouched, so an env rollback is exact', () => {
  const input = { max_tokens: 500, messages: [] };
  assert.deepEqual(chatBody('gpt-4o-mini', input), { ...input, model: 'gpt-4o-mini' });
});
