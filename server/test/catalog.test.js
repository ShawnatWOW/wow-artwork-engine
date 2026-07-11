import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SPECS, SURFACES, POST, planJobs } from '../src/services/generation/catalog.js';

test('SPECS match the locked Build Plan §4 pixel dimensions', () => {
  assert.deepEqual(SPECS.spectacular_wow1_8, { surface: 'spectacular', width: 1692, height: 468 });
  assert.deepEqual(SPECS.eon_face, { surface: 'eon', width: 256, height: 384 });
  assert.deepEqual(SPECS.eon_master_3pod, { surface: 'eon', width: 768, height: 384 });
});

test('every surface references a known spec and a known post-step', () => {
  const posts = new Set(Object.values(POST));
  for (const s of SURFACES) {
    assert.ok(SPECS[s.specKey], `surface ${s.key} has unknown spec ${s.specKey}`);
    assert.ok(posts.has(s.post), `surface ${s.key} has unknown post ${s.post}`);
  }
});

test('planJobs expands to optionsPerSurface options per surface', () => {
  const jobs = planJobs({ optionsPerSurface: 3 });
  assert.equal(jobs.length, SURFACES.length * 3);
  const spectacular = jobs.filter((j) => j.key === 'spectacular');
  assert.deepEqual(spectacular.map((j) => j.option), [1, 2, 3]);
  // each job carries its resolved spec
  assert.deepEqual(spectacular[0].spec, SPECS.spectacular_wow1_8);
});

test('planJobs honours a custom option count and surface list', () => {
  const only = SURFACES.filter((s) => s.key === 'eon_single');
  const jobs = planJobs({ surfaces: only, optionsPerSurface: 2 });
  assert.equal(jobs.length, 2);
  assert.ok(jobs.every((j) => j.key === 'eon_single'));
});
