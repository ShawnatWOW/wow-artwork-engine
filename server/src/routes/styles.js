// Style Library API (2026-09-14).
//
//   GET    /api/styles                    every style + usage ({ used, approved })
//   POST   /api/styles                    { url, name } → 202, analysis runs in the background
//   POST   /api/styles/upload?name=&filename=   raw body (image/video) → 202
//   GET    /api/styles/:id
//   PATCH  /api/styles/:id                { label, style, cast, enabled, favorite, weight }
//   DELETE /api/styles/:id                user-added only; built-ins are disabled, not deleted
//   POST   /api/styles/:id/preview        re-render the "on the sign" preview → 202
//   POST   /api/styles/:id/reanalyze      rewrite the card from the stored frames → 202
//   GET    /api/styles/:id/media/:kind    thumbnail | preview | preview_full | source | frame-<n>
//
// Uploads arrive as a raw body (the dashboard proxy forwards the bytes with
// the name in the query) — no multipart parser to add, and a 250 MB screen
// recording stays a single request.

import { Router, raw } from 'express';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import config from '../config/index.js';
import logger from '../config/logger.js';
import { getRepo } from '../db/index.js';
import { ingestStyle, previewStyle, reanalyzeStyle } from '../services/styles/ingest.js';
import { ensureBuiltins, isComplete } from '../services/styles/library.js';
import { streamKey } from './artworks.js';

const router = Router();

async function loadStyle(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'invalid_style_id' }); return null; }
  const row = await getRepo().getStyle(id);
  if (!row) { res.status(404).json({ error: 'style_not_found', message: 'That style no longer exists.' }); return null; }
  return row;
}

// One shape for the dashboard: the row plus usage + whether it can roll.
function present(row, usage = {}) {
  return {
    ...row,
    usage: usage[row.key] || { used: 0, approved: 0 },
    complete: isComplete(row),
    has_preview: Boolean(row.preview_thumb_key || row.preview_key),
    has_thumbnail: Boolean(row.thumbnail_key),
  };
}

router.get('/styles', async (_req, res, next) => {
  try {
    const repo = getRepo();
    await ensureBuiltins(repo);
    const [rows, usage] = await Promise.all([repo.listStyles(), repo.styleUsage()]);
    const styles = rows.map((r) => present(r, usage));
    res.json({
      styles,
      pool: {
        enabled: styles.filter((s) => s.enabled && s.status === 'ready' && s.complete).length,
        favorites: styles.filter((s) => s.favorite && s.enabled && s.status === 'ready' && s.complete).length,
      },
      links: { instagram: Boolean(config.styles.apifyToken) },
      analyst: Boolean(config.openai.apiKey),
    });
  } catch (err) { next(err); }
});

// Add from a link.
router.post('/styles', async (req, res, next) => {
  try {
    const { url, name } = req.body || {};
    const { style } = await ingestStyle({
      name, source: { kind: 'link', url }, createdBy: req.get('x-user-email') || null,
    });
    res.status(202).json({ style: present(style) });
  } catch (err) {
    if (err.code === 'bad_link' || err.code === 'bad_source') return res.status(400).json({ error: err.code, message: err.message });
    next(err);
  }
});

// Add from an upload (raw bytes).
router.post('/styles/upload', raw({ type: () => true, limit: config.styles.maxUploadBytes }), async (req, res, next) => {
  let dir = null;
  try {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'empty_upload', message: 'The upload was empty.' });
    const filename = String(req.query.filename || req.get('x-file-name') || 'upload').replace(/[^\w.\-]+/g, '_').slice(0, 120);
    if (!/\.(png|jpe?g|webp|gif|heic|heif|mp4|mov|m4v|webm|mkv)$/i.test(filename)) {
      return res.status(415).json({ error: 'unsupported_type', message: 'Upload a PNG, JPG, WEBP, GIF, MP4 or MOV.' });
    }
    // Land the bytes on disk; ingest copies from here and this dir is
    // removed once the background job has its own copy.
    dir = await mkdtemp(path.join(os.tmpdir(), 'wae-style-upload-'));
    const filePath = path.join(dir, filename);
    await writeFile(filePath, body);
    const { style, done } = await ingestStyle({
      name: req.query.name, source: { kind: 'file', path: filePath, filename },
      createdBy: req.get('x-user-email') || null,
    });
    const tmp = dir; dir = null;
    done.finally(() => rm(tmp, { recursive: true, force: true }).catch(() => {}));
    res.status(202).json({ style: present(style) });
  } catch (err) {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: `That file is over ${Math.round(config.styles.maxUploadBytes / 1048576)} MB — trim the recording or screenshot the part you like.` });
    next(err);
  }
});

router.get('/styles/:id', async (req, res, next) => {
  try {
    const row = await loadStyle(req, res);
    if (!row) return;
    const usage = await getRepo().styleUsage();
    res.json({ style: present(row, usage) });
  } catch (err) { next(err); }
});

router.patch('/styles/:id', async (req, res, next) => {
  try {
    const row = await loadStyle(req, res);
    if (!row) return;
    const b = req.body || {};
    const patch = {};
    if (b.label !== undefined) {
      const label = String(b.label).trim().slice(0, 60);
      if (!label) return res.status(400).json({ error: 'empty_label', message: 'A style needs a name.' });
      patch.label = label;
    }
    if (b.style !== undefined) patch.style = String(b.style).trim().slice(0, 600);
    if (b.cast !== undefined) {
      const c = b.cast && typeof b.cast === 'object' ? b.cast : {};
      patch.cast = {
        keeper: String(c.keeper ?? row.cast?.keeper ?? '').trim().slice(0, 200),
        hero: String(c.hero ?? row.cast?.hero ?? '').trim().slice(0, 200),
        companion: String(c.companion ?? row.cast?.companion ?? '').trim().slice(0, 200),
      };
    }
    if (b.enabled !== undefined) patch.enabled = Boolean(b.enabled);
    if (b.favorite !== undefined) patch.favorite = Boolean(b.favorite);
    if (b.weight !== undefined) {
      const w = Number(b.weight);
      if (!Number.isFinite(w) || w < 0 || w > 10) return res.status(400).json({ error: 'bad_weight' });
      patch.weight = w;
    }
    // Hand-writing the card completes a failed analysis.
    const merged = { ...row, ...patch };
    if (row.status === 'failed' && isComplete(merged)) { patch.status = 'ready'; patch.error = null; }
    const updated = await getRepo().updateStyle(row.id, patch);
    res.json({ style: present(updated, await getRepo().styleUsage()) });
  } catch (err) { next(err); }
});

router.delete('/styles/:id', async (req, res, next) => {
  try {
    const row = await loadStyle(req, res);
    if (!row) return;
    if (row.source_type === 'builtin') {
      return res.status(409).json({ error: 'builtin', message: 'Built-in styles can be switched off, not deleted.' });
    }
    await getRepo().deleteStyle(row.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

router.post('/styles/:id/preview', async (req, res, next) => {
  try {
    const row = await loadStyle(req, res);
    if (!row) return;
    if (!isComplete(row)) return res.status(409).json({ error: 'incomplete', message: 'Add a style sentence and all three cast members first.' });
    // Fire and poll — the still takes ~20s live.
    previewStyle({ styleId: row.id }).catch((err) => logger.warn({ styleId: row.id, err: err.message }, 'Preview re-render failed'));
    res.status(202).json({ style: present(row) });
  } catch (err) { next(err); }
});

// Re-run the analyst on the stored frames (a better analyst, or a renamed
// style) — no re-upload. 202 + poll like a first-time add.
router.post('/styles/:id/reanalyze', async (req, res, next) => {
  try {
    const row = await loadStyle(req, res);
    if (!row) return;
    if (row.source_type === 'builtin') return res.status(409).json({ error: 'builtin', message: 'Built-in styles have no reference to re-analyze.' });
    if (!row.frame_keys?.length) return res.status(409).json({ error: 'no_frames', message: 'This style has no stored frames — add it again from the reference.' });
    if (row.status === 'analyzing') return res.status(409).json({ error: 'busy', message: 'This style is already being analyzed.' });
    reanalyzeStyle({ styleId: row.id }).catch((err) => logger.warn({ styleId: row.id, err: err.message }, 'Re-analysis failed'));
    res.status(202).json({ style: present({ ...row, status: 'analyzing' }) });
  } catch (err) { next(err); }
});

router.get('/styles/:id/media/:kind', async (req, res, next) => {
  try {
    const row = await loadStyle(req, res);
    if (!row) return;
    const kind = String(req.params.kind);
    let key = null;
    if (kind === 'thumbnail') key = row.thumbnail_key || row.frame_keys?.[0] || null;
    else if (kind === 'preview') key = row.preview_thumb_key || row.preview_key;
    else if (kind === 'preview_full') key = row.preview_key || row.preview_thumb_key;
    else if (kind === 'source') key = row.source_key;
    else if (/^frame-\d+$/.test(kind)) key = row.frame_keys?.[Number(kind.slice(6)) - 1] || null;
    else return res.status(400).json({ error: 'unknown_media_kind' });
    await streamKey(key, res);
  } catch (err) { next(err); }
});

export default router;
