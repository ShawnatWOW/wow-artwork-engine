// Prompt library (Build Plan M1 · two-phase M2.5).
//
// Two prompts per option:
//   buildStillPrompt  — the Seedream still (the first-frame reference / style).
//   buildMotionPrompt — the Seedance motion applied to that still.
//
// IMPORTANT: prompts describe ONLY the art and its motion WITHIN THE FRAME.
// The models don't know what a pod / EON / spectacular / billboard is, so we
// never mention placement, hardware, or where the art will run — only the
// visual: subject, style, and in-frame direction (e.g. "from the right edge to
// the left edge across the full width"). Placement (slicing across three pods,
// etc.) is handled by our pipeline, not the model.
//
// Pure + deterministic (seeded by week + option) so runs are reproducible and
// variations are easy to compare.

// Rotating creative themes — art descriptions only.
const THEMES = [
  'bold neon geometric forms, high-energy, deep contrast',
  'liquid metallic ribbons flowing across a dark field',
  'sunrise gradients with drifting particles of light',
  'a retro-futuristic grid horizon with a glowing sun',
  'an abstract botanical bloom unfolding',
  'iridescent soap-bubble textures with prismatic highlights',
  'a cosmic nebula swirl with slow parallax stars',
  'crisp origami shapes folding and unfolding',
];

// Per-style composition for the STILL (in-frame art direction only).
// "hero subject" alone makes image models default to a photoreal PERSON —
// which is a likeness/brand risk AND gets refused by video-model moderation
// ("likenesses of real people"). Always steer to non-human subjects.
const STILL_FRAMING = {
  frame_break: 'A single bold non-human hero subject (a sculptural object, animal, plant, or abstract form) centered with generous empty margins, cinematic depth and dramatic lighting',
  eon_single: 'A self-contained vertical composition with a strong non-human central focal point, in a tall vertical frame',
};

// In-frame travel direction per option, so the three options differ and we can
// compare which reads best. "start/end" are edges of the frame — nothing about
// where the art is displayed.
const TRAVELS = [
  { dir: 'rtl', start: 'right', end: 'left', verb: 'glides' },
  { dir: 'ltr', start: 'left', end: 'right', verb: 'travels' },
  { dir: 'rtl', start: 'right', end: 'left', verb: 'slithers' },
];

/** The in-frame travel spec for a wide-composition option (1-based). Pure. */
export function travelFor(option) {
  return TRAVELS[(option - 1) % TRAVELS.length];
}

/** Stable non-negative hash of a string (FNV-1a). Pure. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function themeFor({ specKey, option, weekOf }) {
  return THEMES[hash(`${weekOf || 'week'}:${specKey}:${option}`) % THEMES.length];
}

const SAFE = 'Ultra high detail. No people, no faces, no human figures, no text, no logos, no watermarks.';

/**
 * The still (first-frame) prompt for one option — art + composition only.
 * @param {{ style, specKey, option, weekOf }} job
 */
export function buildStillPrompt({ style, specKey, option, weekOf }) {
  const theme = themeFor({ specKey, option, weekOf });
  if (style === 'eon_connected') {
    // A wide panoramic composition; the subject starts at one edge with open
    // space across the rest so there's room to travel. No mention of pods.
    const t = travelFor(option);
    return `An ultra-wide continuous panoramic composition. Style: ${theme}. ` +
      `A single clear non-human hero subject (an animal, object, or abstract form) positioned at the ${t.start} side of the frame, with open, ` +
      `uncluttered negative space filling the rest of the width; evenly lit edge to edge, no hard breaks. ${SAFE}`;
  }
  const framing = STILL_FRAMING[style] || 'A striking abstract composition';
  return `${framing}. Style: ${theme}. ${SAFE}`;
}

/**
 * The motion prompt for one option — how the art moves within the frame.
 * @param {{ style, specKey, option, weekOf }} job
 */
export function buildMotionPrompt({ style, specKey, option, weekOf }) {
  const theme = themeFor({ specKey, option, weekOf });
  if (style === 'eon_connected') {
    const t = travelFor(option);
    return `Smooth continuous motion: the hero subject ${t.verb} steadily from the ${t.start} edge of the frame ` +
      `all the way to the ${t.end} edge, moving across the full width at a constant, even speed. ` +
      `The background stays continuous; seamless and loopable.`;
  }
  if (style === 'frame_break') {
    return `Subtle cinematic motion: ${theme}; the hero subject eases gently forward toward the viewer. ` +
      `Smooth, premium, seamless loop.`;
  }
  return `Gentle ambient motion: ${theme}; slow drift and shimmer, smooth and seamless loop.`;
}

export { THEMES };
export default { buildStillPrompt, buildMotionPrompt, travelFor, THEMES };
