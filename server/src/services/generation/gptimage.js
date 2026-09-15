// GPT Image 2.5 still provider on fal (LIVE — spends credits).
//
// Shawn (2026-09-15): "I think the image generation is a problem. It
// generates almost instantly, which is weird for an allegedly high quality
// image. Let's use gpt image 2.5 so it's crazy quality and more prompt
// adherent." Same interface as seedream.js — the output URL feeds Seedance
// as the first frame — so the orchestrator doesn't care which painter ran.
//
//   openai/gpt-image-2.5/flare/text-to-image   (default; Sunburst via env)
//
// Constraints (fal docs, verified 2026-09-15): custom sizes must be multiples
// of 16, long edge ≤ 3840, aspect ratio ≤ 3:1, total pixels within
// 655,360–8,294,400. The spectacular is 3.62:1 — wider than the cap — so it
// is generated at 3:1 and the orchestrator crops the centre to spec (fine for
// the borderless tracks, whose scene fills every pixel; the FRAMED track keeps
// Seedream, whose native 3.62:1 keeps the painted border at the edges — see
// generation/index.js).

import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import config from '../../config/index.js';
import logger from '../../config/logger.js';
import falPricing from './falPricing.js';

export const MODEL_STILL = 'gpt-image-2.5@fal';

const auth = () => ({ Authorization: `Key ${config.fal.key}`, 'Content-Type': 'application/json', Accept: 'application/json' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const GPT_IMAGE_LIMITS = { maxEdge: 3840, maxAspect: 3, minPixels: 655360, maxPixels: 8294400, step: 16 };

/**
 * The closest legal GPT Image size to a wanted size: aspect capped at 3:1
 * (the height grows), long edge capped, pixel budget respected, both edges
 * multiples of 16. Pure; exported for tests.
 * @returns {{ width, height, aspectCapped: boolean }}
 */
export function fitDimsGpt(width, height, L = GPT_IMAGE_LIMITS) {
  let w = width; let h = height;
  let aspectCapped = false;
  if (w / h > L.maxAspect) { h = w / L.maxAspect; aspectCapped = true; }
  if (h / w > L.maxAspect) { w = h / L.maxAspect; aspectCapped = true; }
  const longEdge = Math.max(w, h);
  if (longEdge > L.maxEdge) { const s = L.maxEdge / longEdge; w *= s; h *= s; }
  const px = w * h;
  if (px > L.maxPixels) { const s = Math.sqrt(L.maxPixels / px); w *= s; h *= s; }
  if (px < L.minPixels) { const s = Math.sqrt(L.minPixels / px); w *= s; h *= s; }
  const snap = (n) => Math.max(L.step, Math.floor(n / L.step) * L.step);
  w = snap(w); h = snap(h);
  // Snapping down can dip under the pixel floor on tiny requests; step up once.
  while (w * h < L.minPixels) { w += L.step; h += L.step; }
  return { width: w, height: h, aspectCapped };
}

async function downloadTo(url, output) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download still: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(output));
}

export const stillProvider = {
  model: MODEL_STILL,
  /**
   * @returns {Promise<{path, model, url, width, height, prompt, jobId, costUsd, quality}>}
   *   `url` feeds Seedance; width/height are the ACTUAL generated dims (the
   *   orchestrator crops to the sign's aspect when they differ).
   */
  async generate({ prompt, width = 2048, height = 2048, output, pollMs = 4000, timeoutMs = 600000 }) {
    if (!config.fal.key) throw new Error('FAL_KEY not set. Live GPT Image still generation is disabled until the key is configured.');

    const base = config.fal.queueBase.replace(/\/$/, '');
    const model = config.fal.gptImageModel;
    const quality = config.fal.gptImageQuality;
    const dims = fitDimsGpt(width, height);

    const submit = await fetch(`${base}/${model}`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ prompt, image_size: { width: dims.width, height: dims.height }, quality, num_images: 1, output_format: 'png' }),
    });
    if (!submit.ok) throw new Error(`fal GPT Image submit failed: ${submit.status} ${await submit.text()}`);
    const sd = await submit.json();

    const started = Date.now();
    let imageUrl = sd.images?.[0]?.url; // sync response
    let result = sd;
    if (!imageUrl && sd.status_url) {   // queue response → poll
      logger.info({ requestId: sd.request_id, model, quality, dims }, 'fal GPT Image job submitted');
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (Date.now() > deadline) throw new Error('fal GPT Image job timed out');
        const status = String((await (await fetch(sd.status_url, { headers: auth() })).json()).status || '').toUpperCase();
        if (status === 'COMPLETED') break;
        if (['FAILED', 'ERROR', 'CANCELED'].includes(status)) throw new Error(`fal GPT Image job ${status}`);
        await sleep(pollMs);
      }
      result = await (await fetch(sd.status_url.replace(/\/status\/?$/, ''), { headers: auth() })).json();
      imageUrl = result?.images?.[0]?.url;
    }
    if (!imageUrl) {
      const detail = typeof result?.detail === 'string' ? result.detail : JSON.stringify(result).slice(0, 300);
      throw new Error(`fal GPT Image returned no image url: ${detail}`);
    }
    await downloadTo(imageUrl, output);
    const w = result?.images?.[0]?.width || dims.width;
    const h = result?.images?.[0]?.height || dims.height;
    const seconds = Math.round((Date.now() - started) / 1000);
    const costUsd = falPricing.gptImageCostUsd({ width: w, height: h, quality });
    logger.info({ requestId: sd.request_id, model, quality, width: w, height: h, seconds, costUsd }, 'fal GPT Image still ready');
    return { path: output, model: MODEL_STILL, url: imageUrl, width: w, height: h, prompt, jobId: sd.request_id ?? null, costUsd, quality, seconds };
  },
};

export default { stillProvider, fitDimsGpt, GPT_IMAGE_LIMITS };
