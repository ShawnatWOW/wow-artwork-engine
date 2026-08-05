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
import { checkPrompt } from '../services/guardrails.js';
import { buildMotionPrompt, buildSpectacularAct } from '../services/generation/prompts.js';
import { animateRun, regenerateStill, varyStill, tweakStill } from '../services/orchestrator.js';
import { keepArtwork, unkeepArtwork, promoteArtwork, resolveDesign } from '../services/keeper.js';

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

// Save/unsave. A selection protects a DESIGN from being replaced by a redo, so
// saving from a video card saves the design behind it (resolveDesign).
router.post('/artworks/:id/select', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    const design = await resolveDesign({ artwork, repo: getRepo() });
    const by = (req.body && req.body.selectedBy) || req.get('x-user-email') || null;
    const selection = await getRepo().addSelection(design.id, by);
    res.status(201).json({ selection });
  } catch (err) {
    next(err);
  }
});

router.delete('/artworks/:id/select', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    await unkeepArtwork({ artworkId: artwork.id, repo: getRepo() });
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
    const by = (req.body && req.body.selectedBy) || req.get('x-user-email') || null;
    const updated = await keepArtwork({ artworkId: artwork.id, selectedBy: by, repo: getRepo() });
    res.json({ artwork: updated });
  } catch (err) {
    next(err);
  }
});

// Un-keep (drop the selection). The design itself is untouched. From a video
// card this un-keeps the design behind it.
router.delete('/artworks/:id/keep', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    await unkeepArtwork({ artworkId: artwork.id, repo: getRepo() });
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

// ---- Video prompt editing (Scott, 2026-08-05) ------------------------------
// The reviewer sees each design's video prompt(s) and can edit them BEFORE the
// motion spend. act1 = motion_prompt (every surface); act2 = motion_prompt_act2
// (spectacular's second segment). Guardrails run on save — a blocked edit is a
// clean 422, nothing stored. Only stills carry editable prompts (the video is
// a render OF a still).
router.patch('/artworks/:id/motion-prompt', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    if (artwork.stage !== 'still') return res.status(400).json({ error: 'not_a_still', message: 'Video prompts live on the design, not the video.' });
    if (artwork.status === 'superseded') return res.status(409).json({ error: 'already_replaced', message: 'This design was already replaced.' });

    // Error copy is Scott-facing (it renders verbatim in the dashboard panel),
    // so it speaks "directions", never "prompt"/"act1" (UX review, 2026-08-05).
    const patch = {};
    for (const [field, key, label] of [['act1', 'motionPrompt', 'first half'], ['act2', 'motionPromptAct2', 'second half']]) {
      const value = req.body?.[field];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !value.trim()) {
        return res.status(400).json({ error: 'empty_prompt', message: `The ${label} directions can't be empty.` });
      }
      const check = checkPrompt(value);
      if (!check.allowed) {
        return res.status(422).json({ error: 'guardrail', message: `Those directions aren't allowed here: ${check.reasons.join('; ')}` });
      }
      patch[key] = value.trim();
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing_to_update', message: 'Nothing to save yet — change the directions first.' });

    const updated = await getRepo().updateArtwork(artwork.id, patch);
    res.json({ artwork: updated });
  } catch (err) {
    next(err);
  }
});

// Reset a design's video prompt(s) to the engine's generated versions —
// rebuilt from the design's own recipe, so "Reset" after an edit gone wrong
// always lands back on something known-good.
router.post('/artworks/:id/motion-prompt/reset', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    if (artwork.stage !== 'still') return res.status(400).json({ error: 'not_a_still', message: 'Video prompts live on the design, not the video.' });

    // Recover the option slot from the storage key (same recovery as the
    // orchestrator's regenerate paths); the run supplies the week seed.
    const run = await getRepo().getRun(artwork.run_id);
    const optMatch = /\/opt(\d+)\//.exec(artwork.s3_key_final || artwork.thumbnail_key || '');
    const option = optMatch ? Number(optMatch[1]) : 1;
    const args = { style: artwork.style, specKey: artwork.spec_key, option, weekOf: run?.week_of };
    const patch = { motionPrompt: buildMotionPrompt(args) };
    if (artwork.style === 'frame_break') {
      patch.motionPromptAct2 = buildSpectacularAct({ specKey: artwork.spec_key, option, weekOf: run?.week_of, act: 2 });
    }
    const updated = await getRepo().updateArtwork(artwork.id, patch);
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

// The storyboard's second panel — the closing frame the 30s piece ends on.
// Thumbnail by default (grid); ?full=1 streams the master for the lightbox.
router.get('/artworks/:id/closing', async (req, res, next) => {
  try {
    const artwork = await loadArtwork(req, res);
    if (!artwork) return;
    const key = req.query.full === '1'
      ? (artwork.closing_key || artwork.closing_thumb_key)
      : (artwork.closing_thumb_key || artwork.closing_key);
    await streamKey(key, res);
  } catch (err) {
    next(err);
  }
});

// Stream an object by key from whichever store is active.
async function streamKey(key, res) {
  if (!key) return res.status(404).json({ error: 'no_media' });
  const store = await getStore();
  const type = contentTypeFor(key);
  // Artwork files are immutable: every generation writes its own key (see the
  // `variant` segment in storage/artworkKey), and a re-roll inserts a NEW row
  // rather than overwriting. So the browser can keep them forever. Previously
  // the proxy sent max-age=300 with no validator, which meant scrolling back
  // after five minutes re-downloaded whole 4K files (perf audit, 2026-07-26).
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

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
