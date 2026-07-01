// FAL / Seedance 2.0 motion provider (LIVE — spends credits).
//
// Motion generation runs through fal.ai's Seedance 2.0 model (locked decision).
// Implemented against fal's async queue REST API:
//   submit → poll status → fetch result → download the video.
// Gated behind a configured FAL_KEY; throws if unset so a stray run can never
// spend credits. The model emits a standard ratio at high res; FFmpeg conforms
// to the exact WOW spec downstream (see services/ffmpeg.js).

import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

export const MODEL_MOTION = 'seedance-2.0@fal';

const AUTH = () => ({ Authorization: `Key ${config.fal.key}`, 'Content-Type': 'application/json' });

async function downloadTo(url, output) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download result: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(output));
}

export const motionProvider = {
  model: MODEL_MOTION,
  /**
   * @returns {Promise<{path, model, width, height, durationS, jobId}>}
   * @param ratio e.g. "16:9" | "2:1" — fal-supported aspect ratio.
   */
  async generate({ prompt, ratio = '16:9', durationS = 6, output, pollMs = 4000, timeoutMs = 600000 }) {
    if (!config.fal.key) {
      throw new Error('FAL_KEY not set. Live motion generation is disabled until the key is configured.');
    }
    const model = config.fal.seedanceModel;
    const base = config.fal.queueBase.replace(/\/$/, '');

    // 1. Submit to the queue.
    const submit = await fetch(`${base}/${model}`, {
      method: 'POST',
      headers: AUTH(),
      body: JSON.stringify({ prompt, aspect_ratio: ratio, duration: durationS }),
    });
    if (!submit.ok) {
      throw new Error(`fal submit failed: ${submit.status} ${await submit.text()}`);
    }
    const { request_id: requestId, status_url: statusUrl, response_url: responseUrl } =
      await submit.json();
    logger.info({ requestId, model }, 'fal Seedance job submitted');

    // 2. Poll until COMPLETED (or fail/timeout).
    const deadline = Date.now() + timeoutMs;
    const statusEndpoint = statusUrl || `${base}/${model}/requests/${requestId}/status`;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (Date.now() > deadline) throw new Error(`fal job ${requestId} timed out`);
      const s = await fetch(statusEndpoint, { headers: AUTH() });
      const status = (await s.json()).status;
      if (status === 'COMPLETED') break;
      if (status === 'FAILED' || status === 'ERROR') throw new Error(`fal job ${requestId} ${status}`);
      await new Promise((r) => setTimeout(r, pollMs));
    }

    // 3. Fetch the result and download the video.
    const resultEndpoint = responseUrl || `${base}/${model}/requests/${requestId}`;
    const result = await (await fetch(resultEndpoint, { headers: AUTH() })).json();
    const videoUrl = result?.video?.url || result?.videos?.[0]?.url;
    if (!videoUrl) throw new Error(`fal job ${requestId} returned no video url`);
    await downloadTo(videoUrl, output);

    return { path: output, model: MODEL_MOTION, durationS, jobId: requestId };
  },
};

export default { motionProvider };
