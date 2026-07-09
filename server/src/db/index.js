// Repository accessor.
//
// Returns the Postgres repo when DATABASE_URL is set, otherwise a single
// shared in-memory repo. This lets the whole app — API, dashboard, orchestrator
// — run end-to-end on fixtures with no database (data lives for the life of the
// process), while production transparently uses Postgres.

import config from '../config/index.js';
import logger from '../config/logger.js';
import { pgRepo } from './repo.js';
import { createMemoryRepo } from './memoryRepo.js';

let memoryRepo = null;

export function getRepo() {
  if (config.db.url) return pgRepo;
  if (!memoryRepo) {
    memoryRepo = createMemoryRepo();
    logger.warn('No DATABASE_URL — using in-memory repo (data resets when the process restarts).');
  }
  return memoryRepo;
}

export default { getRepo };
