import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildStillPrompt, buildMotionPrompt, travelFor } from '../src/services/generation/prompts.js';
import { checkPrompt } from '../src/services/guardrails.js';
import { planJobs } from '../src/services/generation/catalog.js';

// Placement / hardware terms the models don't understand — must never leak
// into a prompt (Seedance/Seedream only know how to make art, not where it runs).
const DOMAIN_TERMS = /\b(pod|pods|eon|eons|spectacular|spectaculars|billboard|billboards|sign|signs|panel|panels)\b/i;

test('buildStillPrompt is deterministic and options differ', () => {
  const a = buildStillPrompt({ style: 'frame_break', specKey: 'spectacular_wow1_8', option: 1, weekOf: '2026-08-10' });
  const b = buildStillPrompt({ style: 'frame_break', specKey: 'spectacular_wow1_8', option: 1, weekOf: '2026-08-10' });
  assert.equal(a, b);
  const c = buildStillPrompt({ style: 'frame_break', specKey: 'spectacular_wow1_8', option: 2, weekOf: '2026-08-10' });
  assert.notEqual(a, c);
});

test('EON connected motion prompt gives an in-frame travel direction (no placement terms)', () => {
  const p1 = buildMotionPrompt({ style: 'eon_connected', specKey: 'eon_master_3pod', option: 1, weekOf: '2026-08-10' });
  assert.match(p1, /from the right edge of the frame/);
  assert.match(p1, /to the left edge/);
  assert.match(p1, /across the full width/);
  assert.doesNotMatch(p1, DOMAIN_TERMS); // no "pod", "EON", etc.

  const p2 = buildMotionPrompt({ style: 'eon_connected', specKey: 'eon_master_3pod', option: 2, weekOf: '2026-08-10' });
  assert.match(p2, /from the left edge of the frame/); // option 2 reverses
});

test('travelFor cycles the in-frame direction across options', () => {
  assert.equal(travelFor(1).dir, 'rtl');
  assert.equal(travelFor(2).dir, 'ltr');
  assert.equal(travelFor(1).start, 'right');
});

test('the connected still positions the subject at the start edge, no placement terms', () => {
  const s = buildStillPrompt({ style: 'eon_connected', specKey: 'eon_master_3pod', option: 1, weekOf: '2026-08-10' });
  assert.match(s, /at the right side of the frame/);
  assert.doesNotMatch(s, DOMAIN_TERMS);
});

test('NO catalog prompt mentions placement/hardware, and all pass the guardrail', () => {
  for (const job of planJobs({ optionsPerSurface: 3 })) {
    const still = buildStillPrompt({ style: job.style, specKey: job.specKey, option: job.option, weekOf: '2026-08-10' });
    const motion = buildMotionPrompt({ style: job.style, specKey: job.specKey, option: job.option, weekOf: '2026-08-10' });
    assert.doesNotMatch(still, DOMAIN_TERMS, `still leaked a placement term: ${still}`);
    assert.doesNotMatch(motion, DOMAIN_TERMS, `motion leaked a placement term: ${motion}`);
    assert.ok(checkPrompt(still).allowed && checkPrompt(motion).allowed);
  }
});

test('every still prompt excludes people (likeness risk + video-moderation blocks)', () => {
  // Live finding (2026-07-10): "hero subject" alone made Seedream render
  // photoreal people; Seedance then refused to animate ("likenesses of real
  // people"). Every still prompt must steer non-human and say so explicitly.
  for (const job of planJobs({ optionsPerSurface: 3 })) {
    const still = buildStillPrompt({ style: job.style, specKey: job.specKey, option: job.option, weekOf: '2026-08-10' });
    assert.match(still, /No people, no faces, no human figures/, `missing people exclusion: ${still}`);
    if (/hero subject/.test(still)) {
      assert.match(still, /non-human hero subject/, `hero subject not steered non-human: ${still}`);
    }
  }
});
