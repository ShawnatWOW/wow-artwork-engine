// Seedance motion provider (LIVE — spends credits) + Topaz 4K upscale.
//
// Image-to-video via fal.ai's queue API — the exact integration proven live in
// WOW Content Automation (server/modules/video-studio/falai.js):
//   submit : POST {base}/{model}  -> { request_id, status_url }
//   status : GET  status_url      -> { status: IN_QUEUE|IN_PROGRESS|COMPLETED }
//   result : GET  status_url-/status -> { video: { url } }
// Always uses the status_url fal returns (its status path uses the app id, not
// the full sub-path). Requires an `image_url` (the approved Seedream still).
//
// 4K pipeline: Seedance renders at config.fal.resolution (720p since
// 2026-08-05), then the fal-HOSTED result URL is fed to Topaz Video Upscale
// before download — real added sharpness for billboard scale, no round-trip
// re-upload. If the upscale fails we fall back to the un-upscaled clip rather
// than losing the generation.
//
// Seedance 2.5 (default since 2026-08-10): native single-pass clips up to 30s,
// end_image_url supported, aspect_ratio 'auto' only, 480p/720p only (no 1080p
// tier on fal — the "4K" in ByteDance's marketing is Jimeng-only). The
// chain-era stitching is gone; reverting FAL_SEEDANCE_MODEL to a 2.0 slug
// simply clamps clips to 15s (a shorter piece, never a spliced one).

import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

// Ledger label, derived from the configured slug so the recorded model (and
// the price book's tier detection) always names what actually generated:
// 'bytedance/seedance-2.5/image-to-video' -> 'seedance-2.5@fal'.
export const MODEL_MOTION = `${(config.fal.seedanceModel || '').split('/')[1] || 'seedance'}@fal`;

// Longest clip one Seedance call can produce: 2.5 does a native 30s; every
// 2.x slug before it clamps at 15s. Used to clamp the duration request.
export const MAX_CLIP_S = /2[.-]5/.test(config.fal.seedanceModel || '') ? 30 : 15;

// Seedance 2.5 has no 1080p tier — if the env still carries the pre-2.5
// FAL_RESOLUTION=1080p override, request 720p instead of letting fal reject.
function motionResolution() {
  const res = config.fal.resolution;
  if (MAX_CLIP_S === 30 && res === '1080p') {
    logger.warn('FAL_RESOLUTION=1080p is not available on Seedance 2.5 — requesting 720p');
    return '720p';
  }
  return res;
}

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
export function videoUrlOf(result, label) {
  const url = result?.video?.url || result?.videos?.[0]?.url || result?.output?.video?.url;
  if (!url) {
    // ByteDance's anti-deepfake moderation refuses images containing what
    // reads as a PHOTOGRAPH of a person — fictional characters included
    // (proven live 2026-08-26: the same still passed at preview detail,
    // refused at full 4K). Raw JSON on the card told the reviewer nothing and
    // made "Try again" look like the move, but the same image is refused every
    // time — say what happened and what actually fixes it.
    if (JSON.stringify(result).includes('content_policy_violation')) {
      throw new Error(
        `${label} refused this image: a character looks too much like a real person ` +
        `(the video model's anti-deepfake filter — it cannot tell a photoreal fictional ` +
        `character from a photo). "Try again" resends the same image and will be refused ` +
        `again — Replace or Tweak the design so characters are clearly stylized, not photoreal.`,
      );
    }
    // fal's queue marks even bad model paths COMPLETED, with the real error in
    // `detail` — surface it instead of a vague "no video url".
    const detail = typeof result?.detail === 'string' ? result.detail : JSON.stringify(result).slice(0, 200);
    throw new Error(`fal ${label} returned no video url: ${detail}`);
  }
  return url;
}

/**
 * Upload a local file to fal storage so downstream fal models can fetch it —
 * used for the framed CLOSING still (composited locally, then handed to
 * Seedance as end_image_url). Two-step: initiate → PUT the bytes.
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
 * Topaz-upscale a fal-hosted video URL. Split out of generate() so one-off
 * scripts can upscale an existing clip without re-generating it.
 * @returns {Promise<{ url, requestId, factor }>}
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
   * @param skipUpscale skip the per-clip Topaz pass (no current caller sets
   *        it; kept for one-off scripts that want the raw clip).
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
        resolution: motionResolution(),
        generate_audio: config.fal.generateAudio,
        duration: Math.min(MAX_CLIP_S, Math.max(4, Math.round(durationS))),
        // 'auto' = infer the ratio from the input image (our stills are 3.62:1
        // spectaculars / 2.5:1 EON masters — none of the fixed choices fit).
        // It is the documented default, pinned here against default drift: a
        // fixed-ratio output would fill-crop the input and destroy the painted
        // frame before any motion happened. No `seed` on purpose — re-rolls
        // (vary) rely on the model being stochastic for the same prompt.
        aspect_ratio: 'auto',
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
    // url: the fal-hosted result, kept so callers can feed it to another fal
    // model without a re-upload.
    return { path: output, model, durationS, jobId: requestId, upscaleJobId, url: videoUrl };
  },
};

export { downloadTo };
export default { motionProvider, uploadToFalStorage, upscaleVideo };
