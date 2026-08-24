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

/**
 * Plain-English panel name for a delivered piece. EON rows carry a panel id
 * ('pod2_spine') because one wrapped master is cut into each pod's spine and
 * face — Jeff needs to know which panel a file drives. Pure.
 */
export function panelName(a) {
  if (!a.panel) return null;
  const [pod, kind] = String(a.panel).split('_');
  return `pillar ${pod.replace('pod', '')} ${kind}`;
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
    ...items.map((i) => {
      // An EON set arrives as ONE master strip (Jeff, 2026-08-21) — say so.
      if (i.panel === 'master') {
        return `- ${i.surface} / ${i.style} — one master file (${i.width}x${i.height}: spine 64 + face 256 per pillar, left to right)`;
      }
      const panel = panelName(i);
      return `- ${i.surface} / ${i.style}${panel ? ` — ${panel}` : ''} (${i.width}x${i.height})`;
    }),
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

/**
 * Group a run's approved motion rows into the FILES Jeff receives.
 * - spectacular → one file per approved video (unchanged)
 * - EON → ONE wrapped master per pillar set (Jeff, 2026-08-21: "If you are
 *   able to send it as one master file that would speed up the turnaround
 *   time"). The master (spines + faces side by side, 960×384 for the 3-pillar
 *   set, 320×384 for a single) is already rendered and stored on the
 *   eon_sequences row; the per-panel rows stay for review, but delivery ships
 *   the master once and marks every panel of the set sent.
 * A set counts as approved when any of its panels is (the dashboard approves
 * them as a group). Legacy EON rows with no sequence fall back to per-file.
 * Pure.
 */
export function deliverables(artworks, sequences = []) {
  const approved = approvedMotions(artworks);
  const byId = new Map(artworks.map((a) => [a.id, a]));
  const units = [];
  const claimed = new Set();
  for (const seq of sequences) {
    const panelIds = [
      seq.face1_artwork_id, seq.face2_artwork_id, seq.face3_artwork_id,
      seq.spine1_artwork_id, seq.spine2_artwork_id, seq.spine3_artwork_id,
    ].filter((id) => id != null);
    const panels = panelIds.map((id) => byId.get(id)).filter(Boolean);
    const approvedPanels = panels.filter((p) => p.status === 'approved');
    if (!seq.master_s3_key || approvedPanels.length === 0) continue;
    for (const id of panelIds) claimed.add(id);
    const sample = approvedPanels[0];
    // Master dims = the panels laid side by side (64 + 256 per pillar).
    const width = panels.reduce((w, p) => w + (p.width || 0), 0);
    units.push({ kind: 'master', sequence: seq, panels, sample, width, height: sample.height });
  }
  for (const a of approved) {
    if (!claimed.has(a.id)) units.push({ kind: 'file', artwork: a });
  }
  return units;
}

/** One deliverable → the item shape the draft/dialog render. Pure. */
function unitItem(u) {
  return u.kind === 'master'
    ? { id: u.sample.id, surface: u.sample.surface, style: u.sample.style, panel: 'master', width: u.width, height: u.height }
    : { id: u.artwork.id, surface: u.artwork.surface, style: u.artwork.style, panel: u.artwork.panel ?? null, width: u.artwork.width, height: u.artwork.height };
}

/** Draft + attachments + preflight for the run's approved pieces. */
export async function previewHandoff({ runId, deps = {} }) {
  const repo = deps.repo || getRepo();
  const run = await repo.getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  const [artworks, sequences] = await Promise.all([
    repo.listArtworks(runId),
    repo.listEonSequences(runId),
  ]);
  const items = deliverables(artworks, sequences).map(unitItem);
  const preflight = deliveryPreflight();
  return {
    run,
    preflight,
    draft: defaultDraft({ recipient: preflight.gmail.to, weekOf: run.week_of, items }),
    items,
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
  const [artworks, sequences] = await Promise.all([
    repo.listArtworks(runId),
    repo.listEonSequences(runId),
  ]);
  const units = deliverables(artworks, sequences);
  const items = units.map(unitItem);
  if (!units.length) throw new Error('No approved pieces to send. Approve at least one animated piece first.');

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
    // 1. Deliver each unit (Drive live, or a local copy offline). An EON set
    //    is ONE unit: its wrapped master file (Jeff, 2026-08-21).
    for (const u of units) {
      const a = u.kind === 'master' ? u.sample : u.artwork;
      const sourceKey = u.kind === 'master' ? u.sequence.master_s3_key : a.s3_key_final;
      const localFinal = path.join(workDir, `artwork_${a.id}.mp4`);
      await writeFile(localFinal, await store.getBuffer(sourceKey));
      // Spectacular files name the piece; a master file says it IS the whole
      // strip. (Per-panel names — pod1_spine … — only appear for legacy EON
      // rows that predate sequences.)
      const fileName = u.kind === 'master'
        ? `WOW_${run.week_of}_${a.surface}_${a.style}_master_${u.width}x${u.height}_${u.sequence.id}.mp4`
        : `WOW_${run.week_of}_${a.surface}_${a.style}${a.panel ? `_${a.panel}` : ''}_${a.width}x${a.height}_${a.id}.mp4`;

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
      // A master delivery covers EVERY panel of its set — they all get marked
      // sent together, since Jeff received the whole strip in one file.
      const coveredIds = u.kind === 'master' ? u.panels.map((p) => p.id) : [a.id];
      links.push({ a, fileName, link, destination, deliveryId: row.id, status, coveredIds, master: u.kind === 'master' });

      // Attach the small thumbnail preview (link the heavy video).
      if (a.thumbnail_key) {
        const thumb = await store.getBuffer(a.thumbnail_key);
        if (thumb.length <= MAX_ATTACH_BYTES) {
          attachments.push({ filename: fileName.replace(/\.mp4$/, '.jpg'), mimeType: 'image/jpeg', content: thumb });
        }
      }
    }

    // 2. Email Jeff — Drive links + thumbnails.
    const linkLines = links.map((l) => {
      if (l.master) return `- ${l.a.surface}/${l.a.style} — master strip: ${l.link || l.destination}`;
      const panel = panelName(l.a);
      return `- ${l.a.surface}/${l.a.style}${panel ? ` — ${panel}` : ''}: ${l.link || l.destination}`;
    });
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

    // 3. Mark the delivered pieces SENT. Until now only the delivery ROW
    //    recorded this, never the artwork — so the dashboard's whole 'sent'
    //    state was unreachable: the "Send N to Jeff" button stayed armed after
    //    a successful hand-off and a second click re-uploaded every file to
    //    Drive and re-emailed Jeff (UX audit 2026-08-19). Only pieces whose
    //    file actually landed are marked; an offline (local-copy) run leaves
    //    them approved so the real send still has to happen.
    const landed = links.filter((l) => l.status === 'sent');
    for (const l of landed) {
      for (const id of l.coveredIds) {
        await repo.updateArtwork(id, { status: 'sent' }).catch((err) => {
          logger.warn({ runId, artworkId: id, err: err.message }, 'Could not mark artwork sent');
        });
      }
    }

    const delivered = useDrive && email.status === 'sent';
    logger.info({ runId, count: units.length, sentCount: landed.length, drive: useDrive ? 'live' : 'offline', email: email.status, delivered }, 'Handoff finished');
    return {
      runId, delivered, count: units.length, from, to,
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
