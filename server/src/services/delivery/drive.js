// Google Drive delivery (LOCKED handoff method).
//
// Uploads a final artwork file into the watched WOW Drive folder. Auth supports
// either a service account (JSON key → signed JWT) or an OAuth refresh token;
// whichever is configured yields a short-lived access token used for the
// resumable/multipart upload. Gated on config — throws clearly if unconfigured,
// matching the generation-provider pattern (no silent failures).

import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import config from '../../config/index.js';
import logger from '../../config/logger.js';
import { accessToken as saAccessToken } from './googleAuth.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// RESUMABLE upload (2026-08-19): the old uploadType=multipart endpoint caps the
// whole request at ~5 MB — fine for the 10s/720p iteration files, but the real
// deliveries (30s + Topaz 4K) are hundreds of MB, and Google rejected them,
// which surfaced as the Send-to-Jeff 500. Resumable = one small JSON init that
// returns a session URI, then the bytes PUT to it STREAMED from disk — no size
// cap that matters here, and no whole-video Buffer in memory.
const RESUMABLE_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

// Service-account auth lives in googleAuth.js (shared with the Gmail send —
// one parser, one JWT flow, one place that understands inline-JSON / file-path
// / base64 key shapes).

// OAuth refresh token → access token.
async function tokenFromRefresh({ oauthClientId, oauthClientSecret, oauthRefreshToken }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauthClientId,
      client_secret: oauthClientSecret,
      refresh_token: oauthRefreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Drive OAuth token failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function getAccessToken(cfg = config.drive) {
  if (cfg.serviceAccountJson) return saAccessToken({ saJson: cfg.serviceAccountJson, scope: SCOPE });
  if (cfg.oauthRefreshToken) return tokenFromRefresh(cfg);
  throw new Error(
    'Google Drive not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON or the GOOGLE_OAUTH_* vars.',
  );
}

/**
 * Upload a file to the configured Drive folder.
 * @returns {Promise<{ id, name, webViewLink, method }>}
 */
/**
 * Accept GOOGLE_DRIVE_FOLDER_ID as a bare id OR a pasted browser URL
 * (https://drive.google.com/drive/folders/<id>?usp=…). Production shipped the
 * URL form and Drive answered "File not found: <the whole url>" (2026-08-19) —
 * extract the id instead of making config paste-perfection a delivery outage.
 */
export function normalizeFolderId(value) {
  const s = String(value || '').trim();
  const m = /\/folders\/([A-Za-z0-9_-]+)/.exec(s) || /[?&]id=([A-Za-z0-9_-]+)/.exec(s);
  return m ? m[1] : s;
}

export async function deliver({ filePath, fileName, mimeType = 'video/mp4' }, cfg = config.drive) {
  if (!cfg.folderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID not set.');
  const folderId = normalizeFolderId(cfg.folderId);
  const name = fileName || basename(filePath);
  const token = await getAccessToken(cfg);
  const { size } = await stat(filePath);

  // 1. Init the resumable session — a tiny JSON request that carries the
  //    metadata and answers with the one-time upload URI.
  const init = await fetch(`${RESUMABLE_URL}&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  if (!init.ok) throw new Error(`Drive upload init failed: ${init.status} ${await init.text()}`);
  const session = init.headers.get('location');
  if (!session) throw new Error('Drive upload init returned no session URI.');

  // 2. Stream the bytes from disk in one PUT — a 300 MB delivery costs no more
  //    memory than a small one. duplex:'half' is undici's requirement for
  //    stream bodies.
  const res = await fetch(session, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType, 'Content-Length': String(size) },
    body: createReadStream(filePath),
    duplex: 'half',
  });
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  const out = await res.json();
  logger.info({ id: out.id, name: out.name, bytes: size }, 'Delivered to Drive');
  return { ...out, method: 'drive' };
}

export default { deliver };
