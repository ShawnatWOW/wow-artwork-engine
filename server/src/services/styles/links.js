// Fetching a reference from a LINK (Style Library, 2026-09-14).
//
// Instagram gives nothing away: its oEmbed endpoint (tokenless again since
// June 2026) returns embed HTML only, and its terms bar using it for
// anything but embedding. So a pasted post/reel URL goes through Apify's
// Instagram scraper — public posts, no login, returns the media URLs and the
// caption — when an APIFY_TOKEN is configured. Without a token the link
// path refuses with the honest fallback: screenshot or screen-record it and
// upload that instead. A direct image/video URL (anything that serves an
// image/* or video/* content type) is simply downloaded.

import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

const IG_URL = /^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;

export const isInstagramUrl = (url = '') => IG_URL.test(String(url).trim());

/** Canonical https://www.instagram.com/<kind>/<code>/ form, or null. Pure. */
export function canonicalInstagramUrl(url = '') {
  const m = IG_URL.exec(String(url).trim());
  if (!m) return null;
  const kind = m[2].toLowerCase() === 'reels' ? 'reel' : m[2].toLowerCase();
  return `https://www.instagram.com/${kind}/${m[3]}/`;
}

/** Pick the best media from an Apify Instagram item. Pure; exported for tests. */
export function pickInstagramMedia(item) {
  if (!item || typeof item !== 'object') return null;
  const caption = item.caption ? String(item.caption) : '';
  // A reel: the video is the reference (the cover is a poor stand-in).
  if (item.videoUrl) return { url: item.videoUrl, kind: 'video', caption };
  // A carousel: the first image is what Scott saw first.
  const first = item.childPosts?.find?.((c) => c?.videoUrl || c?.displayUrl);
  if (first?.videoUrl) return { url: first.videoUrl, kind: 'video', caption };
  const image = item.displayUrl || first?.displayUrl || item.images?.[0];
  if (image) return { url: image, kind: 'image', caption };
  return null;
}

async function resolveInstagram(url, { fetchImpl = fetch } = {}) {
  const { apifyToken, apifyActor } = config.styles;
  if (!apifyToken) {
    throw Object.assign(
      new Error('Instagram links need the Apify connector (APIFY_TOKEN) — screenshot or screen-record the post and upload that instead.'),
      { code: 'link_unsupported' },
    );
  }
  const canonical = canonicalInstagramUrl(url);
  const endpoint = `https://api.apify.com/v2/acts/${apifyActor}/run-sync-get-dataset-items?token=${encodeURIComponent(apifyToken)}&timeout=120`;
  const resp = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directUrls: [canonical], resultsType: 'posts', resultsLimit: 1, addParentData: false }),
  });
  if (!resp.ok) throw new Error(`Could not fetch that Instagram post (${resp.status}) — screenshot it and upload instead.`);
  const items = await resp.json();
  const media = pickInstagramMedia(Array.isArray(items) ? items[0] : null);
  if (!media) throw new Error('That Instagram post has no public media (private account, story, or removed) — screenshot it and upload instead.');
  return { ...media, sourceUrl: canonical };
}

async function download(url, dest, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const type = String(res.headers.get('content-type') || '');
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return { type };
}

const extFor = (type, kind, url) => {
  if (/mp4|mpeg|quicktime|webm/.test(type)) return type.includes('quicktime') ? '.mov' : type.includes('webm') ? '.webm' : '.mp4';
  if (/png/.test(type)) return '.png';
  if (/jpe?g/.test(type)) return '.jpg';
  if (/webp/.test(type)) return '.webp';
  if (/gif/.test(type)) return '.gif';
  const fromUrl = path.extname(new URL(url).pathname).toLowerCase();
  if (/^\.(png|jpe?g|webp|gif|mp4|mov|webm)$/.test(fromUrl)) return fromUrl;
  return kind === 'video' ? '.mp4' : '.jpg';
};

/**
 * Resolve a link to a local file.
 * @returns {Promise<{ path, filename, kind: 'image'|'video', caption, sourceUrl }>}
 */
export async function fetchReference({ url, outDir, fetchImpl = fetch }) {
  const clean = String(url || '').trim();
  if (!/^https?:\/\//i.test(clean)) throw Object.assign(new Error('That is not a link.'), { code: 'bad_link' });

  let media;
  if (isInstagramUrl(clean)) {
    media = await resolveInstagram(clean, { fetchImpl });
  } else {
    media = { url: clean, kind: /\.(mp4|mov|webm|m4v|gif)(\?|$)/i.test(clean) ? 'video' : 'image', caption: '', sourceUrl: clean };
  }
  const tmp = path.join(outDir, 'source.download');
  const { type } = await download(media.url, tmp, { fetchImpl });
  if (!isInstagramUrl(clean) && !/^(image|video)\//.test(type) && !/^application\/octet-stream/.test(type)) {
    throw Object.assign(
      new Error('That link is a web page, not an image or video — save the picture (or screenshot it) and upload the file instead.'),
      { code: 'link_unsupported' },
    );
  }
  const kind = /^video\//.test(type) ? 'video' : /^image\//.test(type) ? 'image' : media.kind;
  const filename = `source${extFor(type, kind, media.url)}`;
  const finalPath = path.join(outDir, filename);
  const { rename } = await import('node:fs/promises');
  await rename(tmp, finalPath);
  logger.info({ url: media.sourceUrl, kind, type }, 'Style reference fetched from link');
  return { path: finalPath, filename, kind, caption: media.caption || '', sourceUrl: media.sourceUrl };
}

export default { fetchReference, isInstagramUrl, canonicalInstagramUrl, pickInstagramMedia };
