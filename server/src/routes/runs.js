// Generation run API (Build Plan M1 → feeds the M2 dashboard).
//
//   POST /runs         trigger a weekly run (returns 202 + runId, work continues async)
//   GET  /runs         list recent runs
//   GET  /runs/:id     one run with its artworks + EON sequences
//
// Kept thin: all DB access goes through db/repo.js, generation through the
// orchestrator. A run never spends unless GENERATION_MODE=live is set.

import { Router } from 'express';
import logger from '../config/logger.js';
import { runWeek } from '../services/orchestrator.js';
import { pgRepo } from '../db/repo.js';

const router = Router();

// Trigger a run. Responds as soon as the run row exists; generation continues
// in the background and status is polled via GET /runs/:id.
router.post('/runs', async (req, res, next) => {
  try {
    const { weekOf, triggeredBy } = req.body || {};
    const by = triggeredBy || req.get('x-user-email') || 'manual';

    const run = await new Promise((resolve, reject) => {
      runWeek({ weekOf, triggeredBy: by, onStart: resolve }).catch((err) => {
        logger.error({ err: err.message }, 'Background run failed');
        reject(err);
      });
    });

    res.status(202).json({ runId: run.id, status: run.status, weekOf: run.week_of });
  } catch (err) {
    next(err);
  }
});

router.get('/runs', async (_req, res, next) => {
  try {
    res.json({ runs: await pgRepo.listRuns() });
  } catch (err) {
    next(err);
  }
});

router.get('/runs/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_run_id' });
    const run = await pgRepo.getRun(id);
    if (!run) return res.status(404).json({ error: 'run_not_found' });
    const [artworks, eonSequences] = await Promise.all([
      pgRepo.listArtworks(id),
      pgRepo.listEonSequences(id),
    ]);
    res.json({ run, artworks, eonSequences });
  } catch (err) {
    next(err);
  }
});

export default router;
