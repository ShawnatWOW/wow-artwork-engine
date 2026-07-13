// Repository accessor.
//
// Returns the Postgres repo when DATABASE_URL is set, otherwise a single
// shared in-memory repo backed by a JSON snapshot on disk (var/storage/
// state.json) so runs survive pm2 restarts and deploys. This lets the whole
// app — API, dashboard, orchestrator — run end-to-end with no database, while
// production transparently uses Postgres once DATABASE_URL is wired.

import path from 'node:path';
import config from '../config/index.js';
import logger from '../config/logger.js';
import { pgRepo } from './repo.js';
import { createMemoryRepo } from './memoryRepo.js';

let memoryRepo = null;

export function getRepo() {
  if (config.db.url) return pgRepo;
  if (!memoryRepo) {
    // Lives next to the generated media (also under var/), which deploys
    // already preserve — git reset --hard leaves untracked files alone.
    const persistPath =
      process.env.STATE_FILE || path.join(config.storage.localDir, 'state.json');
    memoryRepo = createMemoryRepo({ persistPath });
    logger.warn(
      { persistPath },
      'No DATABASE_URL — using file-backed in-memory repo (state survives restarts via JSON snapshot).',
    );
  }
  return memoryRepo;
}

export default { getRepo };
