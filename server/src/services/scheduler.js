// Weekly scheduler (Build Plan M1).
//
// A tiny, dependency-free cron implementation — custom orchestration only, no
// low-code tools (CLAUDE.md). Supports the standard 5-field cron
// (minute hour day-of-month month day-of-week) with `*`, lists (`,`), ranges
// (`a-b`), and steps (`*/n`, `a-b/n`) — enough for `0 9 * * 1` and beyond.
//
// The field matcher is pure and unit-tested; startScheduler() arms a timeout to
// the next matching minute, fires the callback, and re-arms. It is opt-in
// (config.scheduler.enabled) so dev/CI never auto-fire a spend-capable run.

import config from './../config/index.js';
import logger from './../config/logger.js';

const FIELD_BOUNDS = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // day of week (0 or 7 = Sunday)
];

/** Parse one cron field into a Set of allowed integers. Pure. */
export function parseField(field, { min, max }) {
  const allowed = new Set();
  for (const part of String(field).split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad cron step in "${part}"`);

    let lo;
    let hi;
    if (rangePart === '*') {
      lo = min;
      hi = max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-').map(Number);
      lo = a;
      hi = b;
    } else {
      lo = Number(rangePart);
      hi = lo;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`Cron field value out of range in "${part}" (allowed ${min}-${max})`);
    }
    for (let v = lo; v <= hi; v += step) allowed.add(v);
  }
  return allowed;
}

/** Parse a full 5-field cron expression into per-field Sets. Pure. */
export function parseCron(expr) {
  const fields = String(expr).trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Cron must have 5 fields, got ${fields.length}: "${expr}"`);
  return fields.map((f, i) => parseField(f, FIELD_BOUNDS[i]));
}

/** Does `date` (local time) satisfy the cron expression? Pure. */
export function matchesCron(expr, date) {
  const [min, hour, dom, mon, dow] = Array.isArray(expr) ? expr : parseCron(expr);
  const domRestricted = dom.size !== 31;
  const dowRestricted = dow.size !== 8; // 0..7 inclusive = 8 members when unrestricted

  const domMatch = dom.has(date.getDate());
  // Cron treats Sunday as both 0 and 7.
  const jsDow = date.getDay();
  const dowMatch = dow.has(jsDow) || (jsDow === 0 && dow.has(7)) || (jsDow === 7 && dow.has(0));

  // Standard rule: if BOTH day fields are restricted, either may match.
  let dayOk;
  if (domRestricted && dowRestricted) dayOk = domMatch || dowMatch;
  else if (domRestricted) dayOk = domMatch;
  else if (dowRestricted) dayOk = dowMatch;
  else dayOk = true;

  return (
    min.has(date.getMinutes()) &&
    hour.has(date.getHours()) &&
    mon.has(date.getMonth() + 1) &&
    dayOk
  );
}

/**
 * The next Date (strictly after `from`) that matches the expression, scanning
 * minute-by-minute up to `horizonDays`. Pure. Returns null if none within range.
 */
export function nextCronTime(expr, from = new Date(), horizonDays = 366) {
  const parsed = parseCron(expr);
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = from.getTime() + horizonDays * 24 * 60 * 60 * 1000;
  while (d.getTime() <= limit) {
    if (matchesCron(parsed, d)) return new Date(d.getTime());
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

/**
 * Arm the in-process weekly scheduler.
 * @param {object} opts
 * @param {() => Promise<void>} opts.onFire  called each time the cron matches
 * @param {string} [opts.cron]               cron expression (default config)
 * @param {() => Date} [opts.now]            clock injection for tests
 * @returns {{ next: Date, stop: () => void }}
 */
export function startScheduler({ onFire, cron = config.scheduler.weeklyCron, now = () => new Date() } = {}) {
  let timer = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) return { next: null };
    const next = nextCronTime(cron, now());
    if (!next) {
      logger.warn({ cron }, 'Scheduler found no next run within the horizon; not scheduling');
      return { next: null };
    }
    const delay = Math.max(0, next.getTime() - now().getTime());
    logger.info({ cron, next: next.toISOString() }, 'Weekly run scheduled');
    // setTimeout caps at ~24.8 days; re-arm in hops for longer waits.
    const MAX = 2_147_483_647;
    const hop = Math.min(delay, MAX);
    timer = setTimeout(async () => {
      if (delay > MAX) return schedule(); // not yet time; re-arm for the remainder
      try {
        logger.info({ cron }, 'Scheduler firing weekly run');
        await onFire();
      } catch (err) {
        logger.error({ err: err.message }, 'Scheduled run failed');
      } finally {
        schedule();
      }
    }, hop);
    if (timer.unref) timer.unref();
    return { next };
  };

  const { next } = schedule();
  return {
    next,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export default { parseField, parseCron, matchesCron, nextCronTime, startScheduler };
