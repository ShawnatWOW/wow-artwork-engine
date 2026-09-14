// The STYLE ANALYST (Style Library, 2026-09-14): shown the frames of a
// reference Scott liked, it writes a style card in the exact shape the pool
// already rolls from — one prompt-ready sentence plus a three-creature cast
// native to that world — and the notes the dashboard shows (palette, medium,
// era, motion). Same conventions as director.js: raw fetch, config read at
// call time, NEVER throws — any failure returns null and the caller marks
// the style as needing a hand-written card.
//
// What it must never do, because the generator downstream can't survive it:
//   - name a living artist or a brand (likeness/style-copy trouble, and the
//     video model's moderation refuses on it),
//   - describe people or faces (photoreal likeness refusals — 2026-09-02),
//   - leak placement words (billboard, sign, panel…) or meta words (artwork,
//     poster, framed…) that the models literalize into the picture.

import { readFile } from 'node:fs/promises';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

const SYSTEM = `You are the style analyst for a studio that paints giant animated outdoor artworks in many visual styles. You are shown frames from a reference piece the creative director liked. Your job is to capture its VISUAL STYLE — not its subject — as a reusable style card, so new scenes with entirely different subjects can be painted to look like it.

Return STRICT JSON with exactly these fields:
{
 "label": "<2-4 word name for this style, Title Case>",
 "style": "<ONE sentence, 20-40 words, the genre first, ending in the phrase 'digital art' somewhere in it. Concrete visual descriptors only: medium, linework, palette, lighting, texture, era. Example of the voice: 'cyberpunk digital art — a rain-slicked neon megacity of holographic light, chrome towers and electric color'>",
 "medium": "<e.g. cel animation, gouache, 3D render, risograph, pixel art>",
 "era": "<the period or movement it evokes, or 'contemporary'>",
 "palette": ["<hex>", "<hex>", "<hex>", "<hex>", "<hex>"],
 "lighting": "<one short phrase>",
 "linework": "<one short phrase>",
 "texture": "<one short phrase>",
 "composition": "<one short phrase about depth, framing, density>",
 "motion_signature": "<one short phrase: how things move in this world, drawn from the frames and the motion hint>",
 "cast": {
   "keeper": "<a colossal, slow, awe-inspiring non-human creature or living object native to this world, described in 6-12 words>",
   "hero": "<a mid-sized, fast, agile non-human creature or living object, 6-12 words>",
   "companion": "<a small, quick, playful non-human creature or living object, 6-12 words>"
 },
 "avoid": ["<up to 4 things that would break the look, e.g. 'photorealism', 'muted colors'>"],
 "confidence": <0-1>
}

HARD RULES:
- Never name a real artist, studio, brand, franchise, film, game or character. Describe the look in your own words instead.
- The cast are stylized non-human beings (animals, mythic creatures, robots, plants, living objects). Never people, never faces, never anything photorealistic.
- Never use these words anywhere: billboard, sign, panel, pod, spectacular, artwork, poster, framed, canvas, display, screen, logo, text.
- No text or lettering in any description.
- If the frames are a montage of several styles, describe the dominant one.`;

// Words the downstream prompts must not carry (see test/prompts.test.js).
const DOMAIN_TERMS = /\b(pod|pods|eon|eons|spectacular|spectaculars|billboard|billboards|sign|signs|panel|panels)\b/gi;
const META_TERMS = /\b(artwork|artworks|poster|posters|framed|canvas|display|displays|screen|screens)\b/gi;
const SUBS = {
  billboard: 'scene', billboards: 'scenes', sign: 'scene', signs: 'scenes', panel: 'scene', panels: 'scenes',
  pod: 'form', pods: 'forms', eon: 'era', eons: 'eras', spectacular: 'breathtaking', spectaculars: 'breathtaking scenes',
  artwork: 'art', artworks: 'art', poster: 'print', posters: 'prints', framed: 'bordered', canvas: 'surface',
  display: 'scene', displays: 'scenes', screen: 'view', screens: 'views',
};

/** Strip the words the generator can't carry; keep everything else. Pure. */
export function scrub(text) {
  return String(text || '')
    .replace(DOMAIN_TERMS, (w) => SUBS[w.toLowerCase()] ?? '')
    .replace(META_TERMS, (w) => SUBS[w.toLowerCase()] ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Coerce the model's JSON into a card the library accepts, or null when the
 * essentials (a style sentence + a full cast) are missing. Pure; exported
 * for tests. The `style` sentence is guaranteed to say "digital art" — every
 * pool entry does, and it is what keeps the still painterly, not photographic.
 */
export function normalizeCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = (v, max = 400) => scrub(String(v ?? '')).slice(0, max);
  let style = s(raw.style, 500);
  if (!style) return null;
  if (!/digital art/i.test(style)) style = `${style.replace(/[.\s]+$/, '')} — digital art`;
  const cast = {
    keeper: s(raw.cast?.keeper, 160),
    hero: s(raw.cast?.hero, 160),
    companion: s(raw.cast?.companion, 160),
  };
  if (!cast.keeper || !cast.hero || !cast.companion) return null;
  const palette = Array.isArray(raw.palette)
    ? raw.palette.map((c) => String(c).trim()).filter((c) => /^#?[0-9a-f]{6}$/i.test(c)).map((c) => (c.startsWith('#') ? c : `#${c}`)).slice(0, 8)
    : [];
  const avoid = Array.isArray(raw.avoid) ? raw.avoid.map((a) => s(a, 60)).filter(Boolean).slice(0, 6) : [];
  const confidence = Number(raw.confidence);
  return {
    label: s(raw.label, 60) || null,
    style,
    cast,
    analysis: {
      medium: s(raw.medium, 80), era: s(raw.era, 80), palette,
      lighting: s(raw.lighting, 120), linework: s(raw.linework, 120), texture: s(raw.texture, 120),
      composition: s(raw.composition, 160), motion_signature: s(raw.motion_signature, 160),
      avoid, confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    },
  };
}

/**
 * Ask the vision model for the card.
 * @param {{ frames: string[], hints?: { name?, caption?, motion?, isVideo?, durationS? } }} o
 * @returns {Promise<ReturnType<typeof normalizeCard>|null>} null on ANY failure. Never throws.
 */
export async function analyzeStyle({ frames, hints = {} } = {}) {
  const { apiKey, baseUrl, styleModel } = config.openai;
  if (!apiKey || !frames?.length) return null;
  try {
    const images = [];
    for (const f of frames.slice(0, config.styles.maxFrames)) {
      const b64 = (await readFile(f)).toString('base64');
      images.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'low' } });
    }
    const lines = [
      `${images.length} frame${images.length === 1 ? '' : 's'} from the reference${hints.isVideo ? ` (a ${hints.durationS ? `${Math.round(hints.durationS)}-second ` : ''}video, sampled evenly)` : ' (a still)'}.`,
      hints.name ? `The director named it: "${hints.name}".` : '',
      hints.motion?.description ? `Measured motion: ${hints.motion.description}.` : '',
      hints.caption ? `Caption that came with it (hints only, may name techniques; ignore names of people): "${String(hints.caption).slice(0, 400)}".` : '',
      'Write the style card. JSON only.',
    ].filter(Boolean);

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: styleModel,
        max_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: [{ type: 'text', text: lines.join(' ') }, ...images] },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`openai ${resp.status}`);
    const data = await resp.json();
    const card = normalizeCard(JSON.parse(data.choices?.[0]?.message?.content || '{}'));
    if (!card) logger.warn('Style analyst returned an incomplete card');
    return card;
  } catch (err) {
    logger.warn({ err: err.message }, 'Style analyst failed');
    return null;
  }
}

export default { analyzeStyle, normalizeCard, scrub };
