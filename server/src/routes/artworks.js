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
import { getRepo } from '../db/index.js';
import { getStore } from '../services/storage/index.js';
import { contentTypeFor } from '../services/storage/s3.js';

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
