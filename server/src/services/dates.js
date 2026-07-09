// Small pure date helpers shared by the scheduler and orchestrator.

/** YYYY-MM-DD in UTC. */
export function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * The Monday (ISO week start) on or before `date`, as a YYYY-MM-DD string.
 * A run's `week_of` is the Monday of the week it covers.
 */
export function weekOfFor(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7; // Mon→0, Sun→6
  d.setUTCDate(d.getUTCDate() - backToMonday);
  return toDateString(d);
}

export default { toDateString, weekOfFor };
