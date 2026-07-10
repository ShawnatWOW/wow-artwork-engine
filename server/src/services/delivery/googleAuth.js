// Google service-account auth — shared by the Drive upload and the Gmail send.
//
// Mints an RS256-signed JWT assertion and exchanges it for a short-lived access
// token. When `subject` is set, the token impersonates that mailbox via
// domain-wide delegation — required for Gmail to send AS a real @wowmedia.com
// person (Scott/Shawn) rather than a no-reply. Pure Node crypto, no SDK.

import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Parse a service-account key from a JSON string or object. */
export function parseServiceAccount(sa) {
  return typeof sa === 'string' ? JSON.parse(sa) : sa;
}

/**
 * @param {object} opts
 * @param {string|object} opts.saJson  service-account key (JSON string or object)
 * @param {string} opts.scope          space-delimited OAuth scope(s)
 * @param {string} [opts.subject]      mailbox to impersonate (domain-wide delegation)
 * @returns {Promise<string>} access token
 */
export async function accessToken({ saJson, scope, subject }) {
  const sa = parseServiceAccount(saJson);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
    ...(subject ? { sub: subject } : {}),
  }));
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${claim}`)
    .sign(sa.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const assertion = `${header}.${claim}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) {
    // 'unauthorized_client' here almost always means domain-wide delegation
    // isn't authorized for this SA + scope (see KEYS.md / handoff playbook).
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()).access_token;
}

export default { accessToken, b64url, parseServiceAccount };
