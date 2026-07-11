// Generation run API (Build Plan M1 → feeds the M2 dashboard).
//
//   POST /runs         trigger a weekly run (returns 202 + runId, work continues async)
//   GET  /runs         list recent runs
//   GET  /runs/:id     one run with its artworks + EON sequences
//
// Kept thin: all DB access goes through db/repo.js, generation through the
// orchestrator. A run never spends unless GENERATION_MODE=live is set.

import { Router } from 'express';
import config from '../config/index.js';
import logger from '../config/logger.js';
import { runWeek, animateRun } from '../services/orchestrator.js';
import { getRepo } from '../db/index.js';

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

// Phase 2: animate the run's approved stills. Responds once work is under way;
// motions are polled via GET /runs/:id.
router.post('/runs/:id/animate', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_run_id' });

    const run = await new Promise((resolve, reject) => {
      animateRun({ runId: id, triggeredBy: req.get('x-user-email') || 'dashboard', onStart: resolve })
        .catch((err) => { logger.error({ err: err.message }, 'Background animate failed'); reject(err); });
    });
    res.status(202).json({ runId: run.id, status: 'running' });
  } catch (err) {
    next(err);
  }
});

router.get('/runs', async (_req, res, next) => {
  try {
    res.json({ runs: await getRepo().listRuns(), generationMode: config.generationMode });
  } catch (err) {
    next(err);
  }
});

router.get('/runs/:id', async (req, res, next) => {
  try {
    const repo = getRepo();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_run_id' });
    const run = await repo.getRun(id);
    if (!run) return res.status(404).json({ error: 'run_not_found' });
    const [artworks, eonSequences, selections] = await Promise.all([
      repo.listArtworks(id),
      repo.listEonSequences(id),
      repo.listSelections(id),
    ]);
    res.json({ run, artworks, eonSequences, selections, generationMode: config.generationMode });
  } catch (err) {
    next(err);
  }
});

export default router;
