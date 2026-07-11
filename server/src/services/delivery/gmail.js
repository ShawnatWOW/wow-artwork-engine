// Gmail send — the Jeff notification, as a real @wowmedia.com person.
//
// Sends via the Gmail API using a service account with domain-wide delegation
// (impersonating the sender mailbox). Replaces the old nodemailer/SMTP path.
// buildMimeMessage is pure (unit-tested); sendMail wraps it with auth + POST.
//
// Attachments: keep the message small — Gmail's simple messages.send caps around
// 5 MB, and motion files are far bigger. The handoff LINKS the Drive files and
// attaches only small previews (thumbnails/stills). See handoff.js.

import crypto from 'node:crypto';
import { accessToken, b64url } from './googleAuth.js';

const GMAIL_SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

// RFC 2047-encode a header only if it has non-ASCII (else an em-dash mojibakes).
function encodeHeader(s) {
  return /^[\x00-\x7F]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

/**
 * Validate an address against the allowed domain, and reject header injection.
 * Guards both sender and recipient (no open relay, no CR/LF injection).
 */
export function assertAllowed(addr, domain = 'wowmedia.com') {
  if (typeof addr !== 'string' || /[\r\n]/.test(addr)) throw new Error(`Illegal email address: ${JSON.stringify(addr)}`);
  if (!new RegExp(`^[^@\\s]+@${domain.replace('.', '\\.')}$`, 'i').test(addr)) {
    throw new Error(`Refusing to send to/from "${addr}" — must be @${domain}`);
  }
  return addr;
}

/**
 * Build a base RFC 5322 / MIME message. Pure.
 * @param {{ from, to, subject, text, attachments? }} opts
 *        attachments: [{ filename, mimeType, content: Buffer }]
 * @returns {string} the raw message (CRLF line endings)
 */
export function buildMimeMessage({ from, to, subject, text, attachments = [], boundary = 'wae-boundary' }) {
  const parts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    text,
  ];
  for (const att of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${att.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${att.filename}"`,
      '',
      att.content.toString('base64').replace(/(.{76})/g, '$1\n'),
    );
  }
  parts.push(`--${boundary}--`, '');
  // Normalize every line ending to CRLF (MIME requirement).
  return parts.join('\n').replace(/\r?\n/g, '\r\n');
}

/**
 * Send an email as `from` via Gmail. @returns {Promise<{ sent, messageId }>}
 */
export async function sendMail({ from, to, subject, text, attachments = [], saJson, domain = 'wowmedia.com' }) {
  assertAllowed(from, domain);
  assertAllowed(to, domain);
  const token = await accessToken({ saJson, scope: SCOPE, subject: from });
  const raw = b64url(buildMimeMessage({ from, to, subject, text, attachments, boundary: `wae-${crypto.randomUUID()}` }));

  const res = await fetch(GMAIL_SEND, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${res.status} ${await res.text()}`);
  return { sent: true, messageId: (await res.json()).id };
}

export { encodeHeader, SCOPE };
export default { sendMail, buildMimeMessage, assertAllowed };
