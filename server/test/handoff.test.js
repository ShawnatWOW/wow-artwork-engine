import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildMimeMessage, assertAllowed } from '../src/services/delivery/gmail.js';
import { deliveryPreflight, defaultDraft, sendRun } from '../src/services/delivery/handoff.js';
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
