// Handoff API (Build Plan M3 — send approved picks to Jeff).
//
//   GET  /api/delivery/status      delivery preflight (live vs offline + what's missing)
//   GET  /api/runs/:id/handoff     the editable email draft + attachments + preflight
//   POST /api/runs/:id/handoff     send (body: sender, recipient, subject, body, test)
//   GET  /api/runs/:id/deliveries  delivery records for the run
//   GET  /api/deliveries           cross-run history of everything ever sent
//
// The send returns an HONEST result: delivered is true only on a real Gmail
// send; offline writes report as not sent.

import { Router } from 'express';
import { deliveryPreflight, previewHandoff, sendRun } from '../services/delivery/handoff.js';
import { getRepo } from '../db/index.js';

const router = Router();

router.get('/delivery/status', (_req, res, next) => {
  try { res.json(deliveryPreflight()); } catch (err) { next(err); }
});

function runId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'invalid_run_id' }); return null; }
  return id;
}

router.get('/runs/:id/handoff', async (req, res, next) => {
  try {
    const id = runId(req, res); if (id === null) return;
    res.json(await previewHandoff({ runId: id }));
  } catch (err) {
    if (/not found/.test(err.message)) return res.status(404).json({ error: 'run_not_found' });
    next(err);
  }
});

router.post('/runs/:id/handoff', async (req, res, next) => {
  try {
    const id = runId(req, res); if (id === null) return;
    const { sender, recipient, subject, body, test } = req.body || {};
    const result = await sendRun({ runId: id, sender, recipient, subject, body, test: Boolean(test) });
    res.json(result);
  } catch (err) {
    if (/No approved pieces/.test(err.message)) return res.status(409).json({ error: 'nothing_to_send', message: err.message });
    if (/not found/.test(err.message)) return res.status(404).json({ error: 'run_not_found' });
    next(err);
  }
});

router.get('/runs/:id/deliveries', async (req, res, next) => {
  try {
    const id = runId(req, res); if (id === null) return;
    res.json({ deliveries: await getRepo().listDeliveries(id) });
  } catch (err) { next(err); }
});

// Cross-run "Sent to Jeff" history — every delivery ever, newest first, with
// its artwork + run attached (Scott: "what have we already sent him?").
router.get('/deliveries', async (_req, res, next) => {
  try {
    res.json({ deliveries: await getRepo().listAllDeliveries() });
  } catch (err) { next(err); }
});

export default router;
