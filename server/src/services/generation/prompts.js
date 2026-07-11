// Prompt library (Build Plan M1 · two-phase M2.5 · art-review hardened).
//
// Two prompts per option:
//   buildStillPrompt  — the Seedream still (the first-frame reference / style).
//   buildMotionPrompt — the Seedance motion applied to that still.
//
// RULES (learned from the first live run + art-director review, 2026-07-10):
// - Describe ONLY the art and in-frame motion. Never placement/hardware (pod,
//   billboard, sign…) — the models don't know what those are.
// - NAME the hero subject. "A hero subject" alone collapses to a photoreal
//   person, which video-model moderation refuses ("likenesses of real people")
//   and is a likeness risk. Themes are (style, subject) pairs.
// - Poster contrast: bright saturated subject vs deep dark background (or the
//   inverse) — never all-white / all-black scenes (unreadable in direct sun).
// - No meta-artwork vocabulary (poster, framed, canvas…) — models literalize
//   it into pictures-of-pictures.
// - Motion: locked camera, constant speed, explicit color-constancy (Seedance
//   saturation drains over a clip unless told not to).
// Pure + deterministic (seeded by week + option) so runs are reproducible.

// (style, subject) pairs — the subject is concrete and non-human by
// construction. Rotated deterministically by week + option.
const THEMES = [
  { style: 'bold neon geometric forms, high-energy, deep contrast', subject: 'a glowing chrome sphere' },
  { style: 'liquid metallic ribbons flowing across a dark field', subject: 'a ribbon of molten silver' },
  { style: 'sunrise gradients with drifting particles of light', subject: 'a hot-air balloon' },
  { style: 'a retro-futuristic grid horizon with a glowing sun', subject: 'a vintage convertible car' },
  { style: 'lush macro botanicals on black', subject: 'a blooming crimson flower' },
  { style: 'iridescent soap-bubble textures with prismatic highlights', subject: 'a glassy iridescent bubble' },
  { style: 'a cosmic nebula swirl with slow parallax stars', subject: 'a luminous comet' },
  { style: 'crisp folded-paper geometry', subject: 'an origami crane' },
  { style: 'deep-sea bioluminescence on near-black water', subject: 'a neon jellyfish' },
  { style: 'autumn wind on a moody sky', subject: 'a monarch butterfly' },
];

// In-frame travel direction per option (frame edges only — never placement).
const TRAVELS = [
  { dir: 'rtl', start: 'right', end: 'left', verb: 'glides' },
  { dir: 'ltr', start: 'left', end: 'right', verb: 'travels' },
  { dir: 'rtl', start: 'right', end: 'left', verb: 'drifts' },
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

/** The (style, subject) theme for one option. Pure; exported for the UI/tests. */
export function themeFor({ specKey, option, weekOf }) {
  return THEMES[hash(`${weekOf || 'week'}:${specKey}:${option}`) % THEMES.length];
}

// Poster-readability + safety clauses appended to every still prompt.
const CONTRAST =
  'High-contrast lighting: a bright, saturated hero subject against a deep, dark background, ' +
  'strong tonal separation readable from far away in direct sunlight; never an all-white or all-black scene.';
const SAFE =
  'Ultra high detail. No people, no faces, no human figures, no human silhouettes, no mannequins, ' +
  'no statues of people, no hands, no text, no logos, no watermarks.';

/**
 * The still (first-frame) prompt for one option — art + composition only.
 * @param {{ style, specKey, option, weekOf }} job
 */
export function buildStillPrompt({ style, specKey, option, weekOf }) {
  const t = themeFor({ specKey, option, weekOf });
  if (style === 'eon_connected') {
    const tr = travelFor(option);
    return `An ultra-wide continuous panoramic scene. Style: ${t.style}. ` +
      `The single hero subject is ${t.subject}, positioned at the ${tr.start} edge, occupying about one third ` +
      `of the frame width and at least 60% of the frame height, with a continuous seamless environment extending ` +
      `across the full width for it to travel through; uniform lighting and background texture edge to edge; ` +
      `no secondary focal objects; keep the subject clear of the vertical lines at one-third and two-thirds of the frame width. ` +
      `${CONTRAST} ${SAFE}`;
  }
  if (style === 'frame_break') {
    return `An ultra-wide cinematic scene. Style: ${t.style}. ` +
      `The single hero subject is ${t.subject}, centered, with generous open margins on both sides and ` +
      `the entire subject contained in the central horizontal band of the frame (the top and bottom edges are ` +
      `expendable background texture). Cinematic depth and dramatic lighting. ${CONTRAST} ${SAFE}`;
  }
  // eon_single: tall portrait composition.
  return `A tall vertical scene. Style: ${t.style}. ` +
    `The single hero subject is ${t.subject}, filling most of the frame height with a strong central focal point ` +
    `and bold silhouette. ${CONTRAST} ${SAFE}`;
}

/**
 * The motion prompt for one option — how the art moves within the frame.
 * @param {{ style, specKey, option, weekOf }} job
 */
export function buildMotionPrompt({ style, specKey, option, weekOf }) {
  const t = themeFor({ specKey, option, weekOf });
  const CONSTANCY =
    'Locked static camera; no zoom, no pan. The background remains completely static. ' +
    'Colors, saturation and lighting remain exactly constant for the entire duration; no fading, no color drift.';
  if (style === 'eon_connected') {
    const tr = travelFor(option);
    return `Smooth continuous motion: ${t.subject} ${tr.verb} steadily from the ${tr.start} edge of the frame ` +
      `all the way to the ${tr.end} edge, entering at the first frame and reaching the far edge only in the final frame, ` +
      `moving across the full width at a perfectly constant speed. ${CONSTANCY}`;
  }
  if (style === 'frame_break') {
    return `Subtle cinematic motion: ${t.subject} eases gently forward toward the viewer with premium, smooth movement. ${CONSTANCY}`;
  }
  return `Gentle ambient motion: ${t.subject} moves with slow drift and shimmer, smooth and calm. ${CONSTANCY}`;
}

export { THEMES };
export default { buildStillPrompt, buildMotionPrompt, travelFor, themeFor, THEMES };
