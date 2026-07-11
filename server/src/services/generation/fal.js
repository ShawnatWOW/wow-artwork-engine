// Seedance 2.0 motion provider (LIVE — spends credits).
//
// Image-to-video via fal.ai's queue API — the exact integration proven live in
// WOW Content Automation (server/modules/video-studio/falai.js):
//   submit : POST {base}/{model}  -> { request_id, status_url }
//   status : GET  status_url      -> { status: IN_QUEUE|IN_PROGRESS|COMPLETED }
//   result : GET  status_url-/status -> { video: { url } }
// Always uses the status_url fal returns (its status path uses the app id, not
// the full sub-path). Requires an `image_url` (the approved Seedream still).

import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

export const MODEL_MOTION = 'seedance-2.0@fal';

const auth = () => ({ Authorization: `Key ${config.fal.key}`, 'Content-Type': 'application/json', Accept: 'application/json' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const appId = (m) => m.split('/').slice(0, 2).join('/');

async function downloadTo(url, output) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download result: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(output));
}

export const motionProvider = {
  model: MODEL_MOTION,
  /**
   * @param referenceImageUrl a URL fal can fetch (the Seedream still). REQUIRED —
   *        Seedance is image-to-video. fal-hosted Seedream URLs work directly.
   */
  async generate({ prompt, durationS = 6, output, referenceImageUrl, pollMs = 6000, timeoutMs = 900000 }) {
    if (!config.fal.key) throw new Error('FAL_KEY not set. Live motion generation is disabled until the key is configured.');
    if (!referenceImageUrl) throw new Error('Seedance needs referenceImageUrl (image-to-video) — generate/approve a Seedream still first.');

    const base = config.fal.queueBase.replace(/\/$/, '');
    const model = config.fal.seedanceModel;
    const body = {
      prompt,
      image_url: referenceImageUrl,
      resolution: config.fal.resolution,
      generate_audio: config.fal.generateAudio,
      duration: Math.min(15, Math.max(4, Math.round(durationS))),
    };

    const submit = await fetch(`${base}/${model}`, { method: 'POST', headers: auth(), body: JSON.stringify(body) });
    if (!submit.ok) throw new Error(`fal Seedance submit failed: ${submit.status} ${await submit.text()}`);
    const sd = await submit.json();
    const statusUrl = sd.status_url || `${base}/${appId(model)}/requests/${sd.request_id}/status`;
    logger.info({ requestId: sd.request_id, model }, 'fal Seedance job submitted');

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (Date.now() > deadline) throw new Error(`fal Seedance job timed out`);
      const status = String((await (await fetch(statusUrl, { headers: auth() })).json()).status || '').toUpperCase();
      if (status === 'COMPLETED') break;
      if (['FAILED', 'ERROR', 'CANCELED'].includes(status)) throw new Error(`fal Seedance job ${status}`);
      await sleep(pollMs);
    }

    const result = await (await fetch(statusUrl.replace(/\/status\/?$/, ''), { headers: auth() })).json();
    const videoUrl = result?.video?.url || result?.videos?.[0]?.url || result?.output?.video?.url;
    if (!videoUrl) {
      // fal's queue marks even bad model paths COMPLETED, with the real error in
      // `detail` — surface it instead of a vague "no video url".
      const detail = typeof result?.detail === 'string' ? result.detail : JSON.stringify(result).slice(0, 200);
      throw new Error(`fal Seedance returned no video url: ${detail}`);
    }
    await downloadTo(videoUrl, output);

    return { path: output, model: MODEL_MOTION, durationS, jobId: sd.request_id };
  },
};

export default { motionProvider };
