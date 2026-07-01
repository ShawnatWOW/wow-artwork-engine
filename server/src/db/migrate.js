// Minimal forward-only migration runner. Applies every *.sql file in
// /migrations in lexical order, recording applied files in schema_migrations
// so re-runs are no-ops. Migrations are written idempotently as a belt-and-
// braces measure. Run with `npm run migrate` from server/.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from './pool.js';
import logger from '../config/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../migrations');

export async function migrate() {
  const pool = await getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      logger.debug({ file }, 'Migration already applied; skipping');
      continue;
    }
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    logger.info({ file }, 'Applying migration');
    const client = await pool.connect();
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      count += 1;
    } catch (err) {
      logger.error({ file, err: err.message }, 'Migration failed');
      throw err;
    } finally {
      client.release();
    }
  }
  logger.info({ applied: count, total: files.length }, 'Migrations complete');
  return count;
}

// Run directly: `node src/db/migrate.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.fatal({ err: err.message }, 'Migration runner crashed');
      process.exit(1);
    });
}
