// S3 asset store (production).
//
// Uploads generated media to the configured bucket, keyed `runs/<id>/…`. Same
// interface as the local store so the orchestrator is agnostic to the driver.
// Requires @aws-sdk/client-s3 (already a dependency) and a configured bucket.

import { createReadStream } from 'node:fs';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function contentTypeFor(key) {
  const dot = key.lastIndexOf('.');
  const ext = dot === -1 ? '' : key.slice(dot).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

export async function createS3Store({ bucket = config.storage.s3Bucket, region = config.aws.region } = {}) {
  if (!bucket) {
    throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET to be set.');
  }
  const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ region });

  return {
    driver: 's3',
    bucket,

    /** Upload the file at `sourcePath` to s3://bucket/key. @returns {Promise<{key, location}>} */
    async put({ key, sourcePath }) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(sourcePath),
          ContentType: contentTypeFor(key),
        }),
      );
      logger.debug({ bucket, key }, 'Uploaded object to S3');
      return { key, location: `s3://${bucket}/${key}` };
    },

    /** Read an object into a Buffer (used by the M3 handoff). */
    async getBuffer(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const chunks = [];
      for await (const chunk of res.Body) chunks.push(chunk);
      return Buffer.concat(chunks);
    },
  };
}

export { contentTypeFor };
export default { createS3Store };
