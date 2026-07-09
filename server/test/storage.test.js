import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createLocalStore } from '../src/services/storage/local.js';
import { artworkKey } from '../src/services/storage/index.js';
import { contentTypeFor } from '../src/services/storage/s3.js';

test('artworkKey builds the runs/<id>/<surface>/opt<n>/<name> layout', () => {
  assert.equal(
    artworkKey({ runId: 7, surfaceKey: 'spectacular', option: 2, name: 'final.mp4' }),
    'runs/7/spectacular/opt2/final.mp4',
  );
});

test('contentTypeFor maps known media extensions', () => {
  assert.equal(contentTypeFor('runs/1/a/final.mp4'), 'video/mp4');
  assert.equal(contentTypeFor('runs/1/a/thumb.jpg'), 'image/jpeg');
  assert.equal(contentTypeFor('runs/1/a/x.bin'), 'application/octet-stream');
});

test('local store put → getBuffer round-trips and keeps the key layout', async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), 'wae-src-'));
  const base = await mkdtemp(path.join(os.tmpdir(), 'wae-store-'));
  try {
    const file = path.join(src, 'raw.mp4');
    await writeFile(file, 'hello-artwork');

    const store = createLocalStore({ baseDir: base });
    const key = artworkKey({ runId: 1, surfaceKey: 'eon_single', option: 1, name: 'final.mp4' });
    const put = await store.put({ key, sourcePath: file });

    assert.equal(put.key, key);
    assert.equal(store.localPath(key), path.join(base, key));
    assert.equal((await store.getBuffer(key)).toString(), 'hello-artwork');
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(base, { recursive: true, force: true });
  }
});
