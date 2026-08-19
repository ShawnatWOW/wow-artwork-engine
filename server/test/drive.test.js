import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { deliver } from '../src/services/delivery/drive.js';

// Resumable upload (2026-08-19): the old multipart endpoint capped requests at
// ~5 MB, so real deliveries (30s + Topaz 4K, hundreds of MB) were rejected by
// Google and Send-to-Jeff 500'd. deliver() now opens a resumable session and
// STREAMS the bytes — these tests pin the protocol with a stubbed fetch.

const CFG = { folderId: 'folder123', oauthClientId: 'id', oauthClientSecret: 'secret', oauthRefreshToken: 'refresh' };

function stubFetch(handlers) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return handlers(String(url), opts, calls.length);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('deliver: resumable init carries metadata, bytes stream to the session URI', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-drive-'));
  const file = path.join(dir, 'clip.mp4');
  await writeFile(file, Buffer.alloc(64 * 1024, 7)); // 64 KB stand-in
  const { calls, restore } = stubFetch((url, opts) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
    }
    if (url.includes('uploadType=resumable')) {
      // Init: metadata-only JSON, never the video bytes.
      const meta = JSON.parse(opts.body);
      assert.equal(meta.name, 'WOW_test.mp4');
      assert.deepEqual(meta.parents, ['folder123']);
      assert.equal(opts.headers['X-Upload-Content-Length'], String(64 * 1024));
      return new Response(null, { status: 200, headers: { location: 'https://upload.example/session-1' } });
    }
    if (url === 'https://upload.example/session-1') {
      assert.equal(opts.method, 'PUT');
      assert.equal(opts.headers['Content-Length'], String(64 * 1024));
      assert.equal(opts.duplex, 'half', 'stream bodies require duplex');
      assert.ok(opts.body && typeof opts.body.pipe === 'function', 'bytes are STREAMED, not buffered');
      return new Response(JSON.stringify({ id: 'f1', name: 'WOW_test.mp4', webViewLink: 'https://drive/x' }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  try {
    const out = await deliver({ filePath: file, fileName: 'WOW_test.mp4' }, CFG);
    assert.equal(out.id, 'f1');
    assert.equal(out.webViewLink, 'https://drive/x');
    assert.equal(out.method, 'drive');
    assert.equal(calls.length, 3, 'token + init + bytes');
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('deliver: a refused init or upload surfaces the Google error text', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-drive-'));
  const file = path.join(dir, 'clip.mp4');
  await writeFile(file, Buffer.alloc(1024));
  const { restore } = stubFetch((url) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
    if (url.includes('uploadType=resumable')) return new Response('storageQuotaExceeded', { status: 403 });
    throw new Error(`unexpected fetch: ${url}`);
  });
  try {
    await assert.rejects(() => deliver({ filePath: file, fileName: 'x.mp4' }, CFG), /Drive upload init failed: 403 storageQuotaExceeded/);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

// --- service-account key shapes (the REAL first Send-to-Jeff failure:
// GOOGLE_SERVICE_ACCOUNT_JSON held a file path and was blind-JSON.parse'd) ---

import { parseServiceAccount } from '../src/services/delivery/googleAuth.js';

test('parseServiceAccount accepts object, inline JSON, file path, and base64', async () => {
  const key = { client_email: 'sa@proj.iam.gserviceaccount.com', private_key: 'pk' };
  assert.deepEqual(await parseServiceAccount(key), key);
  assert.deepEqual(await parseServiceAccount(JSON.stringify(key)), key);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-sa-'));
  const file = path.join(dir, 'key.json');
  await writeFile(file, JSON.stringify(key));
  try {
    assert.deepEqual(await parseServiceAccount(file), key, 'file path form (how the EC2 stores it)');
    assert.deepEqual(await parseServiceAccount(Buffer.from(JSON.stringify(key)).toString('base64')), key, 'base64 form');
    await assert.rejects(() => parseServiceAccount('/nonexistent/key.json'), /could not be read/);
    await assert.rejects(() => parseServiceAccount('definitely not a key'), /not inline JSON/);
    await assert.rejects(() => parseServiceAccount(''), /missing/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
