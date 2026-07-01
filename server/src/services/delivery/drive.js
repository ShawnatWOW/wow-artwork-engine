// Google Drive delivery (LOCKED handoff method).
//
// Uploads a final artwork file into the watched WOW Drive folder. Auth supports
// either a service account (JSON key → signed JWT) or an OAuth refresh token;
// whichever is configured yields a short-lived access token used for the
// resumable/multipart upload. Gated on config — throws clearly if unconfigured,
// matching the generation-provider pattern (no silent failures).

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import crypto from 'node:crypto';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true';
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
  const data = await readFile(filePath);

  const boundary = `wae-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name, parents: [cfg.folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(`${UPLOAD_URL}&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  const out = await res.json();
  logger.info({ id: out.id, name: out.name }, 'Delivered to Drive');
  return { ...out, method: 'drive' };
}

export default { deliver };
