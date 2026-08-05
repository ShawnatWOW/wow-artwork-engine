// Seedance 2.0 motion provider (LIVE — spends credits) + Topaz 4K upscale.
//
// Image-to-video via fal.ai's queue API — the exact integration proven live in
// WOW Content Automation (server/modules/video-studio/falai.js):
//   submit : POST {base}/{model}  -> { request_id, status_url }
//   status : GET  status_url      -> { status: IN_QUEUE|IN_PROGRESS|COMPLETED }
//   result : GET  status_url-/status -> { video: { url } }
// Always uses the status_url fal returns (its status path uses the app id, not
// the full sub-path). Requires an `image_url` (the approved Seedream still).
//
// 4K pipeline (2026-07-14): Seedance runs at the Standard 1080p tier, then the
// fal-HOSTED result URL is fed to Topaz Video Upscale before download — real
// added sharpness for billboard scale, no round-trip re-upload. If the upscale
// fails we fall back to the 1080p clip rather than losing the generation.

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

/** Submit a fal queue job, poll to completion, return the result JSON. */
async function queueRun({ model, body, label, pollMs = 6000, timeoutMs = 900000 }) {
  const base = config.fal.queueBase.replace(/\/$/, '');
  const submit = await fetch(`${base}/${model}`, { method: 'POST', headers: auth(), body: JSON.stringify(body) });
  if (!submit.ok) throw new Error(`fal ${label} submit failed: ${submit.status} ${await submit.text()}`);
  const sd = await submit.json();
  const statusUrl = sd.status_url || `${base}/${appId(model)}/requests/${sd.request_id}/status`;
  logger.info({ requestId: sd.request_id, model }, `fal ${label} job submitted`);

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`fal ${label} job timed out`);
    const status = String((await (await fetch(statusUrl, { headers: auth() })).json()).status || '').toUpperCase();
    if (status === 'COMPLETED') break;
    if (['FAILED', 'ERROR', 'CANCELED'].includes(status)) throw new Error(`fal ${label} job ${status}`);
    await sleep(pollMs);
  }
  return { result: await (await fetch(statusUrl.replace(/\/status\/?$/, ''), { headers: auth() })).json(), requestId: sd.request_id };
}

/** Pull the output video URL out of a fal result, or throw with fal's detail. */
function videoUrlOf(result, label) {
  const url = result?.video?.url || result?.videos?.[0]?.url || result?.output?.video?.url;
  if (!url) {
    // fal's queue marks even bad model paths COMPLETED, with the real error in
    // `detail` — surface it instead of a vague "no video url".
    const detail = typeof result?.detail === 'string' ? result.detail : JSON.stringify(result).slice(0, 200);
    throw new Error(`fal ${label} returned no video url: ${detail}`);
  }
  return url;
}

/**
 * Upload a local file to fal storage so downstream fal models can fetch it —
 * needed for the segment-B handoff frame (extracted locally by ffmpeg) and the
 * stitched 30s clip Topaz upscales. Two-step: initiate → PUT the bytes.
 * @returns {Promise<{ url: string }>} the fal-hosted file URL
 */
export async function uploadToFalStorage({ sourcePath, contentType = 'application/octet-stream' }) {
  if (!config.fal.key) throw new Error('FAL_KEY not set.');
  const { readFile } = await import('node:fs/promises');
  const base = config.fal.restBase.replace(/\/$/, '');
  const fileName = sourcePath.split('/').at(-1);
  const initiate = await fetch(`${base}/storage/upload/initiate`, {
    method: 'POST', headers: auth(),
    body: JSON.stringify({ content_type: contentType, file_name: fileName }),
  });
  if (!initiate.ok) throw new Error(`fal storage initiate failed: ${initiate.status} ${await initiate.text()}`);
  const { upload_url: uploadUrl, file_url: fileUrl } = await initiate.json();
  if (!uploadUrl || !fileUrl) throw new Error('fal storage initiate returned no upload_url/file_url');
  const put = await fetch(uploadUrl, {
    method: 'PUT', headers: { 'Content-Type': contentType }, body: await readFile(sourcePath),
  });
  if (!put.ok) throw new Error(`fal storage upload failed: ${put.status} ${await put.text()}`);
  return { url: fileUrl };
}

/**
 * Topaz-upscale a fal-hosted video URL. Split out of generate() so the 30s
 * two-segment chain can upscale ONCE over the stitched clip — per-segment
 * passes synthesize different grain on each half, which reads as a splice
 * (Shawn, 2026-08-05). @returns {Promise<{ url, requestId, factor }>}
 */
export async function upscaleVideo({ videoUrl, pollMs = 6000, timeoutMs = 900000 }) {
  const up = config.fal.upscale;
  const upscaled = await queueRun({
    model: up.model, label: 'Topaz upscale', pollMs, timeoutMs,
    body: { video_url: videoUrl, upscale_factor: up.factor },
  });
  return { url: videoUrlOf(upscaled.result, 'Topaz upscale'), requestId: upscaled.requestId, factor: up.factor };
}

export const motionProvider = {
  model: MODEL_MOTION,
  /**
   * @param referenceImageUrl a URL fal can fetch (the Seedream still). REQUIRED —
   *        Seedance is image-to-video. fal-hosted Seedream URLs work directly.
   * @param endImageUrl optional fal-fetchable URL of the LAST frame — Seedance
   *        transitions the clip to land exactly on it (the approved closing
   *        still of the storyboard).
   * @param skipUpscale skip the per-clip Topaz pass — used by the two-segment
   *        chain, which upscales once over the stitched result instead.
   */
  async generate({ prompt, durationS = 6, output, referenceImageUrl, endImageUrl, skipUpscale = false, pollMs = 6000, timeoutMs = 900000 }) {
    if (!config.fal.key) throw new Error('FAL_KEY not set. Live motion generation is disabled until the key is configured.');
    if (!referenceImageUrl) throw new Error('Seedance needs referenceImageUrl (image-to-video) — generate/approve a Seedream still first.');

    const { result, requestId } = await queueRun({
      model: config.fal.seedanceModel,
      label: 'Seedance',
      pollMs,
      timeoutMs,
      body: {
        prompt,
        image_url: referenceImageUrl,
        ...(endImageUrl ? { end_image_url: endImageUrl } : {}),
        resolution: config.fal.resolution,
        generate_audio: config.fal.generateAudio,
        duration: Math.min(15, Math.max(4, Math.round(durationS))),
      },
    });
    let videoUrl = videoUrlOf(result, 'Seedance');
    let model = MODEL_MOTION;
    let upscaleJobId = null;

    // 4K pass: upscale the fal-hosted clip before download. Best-effort — a
    // refused/failed upscale must never cost us the (already paid) generation.
    const up = config.fal.upscale;
    if (up?.enabled && !skipUpscale) {
      try {
        const upscaled = await upscaleVideo({ videoUrl, pollMs, timeoutMs });
        videoUrl = upscaled.url;
        model = `${MODEL_MOTION}+topaz${up.factor}x`;
        upscaleJobId = upscaled.requestId;
      } catch (err) {
        logger.warn({ err: err.message }, 'Topaz upscale failed — delivering the un-upscaled clip');
      }
    }

    await downloadTo(videoUrl, output);
    // remoteUrl: the fal-hosted result — the chain feeds it onward (Topaz over
    // the stitched clip) without a re-upload when only one segment is raw.
    return { path: output, model, durationS, jobId: requestId, upscaleJobId, url: videoUrl };
  },
};

export { downloadTo };
export default { motionProvider, uploadToFalStorage, upscaleVideo };
