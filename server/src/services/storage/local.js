// Local filesystem asset store.
//
// Keeps generated media on disk under a base directory, keyed exactly like the
// S3 store (`runs/<id>/…`). This is the default so the whole pipeline runs at
// $0 with no AWS dependency; the S3 store is a drop-in replacement in prod.

import path from 'node:path';
import { mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import config from '../../config/index.js';

export function createLocalStore({ baseDir = config.storage.localDir } = {}) {
  const root = path.isAbsolute(baseDir) ? baseDir : path.resolve(process.cwd(), baseDir);
  const abs = (key) => path.join(root, key);

  return {
    driver: 'local',
    baseDir: root,

    /** Persist a file at `sourcePath` under `key`. @returns {Promise<{key, location}>} */
    async put({ key, sourcePath }) {
      const dest = abs(key);
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(sourcePath, dest);
      return { key, location: dest };
    },

    /** Absolute path a key resolves to (local only; used by handoff/tests). */
    localPath(key) {
      return abs(key);
    },

    /** Read a stored object into a Buffer. */
    async getBuffer(key) {
      return readFile(abs(key));
    },

    async remove(key) {
      await rm(abs(key), { force: true });
    },
  };
}

export default { createLocalStore };
