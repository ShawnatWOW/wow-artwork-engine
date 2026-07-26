#!/usr/bin/env node
// Backfill still thumbnails (perf fix, 2026-07-26).
//
// Until now a still's `thumbnail_key` pointed at its own 4K master, so the
// design-review grid downloaded 2-5 MB per card — ~30 MB to open one week.
// New stills get a real thumbnail at generation time; this walks the rows that
// predate that and gives them one too, so existing weeks get the same win.
//
// Safe to re-run: rows already carrying a distinct thumbnail are skipped, and
// nothing is deleted — the master stays exactly where it is.
//
//   node scripts/backfill-still-thumbs.js          # report only, changes nothing
//   node scripts/backfill-still-thumbs.js --apply  # write the thumbnails
//
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, stat } from 'node:fs/promises';

import { getRepo } from '../server/src/db/index.js';
import { getStore } from '../server/src/services/storage/index.js';
import ffmpeg from '../server/src/services/ffmpeg.js';
import logger from '../server/src/config/logger.js';

const APPLY = process.argv.includes('--apply');
const MAX_EDGE = 1280;
const even = (n) => Math.max(2, Math.floor(n / 2) * 2);

function previewDims(width, height) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  return { width: even(width * scale), height: even(height * scale) };
}

async function main() {
  const repo = getRepo();
  const store = await getStore();
  const runs = await repo.listRuns({ limit: 1000 });

  let scanned = 0; let done = 0; let skipped = 0; let failed = 0;
  let beforeBytes = 0; let afterBytes = 0;

  for (const run of runs) {
    for (const a of await repo.listArtworks(run.id)) {
      // Only stills that never got their own thumbnail.
      if (a.stage !== 'still' || !a.s3_key_final) continue;
      scanned += 1;
      if (a.thumbnail_key && a.thumbnail_key !== a.s3_key_final) { skipped += 1; continue; }

      const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-thumb-'));
      try {
        const src = path.join(dir, 'master.png');
        const { writeFile } = await import('node:fs/promises');
        const buf = await store.getBuffer(a.s3_key_final);
        await writeFile(src, buf);
        beforeBytes += buf.length;

        const probed = await ffmpeg.probe(src).catch(() => null);
        const w = probed?.width || a.width || MAX_EDGE;
        const h = probed?.height || a.height || MAX_EDGE;
        const td = previewDims(w, h);

        const out = path.join(dir, 'thumb.jpg');
        await ffmpeg.thumbnail({ input: src, output: out, width: td.width, height: td.height });
        afterBytes += (await stat(out)).size;

        // Sit beside the master so the pair is obvious on disk / in S3.
        const key = a.s3_key_final.replace(/\.[^.]+$/, '') + '_thumb.jpg';
        if (APPLY) {
          const put = await store.put({ key, sourcePath: out });
          await repo.updateArtwork(a.id, { thumbnailKey: put.key });
        }
        done += 1;
        console.log(`${APPLY ? 'wrote' : 'would write'}  artwork ${a.id}  ${w}x${h} -> ${td.width}x${td.height}  ${key}`);
      } catch (err) {
        failed += 1;
        console.error(`artwork ${a.id}: ${err.message}`);
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  console.log(`\n${APPLY ? 'Backfilled' : 'DRY RUN —'} ${done} still thumbnail(s). scanned=${scanned} skipped=${skipped} failed=${failed}`);
  if (done) console.log(`Grid payload for these rows: ${mb(beforeBytes)} -> ${mb(afterBytes)}`);
  if (!APPLY && done) console.log('\nNothing was changed. Re-run with --apply to write them.');
}

main().catch((err) => {
  logger.error({ err: err.message }, 'Backfill failed');
  process.exit(1);
});
