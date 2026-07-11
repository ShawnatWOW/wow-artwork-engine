import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildStillPrompt, buildMotionPrompt, travelFor, themeFor, THEMES } from '../src/services/generation/prompts.js';
import { checkPrompt } from '../src/services/guardrails.js';
import { planJobs } from '../src/services/generation/catalog.js';

// Placement/hardware terms the models don't understand — must never leak into a
// prompt (they only know how to make art, not where it runs).
const DOMAIN_TERMS = /\b(pod|pods|eon|eons|spectacular|spectaculars|billboard|billboards|sign|signs|panel|panels)\b/i;
// Meta-artwork vocabulary gets literalized into pictures-of-pictures
// (live finding: an option rendered a framed print leaning on a wall).
const META_TERMS = /\b(artwork|poster|framed|canvas|display)\b/i;

const JOB = { style: 'frame_break', specKey: 'spectacular_wow1_8', weekOf: '2026-08-10' };

test('buildStillPrompt is deterministic and options differ', () => {
  const a = buildStillPrompt({ ...JOB, option: 1 });
  assert.equal(a, buildStillPrompt({ ...JOB, option: 1 }));
  assert.notEqual(a, buildStillPrompt({ ...JOB, option: 2 }));
});

test('EON connected motion prompt: in-frame travel, constant speed, color constancy', () => {
  const p1 = buildMotionPrompt({ style: 'eon_connected', specKey: 'eon_master_3pod', option: 1, weekOf: '2026-08-10' });
  assert.match(p1, /from the right edge of the frame/);
  assert.match(p1, /to the left edge/);
  assert.match(p1, /perfectly constant speed/);
  assert.match(p1, /saturation and lighting remain exactly constant/); // anti-drift
  assert.match(p1, /Locked static camera/);
  assert.doesNotMatch(p1, DOMAIN_TERMS);

  const p2 = buildMotionPrompt({ style: 'eon_connected', specKey: 'eon_master_3pod', option: 2, weekOf: '2026-08-10' });
  assert.match(p2, /from the left edge of the frame/); // option 2 reverses
});

test('travelFor cycles the in-frame direction across options', () => {
  assert.equal(travelFor(1).dir, 'rtl');
  assert.equal(travelFor(2).dir, 'ltr');
  assert.equal(travelFor(1).start, 'right');
});

test('every prompt names a concrete non-human subject from the theme list', () => {
  // Live finding: "a hero subject" alone rendered photoreal people 3/3, which
  // Seedance refuses to animate. Subjects must be NAMED per theme.
  const subjects = new Set(THEMES.map((t) => t.subject));
  for (const job of planJobs({ optionsPerSurface: 3 })) {
    const args = { style: job.style, specKey: job.specKey, option: job.option, weekOf: '2026-08-10' };
    const t = themeFor(args);
    assert.ok(subjects.has(t.subject));
    assert.ok(buildStillPrompt(args).includes(t.subject), `still must name ${t.subject}`);
    assert.ok(buildMotionPrompt(args).includes(t.subject), `motion must name ${t.subject}`);
  }
});

test('still prompts carry the contrast clause and hardened people/text negatives', () => {
  for (const job of planJobs({ optionsPerSurface: 3 })) {
    const still = buildStillPrompt({ style: job.style, specKey: job.specKey, option: job.option, weekOf: '2026-08-10' });
    assert.match(still, /never an all-white or all-black scene/, `missing contrast clause: ${still}`);
    assert.match(still, /No people, no faces, no human figures/, `missing people exclusion: ${still}`);
    assert.match(still, /no text, no logos, no watermarks/);
  }
});

test('connected still: subject at start edge, seam-avoidance, room to travel', () => {
  const s = buildStillPrompt({ style: 'eon_connected', specKey: 'eon_master_3pod', option: 1, weekOf: '2026-08-10' });
  assert.match(s, /positioned at the right edge/);
  assert.match(s, /one-third and two-thirds of the frame width/); // seam avoidance
  assert.match(s, /continuous seamless environment/);
});

test('NO prompt contains placement/hardware or meta-artwork terms, all pass guardrails', () => {
  for (const job of planJobs({ optionsPerSurface: 3 })) {
    const args = { style: job.style, specKey: job.specKey, option: job.option, weekOf: '2026-08-10' };
    for (const p of [buildStillPrompt(args), buildMotionPrompt(args)]) {
      assert.doesNotMatch(p, DOMAIN_TERMS, `placement term leaked: ${p}`);
      assert.doesNotMatch(p, META_TERMS, `meta-artwork term leaked: ${p}`);
      assert.ok(checkPrompt(p).allowed);
    }
  }
});
