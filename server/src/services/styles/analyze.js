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

const SYSTEM = `You are the style analyst for a studio that paints giant animated outdoor artworks in many visual styles. You are shown frames from a reference piece the creative director liked. Your job is to capture what makes it LOOK the way it does — the TREATMENT, not the subject — as a reusable style card, so new scenes with entirely different subjects come out unmistakably in this look.

Think like a matte painter copying a technique: what is every surface made of? how many colours are on screen at once and how are they used? what is the backdrop? how close is the camera? what is the lighting? what texture does the medium have? The card must let someone who has never seen the reference reproduce those decisions.

Return STRICT JSON with exactly these fields:
{
 "label": "<2-4 word name for this style, Title Case>",
 "style": "<ONE sentence, 25-45 words, that LEADS with the surface treatment and the medium, then colour rule, backdrop, lighting and texture, and contains the phrase 'digital art'. Concrete and specific — never generic words like 'vibrant', 'dynamic', 'bold' on their own. Example of the voice: 'cyberpunk digital art — a rain-slicked neon megacity of holographic light, chrome towers and electric color'>",
 "signature": ["<3 to 6 short non-negotiable rules that define this look, each 4-14 words. Always cover: the surface treatment, the colour count, the backdrop, the scale/framing, and HOW MANY subjects share a frame (e.g. 'one or two subjects only, never a crowd'). E.g. 'every figure and object is coated in thick glossy wet paint as if dipped', 'exactly two flat colours per scene, one per body, colliding where they touch', 'plain pale lavender studio backdrop, empty and evenly lit', 'macro close-up: subjects fill the frame, no landscape'>"],
 "backdrop": "<what the background is in this look, in 3-12 words — e.g. 'plain pale lavender studio wall', 'deep black void', 'dense neon jungle'>",
 "subject_count": <how many living subjects share ONE frame in the reference: 1, 2, 3, or "many" — a portrait of one figure is 1, two bodies colliding is 2, a bustling scene is "many">,
 "scene_mode": "<'material' when the picture IS a substance — paint, liquid, smoke, fabric, glass, sand — and the subjects are made of it or drowned in it, so the texture of that substance is what the eye is on; 'subject' when the treatment is a rendering style applied to recognisable characters and places (cel animation, risograph, pixel art…)>",
 "material": "<for 'material' looks: the substance itself in 3-8 words, e.g. 'thick glossy wet acrylic paint', 'molten chrome', 'coloured smoke'; otherwise ''>",
 "color_rule": "<START WITH HOW MANY distinct colours share one frame, then how they are used, 4-16 words — e.g. 'two saturated flat colours per scene, one per body, no gradients', 'three inks overprinted', 'many: full rainbow spectrum everywhere'>",
 "medium": "<e.g. cel animation, gouache, 3D render, high-speed studio photography of liquid paint, risograph, pixel art>",
 "era": "<the period or movement it evokes, or 'contemporary'>",
 "palette": ["<hex>", "<hex>", "<hex>", "<hex>", "<hex>"],
 "lighting": "<one short phrase>",
 "linework": "<one short phrase>",
 "texture": "<one short phrase>",
 "composition": "<one short phrase about scale, framing, density — how much of the frame the subject fills, how empty the rest is>",
 "motion_signature": "<one short phrase: how things move in this world, drawn from the frames and the motion hint>",
 "cast": {
   "keeper": "<a colossal, slow, awe-inspiring non-human creature or living object native to this world, rendered WITH this style's treatment, 6-14 words>",
   "hero": "<a mid-sized, fast, agile non-human creature or living object, with the treatment, 6-14 words>",
   "companion": "<a small, quick, playful non-human creature or living object, with the treatment, 6-14 words>"
 },
 "avoid": ["<up to 4 things that would break the look, e.g. 'photorealism', 'muted colors', 'busy landscape backgrounds'>"],
 "confidence": <0-1>
}

HARD RULES:
- Never name a real artist, studio, brand, franchise, film, game or character. Describe the look in your own words instead.
- If the reference shows PEOPLE, do not describe them as people — describe the TREATMENT applied to them (coated, sculpted, painted, cel-shaded…) and give that same treatment to the cast. The treatment is the style; the people are just the subject.
- For a 'material' look, every cast member is a creature SCULPTED FROM the material — write it that way ('a whale sculpted from thick yellow paint', 'a hare cast in molten chrome'), never an animal with the material on it ('an eagle streaked with paint' still comes out with feathers).
- The cast are CONCRETE, tangible, clearly non-humanoid creatures — animals, beasts, mythic creatures, plants, living objects — that CARRY the treatment on their own bodies, e.g. 'a colossal bison dipped head to hoof in glossy cobalt paint', 'a hare cast in thick dripping magenta paint mid-leap'. Never abstract effects as cast members (no 'a vortex of paint', 'a flow of colour', 'a burst of light' — those are scenery, not characters). Never people, never faces, never humanoid figures (no sprites, elves, golems with faces, robots shaped like people), never anything photorealistic.
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
  // The signature (2026-09-15): the rules the generator must honour even when
  // the composition boilerplate pulls the other way. Live finding: a paint-
  // dipped two-tone studio look came out as a rainbow landscape because only
  // the one-sentence `style` reached the prompt and the scene rules
  // ("deep dark background", "full creative freedom", "living world") won.
  const signature = Array.isArray(raw.signature) ? raw.signature.map((a) => s(a, 140)).filter(Boolean).slice(0, 6) : [];
  // How many living subjects share a frame. 1 or 2 means the spectacular's
  // three-creature ensemble must yield (Shawn, 2026-09-15: "it's still
  // forcing a bunch of characters") — the crowd was Scott's 2026-08-05
  // ensemble requirement, right for the house looks, wrong for a portrait.
  const sc = String(raw.subject_count ?? '').trim().toLowerCase();
  const subject_count = /^[123]$/.test(sc) ? Number(sc) : (sc ? 'many' : null);
  // MATERIAL looks (Shawn, 2026-09-15: "it just needs to be an all paint
  // scene… not enough on the texture of the paint"): the substance is the
  // picture and the subjects are made of it — the prompt leads with the
  // material and its surface, not with who is standing where.
  const scene_mode = String(raw.scene_mode ?? '').trim().toLowerCase() === 'material' ? 'material' : 'subject';
  const material = scene_mode === 'material' ? s(raw.material, 80) : '';
  const confidence = Number(raw.confidence);
  return {
    label: s(raw.label, 60) || null,
    style,
    cast,
    analysis: {
      signature, backdrop: s(raw.backdrop, 120), color_rule: s(raw.color_rule, 140), subject_count, scene_mode, material,
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

    const ask = async (extraUser) => {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: styleModel,
          max_tokens: 900,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: [{ type: 'text', text: lines.join(' ') + (extraUser ? ` ${extraUser}` : '') }, ...images] },
          ],
        }),
      });
      if (!resp.ok) throw new Error(`openai ${resp.status}`);
      const data = await resp.json();
      return JSON.parse(data.choices?.[0]?.message?.content || '{}');
    };
    let raw = await ask();
    let card = normalizeCard(raw);
    if (!card) {
      // One retry with the gap named: the model occasionally drops a cast
      // member or the style sentence, and a second ask fixes it far more
      // often than it repeats (live, 2026-09-15). A style must not land as
      // "Needs details" over a one-off omission.
      const missing = missingFields(raw);
      logger.warn({ missing }, 'Style analyst returned an incomplete card — asking once more');
      raw = await ask(`Your previous answer was missing or empty: ${missing.join(', ')}. Return the complete card with every field filled.`);
      card = normalizeCard(raw);
      if (!card) logger.warn({ missing: missingFields(raw) }, 'Style analyst returned an incomplete card twice');
    }
    return card;
  } catch (err) {
    logger.warn({ err: err.message }, 'Style analyst failed');
    return null;
  }
}

/** Which essentials a raw answer lacks. Pure; exported for tests. */
export function missingFields(raw) {
  const out = [];
  if (!raw || typeof raw !== 'object') return ['everything'];
  if (!String(raw.style || '').trim()) out.push('style');
  for (const k of ['keeper', 'hero', 'companion']) if (!String(raw.cast?.[k] || '').trim()) out.push(`cast.${k}`);
  return out;
}

export default { analyzeStyle, normalizeCard, missingFields, scrub };
