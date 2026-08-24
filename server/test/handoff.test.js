import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildMimeMessage, assertAllowed } from '../src/services/delivery/gmail.js';
import { deliveryPreflight, defaultDraft, previewHandoff, sendRun } from '../src/services/delivery/handoff.js';
import { createMemoryRepo } from '../src/db/memoryRepo.js';
import { createLocalStore } from '../src/services/storage/local.js';

// --- pure MIME + allowlist -------------------------------------------------

test('buildMimeMessage produces CRLF MIME with headers + a base64 attachment', () => {
  const msg = buildMimeMessage({
    from: 'scott@wowmedia.com', to: 'jeff@wowmedia.com', subject: 'Hi', text: 'line1\nline2',
    attachments: [{ filename: 'a.jpg', mimeType: 'image/jpeg', content: Buffer.from('hello') }],
  });
  assert.match(msg, /^From: scott@wowmedia\.com\r\n/);
  assert.match(msg, /\r\nTo: jeff@wowmedia\.com\r\n/);
  assert.match(msg, /Content-Type: multipart\/mixed; boundary="wae-boundary"/);
  assert.match(msg, /Content-Disposition: attachment; filename="a\.jpg"/);
  assert.match(msg, new RegExp(Buffer.from('hello').toString('base64')));
  assert.ok(!/[^\r]\n/.test(msg), 'every LF is preceded by CR');
});

test('buildMimeMessage RFC-2047 encodes a non-ASCII subject (no mojibake)', () => {
  const msg = buildMimeMessage({ from: 'a@wowmedia.com', to: 'b@wowmedia.com', subject: 'Ready — go', text: 'x' });
  assert.match(msg, /Subject: =\?UTF-8\?B\?/);
});

test('assertAllowed enforces the @wowmedia.com allowlist and blocks header injection', () => {
  assert.equal(assertAllowed('jeff@wowmedia.com'), 'jeff@wowmedia.com');
  assert.throws(() => assertAllowed('attacker@evil.com'));
  assert.throws(() => assertAllowed('jeff@wowmedia.com\r\nBcc: x@evil.com'));
});

// --- preflight + draft -----------------------------------------------------

test('deliveryPreflight is offline (and lists what is missing) when unconfigured', () => {
  const pf = deliveryPreflight({ drive: {}, publish: { senders: [], from: 'scott@wowmedia.com', to: 'jeff@wowmedia.com' } });
  assert.equal(pf.overall, 'offline');
  assert.equal(pf.drive.configured, false);
  assert.equal(pf.gmail.configured, false);
  assert.ok(pf.missing.length >= 2);
});

test('defaultDraft greets the recipient and lists the pieces', () => {
  const d = defaultDraft({ recipient: 'jeff@wowmedia.com', weekOf: '2026-08-10', items: [{ surface: 'eon', style: 'eon_single', width: 256, height: 384 }] });
  assert.match(d.subject, /week of 2026-08-10 \(1 ready\)/);
  assert.match(d.body, /Hi Jeff,/);
  assert.match(d.body, /eon \/ eon_single \(256x384\)/);
});

// --- offline send end-to-end ----------------------------------------------

async function runWithApprovedMotion() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wae-handoff-'));
  const repo = createMemoryRepo();
  const store = createLocalStore({ baseDir: base });
  const run = await repo.createRun({ weekOf: '2026-08-10', triggeredBy: 'test' });
  const src = path.join(base, 'src.mp4'); await writeFile(src, Buffer.alloc(1024, 7));
  const th = path.join(base, 'src.jpg'); await writeFile(th, Buffer.alloc(256, 3));
  await store.put({ key: 'runs/1/final.mp4', sourcePath: src });
  await store.put({ key: 'runs/1/thumb.jpg', sourcePath: th });
  await repo.insertArtwork({
    runId: run.id, surface: 'eon', style: 'eon_single', mediaType: 'video', stage: 'motion',
    specKey: 'eon_face', width: 256, height: 384, status: 'approved',
    s3KeyFinal: 'runs/1/final.mp4', thumbnailKey: 'runs/1/thumb.jpg',
  });
  return { base, repo, store, run };
}

const OFFLINE = { drive: { configured: false }, gmail: { configured: false, senders: [], to: 'jeff@wowmedia.com' }, overall: 'offline', missing: [] };

test('sendRun OFFLINE copies files locally, writes a .eml, and reports NOT delivered', async () => {
  const { base, repo, store, run } = await runWithApprovedMotion();
  const localDir = path.join(base, 'handoff');
  try {
    const result = await sendRun({ runId: run.id, deps: { repo, store, localDir, preflight: OFFLINE } });
    assert.equal(result.delivered, false); // honest: nothing really sent
    assert.equal(result.drive, 'offline');
    assert.equal(result.email, 'offline');
    assert.equal(result.deliveries.length, 1);
    assert.equal(result.deliveries[0].method, 'local');
    assert.equal(result.deliveries[0].status, 'offline');
    const files = await readdir(localDir);
    assert.ok(files.some((f) => f.endsWith('.mp4')), 'video copied locally');
    assert.ok(files.some((f) => f.endsWith('.eml')), '.eml written');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('sendRun LIVE (mocked Drive+Gmail) uploads, sends, and marks delivered', async () => {
  const { base, repo, store, run } = await runWithApprovedMotion();
  const calls = { upload: 0, send: 0 };
  const driveMock = { deliver: async () => { calls.upload += 1; return { id: 'f1', webViewLink: 'https://drive/f1' }; } };
  const gmailMock = { sendMail: async () => { calls.send += 1; return { sent: true, messageId: 'm1' }; }, buildMimeMessage };
  const LIVE = { drive: { configured: true }, gmail: { configured: true, senders: ['scott@wowmedia.com'], to: 'jeff@wowmedia.com' }, overall: 'live', missing: [] };
  try {
    const result = await sendRun({ runId: run.id, deps: { repo, store, drive: driveMock, gmail: gmailMock, preflight: LIVE } });
    assert.equal(calls.upload, 1);
    assert.equal(calls.send, 1);
    assert.equal(result.delivered, true);
    assert.equal(result.drive, 'live');
    assert.equal(result.email, 'sent');
    assert.equal(result.deliveries[0].status, 'sent');
    assert.ok(result.deliveries[0].jeff_notified_at, 'jeff_notified_at stamped on real send');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('sendRun refuses when there is nothing approved', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wae-handoff-empty-'));
  const repo = createMemoryRepo();
  const store = createLocalStore({ baseDir: base });
  const run = await repo.createRun({ weekOf: '2026-08-10', triggeredBy: 'test' });
  try {
    await assert.rejects(() => sendRun({ runId: run.id, deps: { repo, store, preflight: OFFLINE } }), /No approved pieces/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// A delivered piece must be marked SENT on the artwork itself, not only on the
// delivery row (UX audit 2026-08-19): the dashboard's whole 'sent' state hung
// off artwork.status, so after a real hand-off the "Send N to Jeff" button
// stayed armed and a second click re-uploaded every file and re-emailed Jeff.
test('sendRun LIVE marks the delivered artworks sent, so a second send has nothing to resend', async () => {
  const { base, repo, store, run } = await runWithApprovedMotion();
  const calls = { upload: 0, send: 0 };
  const driveMock = { deliver: async () => { calls.upload += 1; return { id: 'f1', webViewLink: 'https://drive/f1' }; } };
  const gmailMock = { sendMail: async () => { calls.send += 1; return { sent: true, messageId: 'm1' }; }, buildMimeMessage };
  const LIVE = { drive: { configured: true }, gmail: { configured: true, senders: ['scott@wowmedia.com'], to: 'jeff@wowmedia.com' }, overall: 'live', missing: [] };
  try {
    await sendRun({ runId: run.id, deps: { repo, store, drive: driveMock, gmail: gmailMock, preflight: LIVE } });
    const motion = (await repo.listArtworks(run.id)).find((a) => a.stage === 'motion');
    assert.equal(motion.status, 'sent', 'the delivered piece is marked sent');
    // Re-sending finds nothing approved — no duplicate upload, no duplicate email.
    await assert.rejects(
      () => sendRun({ runId: run.id, deps: { repo, store, drive: driveMock, gmail: gmailMock, preflight: LIVE } }),
      /No approved pieces/,
    );
    assert.equal(calls.upload, 1, 'file uploaded exactly once');
    assert.equal(calls.send, 1, 'Jeff emailed exactly once');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('sendRun OFFLINE leaves pieces approved — a local copy is not a delivery', async () => {
  const { base, repo, store, run } = await runWithApprovedMotion();
  try {
    await sendRun({ runId: run.id, deps: { repo, store, localDir: path.join(base, 'handoff'), preflight: OFFLINE } });
    const motion = (await repo.listArtworks(run.id)).find((a) => a.stage === 'motion');
    assert.equal(motion.status, 'approved', 'still needs a real send');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// --- EON master delivery (Jeff, 2026-08-21: "send it as one master file") ---

async function runWithApprovedEonSet() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wae-handoff-'));
  const repo = createMemoryRepo();
  const store = createLocalStore({ baseDir: base });
  const run = await repo.createRun({ weekOf: '2026-08-24', triggeredBy: 'test' });
  const vid = path.join(base, 'src.mp4'); await writeFile(vid, Buffer.alloc(1024, 7));
  const th = path.join(base, 'src.jpg'); await writeFile(th, Buffer.alloc(256, 3));
  await store.put({ key: 'runs/1/master.mp4', sourcePath: vid });
  await store.put({ key: 'runs/1/thumb.jpg', sourcePath: th });
  const ids = {};
  for (const pod of [1, 2, 3]) {
    for (const [kind, w] of [['spine', 64], ['face', 256]]) {
      await store.put({ key: `runs/1/pod${pod}_${kind}.mp4`, sourcePath: vid });
      const a = await repo.insertArtwork({
        runId: run.id, surface: 'eon', style: 'eon_connected', mediaType: 'video', stage: 'motion',
        specKey: `eon_${kind}`, panel: `pod${pod}_${kind}`, width: w, height: 384, status: 'approved',
        s3KeyFinal: `runs/1/pod${pod}_${kind}.mp4`, thumbnailKey: 'runs/1/thumb.jpg',
      });
      ids[`pod${pod}_${kind}`] = a.id;
    }
  }
  await repo.insertEonSequence({
    runId: run.id, masterS3Key: 'runs/1/master.mp4',
    face1ArtworkId: ids.pod1_face, face2ArtworkId: ids.pod2_face, face3ArtworkId: ids.pod3_face,
    spine1ArtworkId: ids.pod1_spine, spine2ArtworkId: ids.pod2_spine, spine3ArtworkId: ids.pod3_spine,
  });
  return { base, repo, store, run };
}

test('an approved EON set ships as ONE 960x384 master file, not six panels', async () => {
  const { base, repo, store, run } = await runWithApprovedEonSet();
  const localDir = path.join(base, 'handoff');
  try {
    const preview = await previewHandoff({ runId: run.id, deps: { repo } });
    assert.equal(preview.items.length, 1, 'the set is ONE deliverable');
    assert.equal(preview.items[0].panel, 'master');
    assert.equal(preview.items[0].width, 960);
    assert.equal(preview.items[0].height, 384);
    assert.match(preview.draft.subject, /1 ready/);
    assert.match(preview.draft.body, /one master file \(960x384/);

    const result = await sendRun({ runId: run.id, deps: { repo, store, localDir, preflight: OFFLINE } });
    assert.equal(result.count, 1, 'Jeff receives one file');
    const files = (await readdir(localDir)).filter((f) => f.endsWith('.mp4'));
    assert.equal(files.length, 1);
    assert.match(files[0], /_master_960x384_/, `master filename says what it is: ${files[0]}`);
    assert.doesNotMatch(files[0], /pod\d/, 'no per-panel files');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('a LIVE master delivery marks every panel of the set sent — nothing to double-send', async () => {
  const { base, repo, store, run } = await runWithApprovedEonSet();
  const calls = { upload: 0 };
  const driveMock = { deliver: async ({ fileName }) => { calls.upload += 1; calls.name = fileName; return { id: 'f1', webViewLink: 'https://drive/f1' }; } };
  const gmailMock = { sendMail: async () => ({ sent: true, messageId: 'm1' }), buildMimeMessage };
  const LIVE = { drive: { configured: true }, gmail: { configured: true, senders: ['scott@wowmedia.com'], to: 'jeff@wowmedia.com' }, overall: 'live', missing: [] };
  try {
    await sendRun({ runId: run.id, deps: { repo, store, drive: driveMock, gmail: gmailMock, preflight: LIVE } });
    assert.equal(calls.upload, 1, 'one upload for the whole set');
    assert.match(calls.name, /_master_960x384_/);
    const motions = (await repo.listArtworks(run.id)).filter((a) => a.stage === 'motion');
    assert.equal(motions.length, 6);
    assert.ok(motions.every((m) => m.status === 'sent'), 'all six panels marked sent');
    await assert.rejects(
      () => sendRun({ runId: run.id, deps: { repo, store, drive: driveMock, gmail: gmailMock, preflight: LIVE } }),
      /No approved pieces/,
    );
    assert.equal(calls.upload, 1, 'no duplicate upload');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
