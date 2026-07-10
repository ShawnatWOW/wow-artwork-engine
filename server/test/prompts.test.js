import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildStillPrompt, buildMotionPrompt, travelFor } from '../src/services/generation/prompts.js';
import { checkPrompt } from '../src/services/guardrails.js';
import { planJobs } from '../src/services/generation/catalog.js';

test('buildStillPrompt is deterministic and options differ', () => {
  const a = buildStillPrompt({ style: 'frame_break', specKey: 'spectacular_wow1_8', option: 1, weekOf: '2026-08-10' });
  const b = buildStillPrompt({ style: 'frame_break', specKey: 'spectacular_wow1_8', option: 1, weekOf: '2026-08-10' });
  assert.equal(a, b);
  const c = buildStillPrompt({ style: 'frame_break', specKey: 'spectacular_wow1_8', option: 2, weekOf: '2026-08-10' });
  assert.notEqual(a, c);
});

test('EON connected motion prompt encodes an explicit travel direction across the pods', () => {
  const p1 = buildMotionPrompt({ style: 'eon_connected', specKey: 'eon_master_3pod', option: 1, weekOf: '2026-08-10' });
  // Option 1 travels right→left (far-right edge to far-left edge, pod 3→2→1).
  assert.match(p1, /far-right edge to the far-left edge/);
  assert.match(p1, /pod 3 → pod 2 → pod 1/);
  assert.match(p1, /all three pods/);

  const p2 = buildMotionPrompt({ style: 'eon_connected', specKey: 'eon_master_3pod', option: 2, weekOf: '2026-08-10' });
  assert.match(p2, /far-left edge to the far-right edge/); // option 2 reverses
});

test('travelFor cycles direction across options so they are comparable', () => {
  assert.equal(travelFor(1).dir, 'rtl');
  assert.equal(travelFor(2).dir, 'ltr');
  assert.equal(travelFor(1).order, 'pod 3 → pod 2 → pod 1');
});

test('the connected still prompt positions the subject at the start edge', () => {
  const s = buildStillPrompt({ style: 'eon_connected', specKey: 'eon_master_3pod', option: 1, weekOf: '2026-08-10' });
  assert.match(s, /far-right edge/); // subject starts where the travel begins
  assert.match(s, /three vertical pods/);
});

test('every catalog still + motion prompt passes the guardrail', () => {
  for (const job of planJobs({ optionsPerSurface: 3 })) {
    const still = buildStillPrompt({ style: job.style, specKey: job.specKey, option: job.option, weekOf: '2026-08-10' });
    const motion = buildMotionPrompt({ style: job.style, specKey: job.specKey, option: job.option, weekOf: '2026-08-10' });
    assert.ok(checkPrompt(still).allowed, `still blocked: ${still}`);
    assert.ok(checkPrompt(motion).allowed, `motion blocked: ${motion}`);
  }
});
