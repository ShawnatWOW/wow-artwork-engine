import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt } from '../src/services/generation/prompts.js';
import { checkPrompt } from '../src/services/guardrails.js';
import { planJobs } from '../src/services/generation/catalog.js';

test('buildPrompt is deterministic for the same inputs', () => {
  const a = buildPrompt({ style: 'frame_break', specKey: 'spectacular_wow1_8', option: 1, weekOf: '2026-08-10' });
  const b = buildPrompt({ style: 'frame_break', specKey: 'spectacular_wow1_8', option: 1, weekOf: '2026-08-10' });
  assert.equal(a, b);
});

test('different options for a surface produce different prompts', () => {
  const p1 = buildPrompt({ style: 'frame_break', specKey: 'spectacular_wow1_8', option: 1, weekOf: '2026-08-10' });
  const p2 = buildPrompt({ style: 'frame_break', specKey: 'spectacular_wow1_8', option: 2, weekOf: '2026-08-10' });
  const p3 = buildPrompt({ style: 'frame_break', specKey: 'spectacular_wow1_8', option: 3, weekOf: '2026-08-10' });
  assert.equal(new Set([p1, p2, p3]).size, 3);
});

test('every catalog prompt passes the guardrail (brand-safe by construction)', () => {
  for (const job of planJobs({ optionsPerSurface: 3 })) {
    const prompt = buildPrompt({ style: job.style, specKey: job.specKey, option: job.option, weekOf: '2026-08-10' });
    assert.ok(checkPrompt(prompt).allowed, `prompt blocked: ${prompt}`);
  }
});
