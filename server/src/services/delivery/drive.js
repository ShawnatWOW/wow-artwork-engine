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
import crypto from 'node:crypto';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// RESUMABLE upload (2026-08-19): the old uploadType=multipart endpoint caps the
// whole request at ~5 MB — fine for the 10s/720p iteration files, but the real
// deliveries (30s + Topaz 4K) are hundreds of MB, and Google rejected them,
// which surfaced as the Send-to-Jeff 500. Resumable = one small JSON init that
// returns a session URI, then the bytes PUT to it STREAMED from disk — no size
// cap that matters here, and no whole-video Buffer in memory.
const RESUMABLE_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Service account → signed JWT → access token.
async function tokenFromServiceAccount(saJson) {
  const sa = typeof saJson === 'string' ? JSON.parse(saJson) : saJson;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${claim}`)
    .sign(sa.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const assertion = `${header}.${claim}.${signature}`;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`Drive SA token failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

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
  if (cfg.serviceAccountJson) return tokenFromServiceAccount(cfg.serviceAccountJson);
  if (cfg.oauthRefreshToken) return tokenFromRefresh(cfg);
  throw new Error(
    'Google Drive not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON or the GOOGLE_OAUTH_* vars.',
  );
}

/**
 * Upload a file to the configured Drive folder.
 * @returns {Promise<{ id, name, webViewLink, method }>}
 */
export async function deliver({ filePath, fileName, mimeType = 'video/mp4' }, cfg = config.drive) {
  if (!cfg.folderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID not set.');
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
    body: JSON.stringify({ name, parents: [cfg.folderId] }),
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
