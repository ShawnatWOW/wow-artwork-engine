// Ingesting a new style (Style Library, 2026-09-14): Scott drops in a
// reference — an uploaded screenshot/recording or a pasted link — names it,
// and this turns it into a style card the pool can roll.
//
//   row (analyzing) → fetch/copy source → frames + thumbnail + motion
//     → analyst writes the card → guardrail → row (ready)
//     → PREVIEW: one cheap still of what the style looks like on the wide
//       sign, so the reviewer sees the result before trusting it.
//
// The row exists (status 'analyzing', analysis.stage advancing) from the
// first millisecond so the dashboard can show progress; everything after the
// insert runs in the background. A failed analysis is a 'failed' row that
// KEEPS its frames and thumbnail: the reviewer can write the style sentence
// and cast by hand (PATCH) and it becomes usable.

import { mkdtemp, rm, copyFile, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import config from '../../config/index.js';
import logger from '../../config/logger.js';
import { getRepo } from '../../db/index.js';
import { getStore } from '../storage/index.js';
import { getProviders } from '../generation/index.js';
import { checkPrompt } from '../guardrails.js';
import { buildStillPrompt } from '../generation/prompts.js';
import falPricing from '../generation/falPricing.js';
import { extractReference, makeThumb } from './frames.js';
import { cropStillToAspect } from '../ffmpeg.js';
import { analyzeStyle } from './analyze.js';
import { fetchReference } from './links.js';
import { toLook, isComplete } from './library.js';

// The preview renders the borderless spectacular (option 2: the whole cast,
// no frame talk) at half the sign's generation size — enough to judge the
// look, and Seedream bills per image regardless of size.
const PREVIEW = { style: 'frame_break', specKey: 'spectacular_wow1_8', option: 2, width: 2048, height: 566 };

/** A URL-safe key from the reviewer's name. Pure; exported for tests. */
export function slugify(name = '') {
  return String(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

async function uniqueKey(repo, base) {
  const root = base || `style_${Date.now().toString(36)}`;
  let key = root;
  for (let n = 2; await repo.getStyleByKey(key); n += 1) key = `${root}_${n}`;
  return key;
}

const styleKey = (id, name) => `styles/${id}/${name}`;

async function setStage(repo, id, stage, extra = {}) {
  const row = await repo.getStyle(id);
  if (!row) return null;
  return repo.updateStyle(id, { analysis: { ...(row.analysis || {}), stage, ...extra } });
}

function resolveDeps(deps) {
  return {
    repo: deps.repo || getRepo(),
    analyze: deps.analyze || analyzeStyle,
    fetchLink: deps.fetchReference || fetchReference,
  };
}

/**
 * Create the row and kick off analysis.
 * @param {{ name?: string, source: { kind: 'file', path, filename } | { kind: 'link', url },
 *   createdBy?: string, deps?: object }} o
 * @returns {Promise<{ style, done: Promise<object> }>} the new row, plus the
 *   background job's promise (awaited by tests; routes let it run).
 */
export async function ingestStyle({ name, source, createdBy = null, deps = {} }) {
  const { repo } = resolveDeps(deps);
  const label = String(name || '').trim().slice(0, 60);
  if (!source || !['file', 'link'].includes(source.kind)) throw Object.assign(new Error('Nothing to add — upload a file or paste a link.'), { code: 'bad_source' });
  if (source.kind === 'link' && !/^https?:\/\//i.test(String(source.url || '').trim())) {
    throw Object.assign(new Error('That is not a link.'), { code: 'bad_link' });
  }
  const key = await uniqueKey(repo, slugify(label));
  const row = await repo.insertStyle({
    key,
    label: label || 'New style',
    style: '',
    cast: {},
    sourceType: source.kind === 'link' ? 'link' : 'upload',
    sourceUrl: source.kind === 'link' ? String(source.url).trim() : null,
    sourceName: source.kind === 'file' ? String(source.filename || 'upload').slice(0, 120) : null,
    analysis: { stage: 'queued' },
    enabled: true,
    status: 'analyzing',
    createdBy,
  });
  const done = processStyle({ styleId: row.id, source, name: label, deps })
    .catch((err) => { logger.error({ styleId: row.id, err: err.message }, 'Style ingest crashed'); return null; });
  return { style: row, done };
}

/**
 * The background job: source → frames → card → preview. Resolves to the
 * final row. Never throws past the ingestStyle catch (a failure is a row).
 */
export async function processStyle({ styleId, source, name, deps = {} }) {
  const { repo, analyze, fetchLink } = resolveDeps(deps);
  const store = deps.store || (await getStore());
  const workDir = deps.workDir || (await mkdtemp(path.join(os.tmpdir(), `wae-style-${styleId}-`)));
  try {
    // 1. The source file.
    await setStage(repo, styleId, 'fetching');
    let file;
    let caption = '';
    if (source.kind === 'link') {
      const fetched = await fetchLink({ url: source.url, outDir: workDir });
      file = { path: fetched.path, filename: fetched.filename };
      caption = fetched.caption || '';
      if (fetched.sourceUrl) await repo.updateStyle(styleId, { sourceUrl: fetched.sourceUrl });
    } else {
      const ext = path.extname(source.filename || '').toLowerCase() || '.bin';
      const dest = path.join(workDir, `source${ext}`);
      await copyFile(source.path, dest);
      file = { path: dest, filename: source.filename || `source${ext}` };
    }
    const sourceKey = styleKey(styleId, `source${path.extname(file.filename).toLowerCase() || '.bin'}`);
    await store.put({ key: sourceKey, sourcePath: file.path });

    // 2. Watch it: frames, thumbnail, motion.
    await setStage(repo, styleId, 'watching');
    const framesDir = path.join(workDir, 'frames');
    const ref = await extractReference({ input: file.path, outDir: framesDir, filename: file.filename });
    const frameKeys = [];
    for (const [i, f] of ref.frames.entries()) {
      const put = await store.put({ key: styleKey(styleId, `frames/f${String(i + 1).padStart(2, '0')}.jpg`), sourcePath: f });
      frameKeys.push(put.key);
    }
    const thumb = await store.put({ key: styleKey(styleId, 'thumb.jpg'), sourcePath: ref.thumbnail });
    await repo.updateStyle(styleId, { sourceKey, frameKeys, thumbnailKey: thumb.key });
    await setStage(repo, styleId, 'writing', {
      source: { isVideo: ref.isVideo, durationS: ref.durationS, width: ref.width, height: ref.height, frames: ref.frames.length },
      motion: ref.motion,
      caption: caption ? caption.slice(0, 400) : undefined,
    });

    // 3. The analyst writes the card.
    const card = await analyze({ frames: ref.frames, hints: { name, caption, motion: ref.motion, isVideo: ref.isVideo, durationS: ref.durationS } });
    const current = await repo.getStyle(styleId);
    if (!card) {
      const reason = config.openai.apiKey
        ? 'The style analyst could not describe this reference — write the style sentence and cast by hand, or try a clearer image.'
        : 'Style analysis needs the OpenAI key (OPENAI_API_KEY) — write the style sentence and cast by hand for now.';
      await repo.updateStyle(styleId, { status: 'failed', error: reason, analysis: { ...(current.analysis || {}), stage: 'failed' } });
      logger.warn({ styleId }, 'Style ingest: no card');
      return repo.getStyle(styleId);
    }
    // The still guardrail runs on the card's own words before it can ever
    // reach a spend — a card that trips it is a failed row, not a blocked batch.
    const gate = checkPrompt(`${card.style} ${Object.values(card.cast).join(' ')}`);
    if (!gate.allowed) {
      await repo.updateStyle(styleId, { status: 'failed', error: `guardrail: ${gate.reasons.join('; ')}`, analysis: { ...(current.analysis || {}), stage: 'failed' } });
      return repo.getStyle(styleId);
    }
    await repo.updateStyle(styleId, {
      // The reviewer's name wins; the analyst's label fills an empty one.
      label: current.label && current.label !== 'New style' ? current.label : (card.label || current.label),
      style: card.style,
      cast: card.cast,
      analysis: { ...(current.analysis || {}), ...card.analysis, stage: 'previewing' },
      status: 'ready',
      error: null,
    });

    // 4. Preview — best-effort; the style is usable without it.
    await previewStyle({ styleId, deps: { ...deps, repo, store, workDir } }).catch((err) => {
      logger.warn({ styleId, err: err.message }, 'Style preview failed');
    });
    const done = await repo.getStyle(styleId);
    await setStage(repo, styleId, 'done');
    logger.info({ styleId, key: done.key, label: done.label }, 'Style ingested');
    return repo.getStyle(styleId);
  } catch (err) {
    logger.error({ styleId, err: err.message }, 'Style ingest failed');
    const current = await repo.getStyle(styleId);
    if (current) await repo.updateStyle(styleId, { status: 'failed', error: err.message, analysis: { ...(current.analysis || {}), stage: 'failed' } });
    return repo.getStyle(styleId);
  } finally {
    if (!deps.workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * RE-ANALYZE a style from its stored frames (2026-09-15): a better analyst
 * (or a hand-edited name) should not need the reference uploaded again. The
 * frames, thumbnail and source stay; the card is rewritten, the reviewer's
 * label kept, and a fresh preview painted. Resolves to the final row; a
 * failure is a 'failed' row exactly like a first-time ingest.
 */
export async function reanalyzeStyle({ styleId, deps = {} }) {
  const { repo, analyze } = resolveDeps(deps);
  const store = deps.store || (await getStore());
  const row = await repo.getStyle(styleId);
  if (!row) throw new Error(`Style ${styleId} not found`);
  if (row.source_type === 'builtin') throw Object.assign(new Error('Built-in styles have no reference to re-analyze.'), { code: 'builtin' });
  if (!row.frame_keys?.length) throw Object.assign(new Error('This style has no stored frames — add it again from the reference.'), { code: 'no_frames' });
  if (row.status === 'analyzing') throw Object.assign(new Error('This style is already being analyzed.'), { code: 'busy' });

  await repo.updateStyle(styleId, { status: 'analyzing', error: null, analysis: { ...(row.analysis || {}), stage: 'writing' } });
  const workDir = deps.workDir || (await mkdtemp(path.join(os.tmpdir(), `wae-style-re-${styleId}-`)));
  try {
    const dir = path.join(workDir, 'frames');
    await mkdir(dir, { recursive: true });
    const frames = [];
    for (const [i, key] of row.frame_keys.entries()) {
      const f = path.join(dir, `f${String(i + 1).padStart(2, '0')}.jpg`);
      await writeFile(f, await store.getBuffer(key));
      frames.push(f);
    }
    const an = row.analysis || {};
    const card = await analyze({ frames, hints: { name: row.label, caption: an.caption, motion: an.motion, isVideo: an.source?.isVideo, durationS: an.source?.durationS } });
    const current = await repo.getStyle(styleId);
    if (!card) {
      const reason = config.openai.apiKey
        ? 'The style analyst could not describe this reference — write the style sentence and cast by hand, or try a clearer image.'
        : 'Style analysis needs the OpenAI key (OPENAI_API_KEY) — write the style sentence and cast by hand for now.';
      // A failed re-analysis keeps the old card usable if it was complete.
      await repo.updateStyle(styleId, { status: isComplete(current) ? 'ready' : 'failed', error: reason, analysis: { ...(current.analysis || {}), stage: 'failed' } });
      return repo.getStyle(styleId);
    }
    const gate = checkPrompt(`${card.style} ${Object.values(card.cast).join(' ')}`);
    if (!gate.allowed) {
      await repo.updateStyle(styleId, { status: isComplete(current) ? 'ready' : 'failed', error: `guardrail: ${gate.reasons.join('; ')}`, analysis: { ...(current.analysis || {}), stage: 'failed' } });
      return repo.getStyle(styleId);
    }
    await repo.updateStyle(styleId, {
      style: card.style,
      cast: card.cast,
      analysis: { ...(current.analysis || {}), ...card.analysis, stage: 'previewing', reanalyzed_at: new Date().toISOString() },
      status: 'ready',
      error: null,
    });
    await previewStyle({ styleId, deps: { ...deps, repo, store, workDir } }).catch((err) => {
      logger.warn({ styleId, err: err.message }, 'Style preview failed after re-analysis');
    });
    await setStage(repo, styleId, 'done');
    logger.info({ styleId, key: row.key }, 'Style re-analyzed');
    return repo.getStyle(styleId);
  } catch (err) {
    logger.error({ styleId, err: err.message }, 'Style re-analysis failed');
    const current = await repo.getStyle(styleId);
    if (current) await repo.updateStyle(styleId, { status: isComplete(current) ? 'ready' : 'failed', error: err.message, analysis: { ...(current.analysis || {}), stage: 'failed' } });
    return repo.getStyle(styleId);
  } finally {
    if (!deps.workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Render (or re-render) the "what this looks like on the sign" preview: one
 * still, the borderless spectacular composition, in this style with its own
 * cast. Live mode spends one Seedream image; the cost lands in the row's
 * analysis so the spend strip can count it.
 */
export async function previewStyle({ styleId, deps = {} }) {
  const { repo } = resolveDeps(deps);
  const store = deps.store || (await getStore());
  const providers = deps.providers || getProviders();
  const row = await repo.getStyle(styleId);
  if (!row) throw new Error(`Style ${styleId} not found`);
  if (!isComplete(row)) throw new Error('This style needs a style sentence and a full cast before it can be previewed.');

  const look = toLook(row);
  const prompt = buildStillPrompt({ ...PREVIEW, weekOf: `style-preview:${row.key}`, look });
  const gate = checkPrompt(prompt);
  if (!gate.allowed) throw new Error(`guardrail: ${gate.reasons.join('; ')}`);

  const workDir = deps.workDir || (await mkdtemp(path.join(os.tmpdir(), `wae-style-preview-${styleId}-`)));
  try {
    const dir = path.join(workDir, 'preview');
    await mkdir(dir, { recursive: true });
    const out = path.join(dir, 'preview.png');
    const gen = await providers.still.generate({ prompt, width: PREVIEW.width, height: PREVIEW.height, output: out });
    // GPT Image caps aspect at 3:1; the preview is the sign's 3.62:1 — crop
    // the centre so the preview shows exactly the sign's shape.
    try {
      const crop = await cropStillToAspect({ input: gen.path, output: path.join(dir, 'preview_cropped.png'), wantAspect: PREVIEW.width / PREVIEW.height });
      if (crop.cropped) gen.path = crop.output;
    } catch (err) { logger.warn({ styleId, err: err.message }, 'Preview aspect crop failed; keeping the painter\'s canvas'); }
    // Every preview gets its own key (a re-render must not overwrite while
    // the old one may still be on screen).
    const stamp = Date.now().toString(36);
    const put = await store.put({ key: styleKey(styleId, `preview_${stamp}.png`), sourcePath: gen.path });
    let thumbKey = put.key;
    try {
      const thumbPath = path.join(dir, 'preview_thumb.jpg');
      await makeThumb({ input: gen.path, output: thumbPath, width: 1280 });
      thumbKey = (await store.put({ key: styleKey(styleId, `preview_${stamp}_thumb.jpg`), sourcePath: thumbPath })).key;
    } catch (err) {
      logger.warn({ styleId, err: err.message }, 'Preview thumbnail failed; serving the full image');
    }
    const live = providers.mode === 'live';
    const current = await repo.getStyle(styleId);
    return repo.updateStyle(styleId, {
      previewKey: put.key, previewThumbKey: thumbKey,
      analysis: {
        ...(current.analysis || {}),
        preview_prompt: prompt,
        preview_at: new Date().toISOString(),
        preview_cost_usd: live ? (gen.costUsd ?? falPricing.seedreamCostUsd({ count: 1 })) : 0,
        preview_costs_usd: [...(current.analysis?.preview_costs_usd || []), { at: new Date().toISOString(), usd: live ? (gen.costUsd ?? falPricing.seedreamCostUsd({ count: 1 })) : 0 }],
      },
    });
  } finally {
    if (!deps.workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export default { ingestStyle, processStyle, previewStyle, reanalyzeStyle, slugify };
