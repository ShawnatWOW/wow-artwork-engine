// Asset-store factory.
//
// Returns a store keyed by STORAGE_DRIVER: `local` (default) writes to disk so
// the fixture pipeline runs with no AWS dependency; `s3` uploads to the bucket.
// Both expose the same interface: { driver, put({key, sourcePath}), getBuffer(key) }.

import config from '../../config/index.js';
import logger from '../../config/logger.js';
import { createLocalStore } from './local.js';
import { createS3Store } from './s3.js';

// One store per driver, memoized so routes and the orchestrator share it
// (and the S3 client isn't rebuilt on every request).
const cache = new Map();

export function getStore(driver = config.storage.driver) {
  if (!cache.has(driver)) {
    cache.set(driver, buildStore(driver));
  }
  return cache.get(driver);
}

async function buildStore(driver) {
  if (driver === 's3') {
    logger.info({ bucket: config.storage.s3Bucket }, 'Asset store: S3');
    return createS3Store();
  }
  const store = createLocalStore();
  logger.info({ baseDir: store.baseDir }, 'Asset store: local disk (no cost)');
  return store;
}

// Key layout, kept in one place so routes/handoff can reconstruct paths.
export function artworkKey({ runId, surfaceKey, option, variant, name }) {
  // `variant` keeps every generation in its OWN file. Without it a re-roll, a
  // per-design regenerate or a keep-&-explore variation writes over the design
  // it came from — same run, same surface, same option slot, same key — so the
  // row survived but the picture didn't (found 2026-07-26). The `opt<n>/`
  // segment stays put either way: regen slot recovery parses it back out.
  const slot = variant ? `opt${option}/${variant}` : `opt${option}`;
  return `runs/${runId}/${surfaceKey}/${slot}/${name}`;
}

export default { getStore, artworkKey };
