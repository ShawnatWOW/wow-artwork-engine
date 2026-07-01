// Shared Postgres connection pool. Lazily constructed so modules that only
// need pure helpers (FFmpeg, slicer) can be imported without a DB connection.
import config from '../config/index.js';
import logger from '../config/logger.js';

let pool = null;

export async function getPool() {
  if (pool) return pool;
  if (!config.db.url) {
    throw new Error('DATABASE_URL is not set. See .env.example.');
  }
  const { default: pg } = await import('pg');
  pool = new pg.Pool({
    connectionString: config.db.url,
    ssl: config.db.ssl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (err) => logger.error({ err: err.message }, 'Idle PG client error'));
  return pool;
}

export async function query(text, params) {
  const p = await getPool();
  return p.query(text, params);
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
