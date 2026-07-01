import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPrompt } from '../src/services/guardrails.js';

const LOOSE = { blockNudity: true, extraDenyTerms: [] };

test('allows ordinary on-brand prompts', () => {
  const r = checkPrompt('A neon desert sunset with chrome geometric shapes, cinematic', LOOSE);
  assert.equal(r.allowed, true);
  assert.deepEqual(r.reasons, []);
});

test('blocks nudity terms (whole word)', () => {
  for (const p of ['a nude figure', 'NSFW scene', 'naked silhouette']) {
    const r = checkPrompt(p, LOOSE);
    assert.equal(r.allowed, false, `should block: ${p}`);
    assert.ok(r.reasons.length >= 1);
  }
});

test('does not false-positive on substrings', () => {
  // "analyze"/"snaked" contain letters of denied words but not as whole words.
  const r = checkPrompt('Analyze the snaked river of light across the board', LOOSE);
  assert.equal(r.allowed, true);
});

test('respects blockNudity=false (fully loose)', () => {
  const r = checkPrompt('a nude study', { blockNudity: false, extraDenyTerms: [] });
  assert.equal(r.allowed, true);
});

test('honors extra deny terms from config', () => {
  const r = checkPrompt('a casino jackpot scene', { blockNudity: true, extraDenyTerms: ['casino'] });
  assert.equal(r.allowed, false);
  assert.match(r.reasons[0], /casino/);
});
