// Artwork curation API (Build Plan M2 — dashboard backend).
//
//   POST   /api/artworks/:id/select    mark a favorite (writes selections)
//   DELETE /api/artworks/:id/select    un-favorite
//   POST   /api/artworks/:id/approve   status -> approved (greenlit to ship)
//   POST   /api/artworks/:id/reject    status -> rejected
//   GET    /api/artworks/:id/media     stream the final video from the store
//   GET    /api/artworks/:id/thumbnail stream the thumbnail
//
// Media is streamed store-agnostically: from local disk (a read stream, with
// HTTP range support so <video> can seek) or from S3 (buffered).

import { Router } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import logger from '../config/logger.js';
import { getRepo } from '../db/index.js';
import { getStore } from '../services/storage/index.js';
import { contentTypeFor } from '../services/storage/s3.js';
import { animateRun, regenerateStill, varyStill, tweakStill } from '../services/orchestrator.js';
import { keepArtwork, promoteArtwork } from '../services/keeper.js';

const router = Router();

const APPROVE = { approve: 'approved', reject: 'rejected' };

async function loadArtwork(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid_artwork_id' });
    return null;
  }
  const artwork = await getRepo().getArtwork(id);
  if (!artwork) {
    res.status(404).json({ error: 'artwork_not_found' });
    return null;
  }
  return artwork;
}

router.post('/artworks/:id/select', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    const by = (req.body && req.body.selectedBy) || req.get('x-user-email') || null;
    const selection = await getRepo().addSelection(artwork.id, by);
    res.status(201).json({ selection });
  } catch (err) {
    next(err);
  }
});

router.delete('/artworks/:id/select', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    await getRepo().removeSelection(artwork.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// (Re-)animate ONE approved still — the retry path after a moderation refusal
// or a rejected motion (UX review P0). Clears the stale error, then runs
// Phase 2 targeted at just this still (bypasses the already-animated skip).
router.post('/artworks/:id/animate', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    if (artwork.stage !== 'still') return res.status(400).json({ error: 'not_a_still', message: 'Only style stills can be animated.' });
    if (artwork.status !== 'approved') return res.status(409).json({ error: 'not_approved', message: 'Approve this style first, then animate it.' });

    await getRepo().updateArtwork(artwork.id, { error: null });
    const run = await new Promise((resolve, reject) => {
      animateRun({ runId: artwork.run_id, stillIds: [artwork.id], triggeredBy: req.get('x-user-email') || 'dashboard', onStart: resolve })
        .catch((err) => { logger.error({ err: err.message }, 'Background per-still animate failed'); reject(err); });
    });
    res.status(202).json({ runId: run.id, stillId: artwork.id, status: 'running' });
  } catch (err) {
    next(err);
  }
});

// Regenerate ONE design — retire this card only and create a fresh design in
// its slot. Siblings, other signs, approved designs and videos are untouched.
// 202 + poll GET /runs/:id (run.progress shows designs 0/1 → 1/1).
router.post('/artworks/:id/regenerate', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    if (artwork.stage !== 'still') return res.status(400).json({ error: 'not_a_still', message: 'Only style designs can be regenerated.' });
    if (artwork.status === 'superseded') return res.status(409).json({ error: 'already_replaced', message: 'This design was already replaced.' });

    const run = await new Promise((resolve, reject) => {
      regenerateStill({ artworkId: artwork.id, triggeredBy: req.get('x-user-email') || 'dashboard', onStart: resolve })
        .catch((err) => { logger.error({ err: err.message }, 'Background per-design regenerate failed'); reject(err); });
    });
    res.status(202).json({ runId: run.id, artworkId: artwork.id, status: 'running' });
  } catch (err) {
    next(err);
  }
});

// ---- "Keep & explore" ------------------------------------------------------
// Anchor a liked design, then explore variations of it (re-roll or tweak) while
// the original is never lost; a variation can be promoted to the new keeper.

// Keep (anchor) a still: bootstrap its family, select it, and demote any other
// keeper in the family so there is exactly one. Only stills can be kept.
router.post('/artworks/:id/keep', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    if (artwork.stage !== 'still') return res.status(400).json({ error: 'not_a_still', message: 'Only style designs can be kept.' });
    const by = (req.body && req.body.selectedBy) || req.get('x-user-email') || null;
    const updated = await keepArtwork({ artworkId: artwork.id, selectedBy: by, repo: getRepo() });
    res.json({ artwork: updated });
  } catch (err) {
    next(err);
  }
});

// Un-keep a still (drop its selection). The design itself is untouched.
router.delete('/artworks/:id/keep', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    await getRepo().removeSelection(artwork.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Vary a still: RE-ROLL its stored prompt into one fresh same-family design.
// 202 + poll GET /runs/:id (run.progress shows designs 0/1 → 1/1).
router.post('/artworks/:id/vary', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    if (artwork.stage !== 'still') return res.status(400).json({ error: 'not_a_still', message: 'Only style designs can be varied.' });
    if (artwork.status === 'superseded') return res.status(409).json({ error: 'already_replaced', message: 'This design was already replaced.' });

    const run = await new Promise((resolve, reject) => {
      varyStill({ artworkId: artwork.id, triggeredBy: req.get('x-user-email') || 'dashboard', onStart: resolve })
        .catch((err) => { logger.error({ err: err.message }, 'Background vary failed'); reject(err); });
    });
    res.status(202).json({ runId: run.id, artworkId: artwork.id, status: 'running' });
  } catch (err) {
    next(err);
  }
});

// Tweak a still: an LLM edits ONLY the reviewer's plain-language change into the
// design's prompt, then generates one fresh same-family design. 202 + poll.
router.post('/artworks/:id/tweak', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    if (artwork.stage !== 'still') return res.status(400).json({ error: 'not_a_still', message: 'Only style designs can be tweaked.' });
    if (artwork.status === 'superseded') return res.status(409).json({ error: 'already_replaced', message: 'This design was already replaced.' });
    const instruction = req.body?.instruction;
    if (!instruction?.trim()) return res.status(400).json({ error: 'empty_instruction' });

    const run = await new Promise((resolve, reject) => {
      tweakStill({ artworkId: artwork.id, instruction, triggeredBy: req.get('x-user-email') || 'dashboard', onStart: resolve })
        .catch((err) => { logger.error({ err: err.message }, 'Background tweak failed'); reject(err); });
    });
    res.status(202).json({ runId: run.id, artworkId: artwork.id, status: 'running' });
  } catch (err) {
    next(err);
  }
});

// Promote a variation to be the family keeper: clear the family's selections and
// select this one. The original design is never lost.
router.post('/artworks/:id/promote', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    const by = (req.body && req.body.selectedBy) || req.get('x-user-email') || null;
    const updated = await promoteArtwork({ artworkId: artwork.id, selectedBy: by, repo: getRepo() });
    res.json({ artwork: updated });
  } catch (err) {
    next(err);
  }
});

for (const [action, status] of Object.entries(APPROVE)) {
  router.post(`/artworks/:id/${action}`, async (req, res, next) => {
    try {
      const artwork = await loadArtwork(req, res);
      if (!artwork) return;
      const updated = await getRepo().updateArtwork(artwork.id, { status });
      res.json({ artwork: updated });
    } catch (err) {
      next(err);
    }
  });
}

router.get('/artworks/:id/media', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    await streamKey(artwork.s3_key_final, res);
  } catch (err) {
    next(err);
  }
});

router.get('/artworks/:id/thumbnail', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    await streamKey(artwork.thumbnail_key, res);
  } catch (err) {
    next(err);
  }
});

// Stream an object by key from whichever store is active.
async function streamKey(key, res) {
  if (!key) return res.status(404).json({ error: 'no_media' });
  const store = await getStore();
  const type = contentTypeFor(key);

  // Local disk: stream with range support so video scrubbing works.
  if (store.localPath) {
    const path = store.localPath(key);
    if (!existsSync(path)) return res.status(404).json({ error: 'media_missing' });
    const { size } = statSync(path);
    const range = res.req.headers.range;
    res.setHeader('Content-Type', type);
    res.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = Number(startStr);
      const end = endStr ? Number(endStr) : size - 1;
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', end - start + 1);
      return createReadStream(path, { start, end }).pipe(res);
    }
    res.setHeader('Content-Length', size);
    return createReadStream(path).pipe(res);
  }

  // S3 (or any non-local store): buffer and send.
  const buffer = await store.getBuffer(key);
  res.setHeader('Content-Type', type);
  return res.send(buffer);
}

export default router;
