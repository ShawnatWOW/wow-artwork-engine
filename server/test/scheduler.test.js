import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseField, matchesCron, nextCronTime } from '../src/services/scheduler.js';
import { weekOfFor } from '../src/services/dates.js';

const MIN = { min: 0, max: 59 };
const DOW = { min: 0, max: 7 };

test('parseField expands *, steps, ranges, and lists', () => {
  assert.equal(parseField('*', MIN).size, 60);
  assert.deepEqual([...parseField('*/15', MIN)], [0, 15, 30, 45]);
  assert.deepEqual([...parseField('1-5', DOW)], [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseField('1,3,5', DOW)], [1, 3, 5]);
});

test('parseField rejects out-of-range values', () => {
  assert.throws(() => parseField('8', DOW)); // dow max is 7
  assert.throws(() => parseField('60', MIN));
});

test('matchesCron matches only the intended minute (0 9 * * 1 = Mon 09:00)', () => {
  const monday9 = new Date(2026, 0, 5, 9, 0); // 2026-01-05 is a Monday
  assert.ok(matchesCron('0 9 * * 1', monday9));
  assert.ok(!matchesCron('0 9 * * 1', new Date(2026, 0, 5, 9, 1))); // 09:01
  assert.ok(!matchesCron('0 9 * * 1', new Date(2026, 0, 6, 9, 0))); // Tuesday
});

test('nextCronTime finds the next matching Monday 09:00', () => {
  const from = new Date(2026, 0, 6, 10, 0); // Tue 10:00
  const next = nextCronTime('0 9 * * 1', from);
  assert.equal(next.getDay(), 1); // Monday
  assert.equal(next.getHours(), 9);
  assert.equal(next.getMinutes(), 0);
  assert.equal(next.getDate(), 12); // 2026-01-12
});

test('weekOfFor returns the Monday of the week (UTC)', () => {
  assert.equal(weekOfFor(new Date('2026-01-07T00:00:00Z')), '2026-01-05'); // Wed → Mon
  assert.equal(weekOfFor(new Date('2026-01-05T12:00:00Z')), '2026-01-05'); // Mon → itself
  assert.equal(weekOfFor(new Date('2026-01-04T00:00:00Z')), '2025-12-29'); // Sun → prev Mon
});
