// Handoff to Jeff (Build Plan M3).
//
// Ships a run's APPROVED motion pieces: upload each to the watched Google Drive
// folder, then email Jeff (as a real @wowmedia.com person via Gmail) with the
// Drive links + small thumbnail previews. Records a `deliveries` row per piece.
//
// Offline-first + honest: when Drive/Gmail aren't configured, files are copied
// to a local folder and the email is written as a .eml — and the result is
// reported as NOT delivered (never a fake "sent"). `delivered` is true only on
// a real Gmail send.

import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';

import config from '../../config/index.js';
import logger from '../../config/logger.js';
import { getStore } from '../storage/index.js';
import { getRepo } from '../../db/index.js';
import * as drive from './drive.js';
import * as gmail from './gmail.js';

const MAX_ATTACH_BYTES = 2_000_000; // attach small previews only; link the videos

/** What's configured vs offline, and what's missing. Pure-ish (reads config). */
export function deliveryPreflight(cfg = config) {
  const driveConfigured = Boolean(cfg.drive.folderId && (cfg.drive.serviceAccountJson || cfg.drive.oauthRefreshToken));
  const gmailConfigured = Boolean(cfg.publish.serviceAccountJson);
  const missing = [];
  if (!driveConfigured) missing.push('Google Drive: GOOGLE_DRIVE_FOLDER_ID + GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!gmailConfigured) missing.push('Gmail: GOOGLE_SERVICE_ACCOUNT_JSON + domain-wide delegation for gmail.send');
  return {
    drive: { configured: driveConfigured },
    gmail: { configured: gmailConfigured, senders: cfg.publish.senders, defaultFrom: cfg.publish.from, to: cfg.publish.to },
    overall: driveConfigured && gmailConfigured ? 'live' : 'offline',
    missing,
  };
}

/** The default editable email draft. Pure. */
export function defaultDraft({ recipient, weekOf, items }) {
  const first = String(recipient).split('@')[0].split(/[.\-_]/)[0];
  const name = first ? first[0].toUpperCase() + first.slice(1) : 'there';
  const subject = `WOW artwork — week of ${weekOf} (${items.length} ready)`;
  const body = [
    `Hi ${name},`,
    '',
    `${items.length} approved piece(s) for the week of ${weekOf} are in the Drive folder, sized to spec and ready to run:`,
    '',
    ...items.map((i) => `- ${i.surface} / ${i.style} (${i.width}x${i.height})`),
    '',
    'Please switch these into rotation. Thanks!',
    '',
    '- WOW Artwork Engine',
  ].join('\n');
  return { subject, body };
}

function approvedMotions(artworks) {
  return artworks.filter((a) => a.stage === 'motion' && a.status === 'approved');
}

/** Draft + attachments + preflight for the run's approved pieces. */
export async function previewHandoff({ runId, deps = {} }) {
  const repo = deps.repo || getRepo();
  const run = await repo.getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  const items = approvedMotions(await repo.listArtworks(runId));
  const preflight = deliveryPreflight();
  return {
    run,
    preflight,
    draft: defaultDraft({ recipient: preflight.gmail.to, weekOf: run.week_of, items }),
    items: items.map((a) => ({ id: a.id, surface: a.surface, style: a.style, width: a.width, height: a.height })),
  };
}

/**
 * Ship the run's approved pieces. @returns {Promise<result>} where
 * result.delivered is true ONLY on a real Gmail send.
 */
export async function sendRun({ runId, sender, recipient, subject, body, test = false, deps = {} }) {
  const repo = deps.repo || getRepo();
  const store = deps.store || (await getStore());
  const driveApi = deps.drive || drive;
  const gmailApi = deps.gmail || gmail;
  const pre = deps.preflight || deliveryPreflight();

  const run = await repo.getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  const items = approvedMotions(await repo.listArtworks(runId));
  if (!items.length) throw new Error('No approved pieces to send. Approve at least one animated piece first.');

  const from = sender || config.publish.from;
  const to = test ? from : (recipient || config.publish.to); // test = send to yourself
  const draft = defaultDraft({ recipient: to, weekOf: run.week_of, items });
  const finalSubject = subject || draft.subject;
  const useDrive = pre.drive.configured;
  const useGmail = pre.gmail.configured;

  const localDir = deps.localDir || path.resolve(process.cwd(), config.delivery.localDir, `run${runId}`);
  const workDir = await mkdtemp(path.join(os.tmpdir(), `wae-handoff-${runId}-`));

  const links = [];
  const attachments = [];
  try {
    // 1. Deliver each file (Drive live, or a local copy offline).
    for (const a of items) {
      const localFinal = path.join(workDir, `artwork_${a.id}.mp4`);
      await writeFile(localFinal, await store.getBuffer(a.s3_key_final));
      const fileName = `WOW_${run.week_of}_${a.surface}_${a.style}_${a.id}.mp4`;

      let method; let destination; let link = null; let status;
      if (useDrive) {
        const up = await driveApi.deliver({ filePath: localFinal, fileName, mimeType: 'video/mp4' });
        method = 'drive'; destination = up.webViewLink || up.id; link = up.webViewLink || null; status = 'sent';
      } else {
        const dest = path.join(localDir, fileName);
        await mkdir(path.dirname(dest), { recursive: true });
        await copyFile(localFinal, dest);
        method = 'local'; destination = dest; status = 'offline';
      }
      const row = await repo.insertDelivery({
        artworkId: a.id, method, destination, status,
        sentAt: status === 'sent' ? new Date().toISOString() : null,
      });
      links.push({ a, fileName, link, destination, deliveryId: row.id, status });

      // Attach the small thumbnail preview (link the heavy video).
      if (a.thumbnail_key) {
        const thumb = await store.getBuffer(a.thumbnail_key);
        if (thumb.length <= MAX_ATTACH_BYTES) {
          attachments.push({ filename: fileName.replace(/\.mp4$/, '.jpg'), mimeType: 'image/jpeg', content: thumb });
        }
      }
    }

    // 2. Email Jeff — Drive links + thumbnails.
    const linkLines = links.map((l) => `- ${l.a.surface}/${l.a.style}: ${l.link || l.destination}`);
    const text = `${body || draft.body}\n\nFiles:\n${linkLines.join('\n')}`;

    let email;
    if (useGmail) {
      try {
        const r = await gmailApi.sendMail({ from, to, subject: finalSubject, text, attachments, saJson: config.publish.serviceAccountJson, domain: config.publish.domain });
        email = { status: 'sent', messageId: r.messageId };
        const notifiedAt = new Date().toISOString();
        for (const l of links) await repo.updateDelivery(l.deliveryId, { jeffNotifiedAt: notifiedAt });
      } catch (err) {
        email = { status: 'failed', error: err.message };
        logger.error({ runId, err: err.message }, 'Gmail send failed');
      }
    } else {
      const eml = gmailApi.buildMimeMessage({ from, to, subject: finalSubject, text, attachments });
      const emlPath = path.join(localDir, `notify_${Date.now()}.eml`);
      await mkdir(path.dirname(emlPath), { recursive: true });
      await writeFile(emlPath, eml);
      email = { status: 'offline', emlPath };
    }

    const delivered = useDrive && email.status === 'sent';
    logger.info({ runId, count: items.length, drive: useDrive ? 'live' : 'offline', email: email.status, delivered }, 'Handoff finished');
    return {
      runId, delivered, count: items.length, from, to,
      drive: useDrive ? 'live' : 'offline',
      email: email.status,
      detail: email,
      offlineDir: useDrive && useGmail ? null : localDir,
      deliveries: await repo.listDeliveries(runId),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export default { deliveryPreflight, defaultDraft, previewHandoff, sendRun };
