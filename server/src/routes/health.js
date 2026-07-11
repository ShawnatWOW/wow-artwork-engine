import { Router } from 'express';
import { getPool } from '../db/pool.js';
import config from '../config/index.js';

const router = Router();

// Liveness: always 200 if the process is up. generationMode is surfaced so the
// dashboard can show an honest LIVE (spends money) vs FIXTURES ($0) indicator.
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'wow-artwork-engine',
    env: config.env,
    generationMode: config.generationMode,
  });
});

// Readiness: 200 only when dependencies (DB) are reachable.
router.get('/ready', async (_req, res) => {
  const checks = { db: 'unknown' };
  try {
    const pool = await getPool();
    await pool.query('SELECT 1');
    checks.db = 'ok';
    res.json({ status: 'ready', checks });
  } catch (err) {
    checks.db = 'unreachable';
    res.status(503).json({ status: 'not_ready', checks, error: err.message });
  }
});

export default router;
