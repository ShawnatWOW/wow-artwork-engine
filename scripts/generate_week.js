#!/usr/bin/env node
// Run one weekly generation batch (Build Plan M1).
//
// Fixtures-first: with GENERATION_MODE unset it synthesizes all media locally
// and spends nothing. Uses Postgres + the configured asset store when
// DATABASE_URL is set; otherwise falls back to an in-memory repo and a temp
// local store so the entire pipeline runs anywhere with zero setup.
//
//   node scripts/generate_week.js               # this week
//   node scripts/generate_week.js 2026-08-10    # a specific Monday
//
import path from 'node:path';
import os from 'node:os';
import { mkdtemp } from 'node:fs/promises';

import config from '../server/src/config/index.js';
import { runWeek } from '../server/src/services/orchestrator.js';
import { createMemoryRepo } from '../server/src/db/memoryRepo.js';
import { createLocalStore } from '../server/src/services/storage/local.js';
import { getProviders } from '../server/src/services/generation/index.js';
import { closePool } from '../server/src/db/pool.js';

async function main() {
  const weekOf = process.argv[2]; // optional YYYY-MM-DD
  const usingDb = Boolean(config.db.url);

  const deps = {};
  if (!usingDb) {
    deps.repo = createMemoryRepo();
    deps.store = createLocalStore({
      baseDir: await mkdtemp(path.join(os.tmpdir(), 'wae-store-')),
    });
    console.log('› No DATABASE_URL — using in-memory repo + temp local store.');
  } else {
    console.log('› Using Postgres + the configured asset store.');
  }
  deps.providers = getProviders(); // fixture unless GENERATION_MODE=live

  console.log(`› Generating week ${weekOf || '(this week)'} in ${config.generationMode} mode…\n`);
  const summary = await runWeek({ weekOf, triggeredBy: 'cli', deps });

  console.log(`\n✓ run #${summary.runId} — ${summary.status}  (week_of ${summary.weekOf})`);
  console.log(`  ready: ${summary.counts.ready}  failed: ${summary.counts.failed}  blocked: ${summary.counts.blocked}\n`);
  for (const a of summary.artworks) {
    const tag = `${a.surface}/${a.style}`.padEnd(24);
    const dims = a.width ? `${a.width}x${a.height}` : '—';
    const state = a.status === 'ready' ? 'ready' : `${a.status}${a.error ? ` (${a.error})` : ''}`;
    console.log(`  [${String(a.id).padStart(2)}] ${tag} ${dims.padEnd(10)} ${state}`);
    if (a.s3_key_final) console.log(`       → ${a.s3_key_final}`);
  }
  if (!usingDb && deps.store.baseDir) console.log(`\n  assets under: ${deps.store.baseDir}`);
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('\ngenerate_week failed:', err.message);
    await closePool().catch(() => {});
    process.exit(1);
  });
