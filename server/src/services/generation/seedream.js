// Seedream still provider (LIVE — spends credits).
//
// Still generation runs through fal.ai's Seedream image model. Seedream stills
// double as the first-frame reference for Seedance motion (image-to-video), so
// the two-phase flow is: Seedream still → human style approval → Seedance
// animates the approved still. Gated behind FAL_KEY; throws if unset so a stray
// run can never spend. FFmpeg conforms to the exact WOW spec downstream.
//
// Same fal async-queue REST shape as the Seedance motion provider (fal.js):
// submit → poll status → fetch result → download the image.

import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

export const MODEL_STILL = 'seedream@fal';

const AUTH = () => ({ Authorization: `Key ${config.fal.key}`, 'Content-Type': 'application/json' });

async function downloadTo(url, output) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download still: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(output));
}

export const stillProvider = {
  model: MODEL_STILL,
  /**
   * @returns {Promise<{path, model, width, height, prompt, jobId}>}
   * @param ratio e.g. "16:9" | "2:1" | "2:3" — fal-supported aspect ratio.
   */
  async generate({ prompt, width, height, ratio, output, pollMs = 2500, timeoutMs = 180000 }) {
    if (!config.fal.key) {
      throw new Error('FAL_KEY not set. Live Seedream still generation is disabled until the key is configured.');
    }
    const model = config.fal.seedreamModel;
    const base = config.fal.queueBase.replace(/\/$/, '');

    const submit = await fetch(`${base}/${model}`, {
      method: 'POST',
      headers: AUTH(),
      body: JSON.stringify({ prompt, ...(ratio ? { aspect_ratio: ratio } : { image_size: { width, height } }) }),
    });
    if (!submit.ok) throw new Error(`fal Seedream submit failed: ${submit.status} ${await submit.text()}`);
    const { request_id: requestId, status_url: statusUrl, response_url: responseUrl } = await submit.json();
    logger.info({ requestId, model }, 'fal Seedream job submitted');

    const deadline = Date.now() + timeoutMs;
    const statusEndpoint = statusUrl || `${base}/${model}/requests/${requestId}/status`;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (Date.now() > deadline) throw new Error(`fal Seedream job ${requestId} timed out`);
      const status = (await (await fetch(statusEndpoint, { headers: AUTH() })).json()).status;
      if (status === 'COMPLETED') break;
      if (status === 'FAILED' || status === 'ERROR') throw new Error(`fal Seedream job ${requestId} ${status}`);
      await new Promise((r) => setTimeout(r, pollMs));
    }

    const resultEndpoint = responseUrl || `${base}/${model}/requests/${requestId}`;
    const result = await (await fetch(resultEndpoint, { headers: AUTH() })).json();
    const imageUrl = result?.images?.[0]?.url || result?.image?.url;
    if (!imageUrl) throw new Error(`fal Seedream job ${requestId} returned no image url`);
    await downloadTo(imageUrl, output);

    return { path: output, model: MODEL_STILL, width, height, prompt, jobId: requestId };
  },
};

export default { stillProvider };
