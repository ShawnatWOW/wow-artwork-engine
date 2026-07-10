// Prompt library (Build Plan M1 · two-phase M2.5).
//
// Two prompts per option:
//   buildStillPrompt  — the Seedream still (the first-frame reference / style).
//   buildMotionPrompt — the Seedance motion applied to that still.
// Split so we can review the still (cheap) before spending on motion, and so
// motion direction is explicit — critical for EON, where a subject must travel
// across the three pods (e.g. "slithers from the far-right edge to the
// far-left edge"). Pure + deterministic (seeded by week + option) so runs are
// reproducible and variations are easy to compare.

// Rotating creative themes. Deterministically indexed by week + option.
const THEMES = [
  'bold neon geometric forms, high-energy, deep contrast',
  'liquid metallic ribbons flowing across a dark field',
  'sunrise gradients with drifting particles of light',
  'retro-futuristic grid horizon with a glowing sun',
  'an abstract botanical bloom unfolding',
  'iridescent soap-bubble textures, prismatic highlights',
  'a cosmic nebula swirl with slow parallax stars',
  'crisp origami shapes folding and unfolding',
];

// Per-style framing for the STILL (composition guidance for the image model).
const STILL_FRAMING = {
  frame_break: 'a single bold hero subject centered with generous empty margins, cinematic depth, designed to pop out of a frame toward the viewer',
  eon_single: 'a self-contained vertical composition balanced for a tall, narrow panel, strong central focal point',
  // eon_connected framing is directional — see buildStillPrompt.
};

// EON travel direction per option, so the three options are visibly different
// and we can compare which reads best across the pods.
//   pods sit left→right as pod 1 | pod 2 | pod 3.
const TRAVELS = [
  { dir: 'rtl', start: 'far-right', end: 'far-left', order: 'pod 3 → pod 2 → pod 1', verb: 'glides' },
  { dir: 'ltr', start: 'far-left', end: 'far-right', order: 'pod 1 → pod 2 → pod 3', verb: 'travels' },
  { dir: 'rtl', start: 'far-right', end: 'far-left', order: 'pod 3 → pod 2 → pod 1', verb: 'slithers' },
];

/** The travel spec for an EON-connected option (1-based). Pure. */
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

const SAFE = 'Vivid, premium, brand-safe. No text, no logos, no watermarks.';

/**
 * The still (first-frame) prompt for one option.
 * @param {{ style, specKey, option, weekOf }} job
 */
export function buildStillPrompt({ style, specKey, option, weekOf }) {
  const theme = themeFor({ specKey, option, weekOf });
  if (style === 'eon_connected') {
    const t = travelFor(option);
    return `WOW EON billboard — one continuous ultra-wide composition spanning three vertical pods. ${theme}. ` +
      `Place the hero subject at the ${t.start} edge with open, uncluttered space across the rest of the width, ` +
      `so it can travel the full frame; seamless left-to-right continuity with no hard seams between pods. ${SAFE}`;
  }
  const framing = STILL_FRAMING[style] || 'a striking abstract composition';
  return `WOW billboard artwork — ${framing}. ${theme}. First frame for a short motion clip. ${SAFE}`;
}

/**
 * The motion prompt for one option — how Seedance animates the still.
 * @param {{ style, specKey, option, weekOf }} job
 */
export function buildMotionPrompt({ style, specKey, option, weekOf }) {
  const theme = themeFor({ specKey, option, weekOf });
  if (style === 'eon_connected') {
    const t = travelFor(option);
    return `Animate this frame: the hero subject ${t.verb} smoothly from the ${t.start} edge to the ${t.end} edge, ` +
      `crossing the entire width so it passes across all three pods in sequence (${t.order}); ` +
      `constant, even speed, seamless and loopable. Keep the background continuous. 6 seconds.`;
  }
  if (style === 'frame_break') {
    return `Animate this frame: subtle cinematic motion — ${theme} — with the hero subject easing forward as if breaking ` +
      `out of the frame toward the viewer; smooth, premium, loopable. 6 seconds.`;
  }
  return `Animate this frame: gentle ambient motion — ${theme} — slow drift and shimmer, smooth and loopable. 6 seconds.`;
}

export { THEMES };
export default { buildStillPrompt, buildMotionPrompt, travelFor, THEMES };
