// Seedream still provider (LIVE — spends credits).
//
// Text-to-image via fal.ai Seedream v4 (~$0.03/image). The returned fal image
// URL doubles as the first-frame reference for Seedance image-to-video (chain
// the URL straight through — no re-upload). Handles both the sync response
// (images[] inline) and the queue response (poll status_url).
//   fal-ai/bytedance/seedream/v4/text-to-image
//   body: { prompt, image_size: {width,height}, num_images }
//   out:  { images: [{ url }] }

import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

export const MODEL_STILL = 'seedream-v4@fal';

const auth = () => ({ Authorization: `Key ${config.fal.key}`, 'Content-Type': 'application/json', Accept: 'application/json' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Seedream requires each dimension in [960, 4096]. Scale PROPORTIONALLY into
// range (never clamp per-axis — that would distort the aspect ratio).
export function fitDims(width, height, min = 960, max = 4096) {
  let scale = 1;
  scale = Math.max(scale, min / width, min / height);
  scale = Math.min(scale, max / width, max / height);
  const even = (n) => Math.round(n / 2) * 2;
  return { width: even(width * scale), height: even(height * scale) };
}

async function downloadTo(url, output) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download still: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(output));
}

export const stillProvider = {
  model: MODEL_STILL,
  /** @returns {Promise<{path, model, url, width, height, prompt}>} — `url` feeds Seedance. */
  async generate({ prompt, width = 2048, height = 2048, output, pollMs = 2500, timeoutMs = 180000 }) {
    if (!config.fal.key) throw new Error('FAL_KEY not set. Live Seedream still generation is disabled until the key is configured.');

    const base = config.fal.queueBase.replace(/\/$/, '');
    const model = config.fal.seedreamModel;
    const { width: w, height: h } = fitDims(width, height);

    const submit = await fetch(`${base}/${model}`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ prompt, image_size: { width: w, height: h }, num_images: 1 }),
    });
    if (!submit.ok) throw new Error(`fal Seedream submit failed: ${submit.status} ${await submit.text()}`);
    const sd = await submit.json();

    let imageUrl = sd.images?.[0]?.url; // sync response
    if (!imageUrl && sd.status_url) {   // queue response → poll
      logger.info({ requestId: sd.request_id, model }, 'fal Seedream job submitted');
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (Date.now() > deadline) throw new Error('fal Seedream job timed out');
        const status = String((await (await fetch(sd.status_url, { headers: auth() })).json()).status || '').toUpperCase();
        if (status === 'COMPLETED') break;
        if (['FAILED', 'ERROR', 'CANCELED'].includes(status)) throw new Error(`fal Seedream job ${status}`);
        await sleep(pollMs);
      }
      const result = await (await fetch(sd.status_url.replace(/\/status\/?$/, ''), { headers: auth() })).json();
      imageUrl = result?.images?.[0]?.url;
    }
    if (!imageUrl) throw new Error(`fal Seedream returned no image url`);
    await downloadTo(imageUrl, output);

    return { path: output, model: MODEL_STILL, url: imageUrl, width: w, height: h, prompt, jobId: sd.request_id ?? null };
  },
};

export default { stillProvider };
