// Prompt library (Build Plan M1).
//
// Builds the text prompt handed to the model for each surface/option. Pure and
// deterministic (seeded by week + option) so a run is reproducible and tests
// are stable. Prompts are always screened by guardrails before spend
// (see orchestrator + services/guardrails.js).
//
// In fixture mode the prompt is cosmetic — the fixture provider ignores it —
// but it is still stored on the artwork and guardrail-checked, so swapping to
// live generation changes nothing but the provider.

// Rotating creative themes. Deterministically indexed by week + option so the
// three options for a surface differ, and different weeks differ.
const THEMES = [
  'bold neon geometric motion, high-energy, deep contrast',
  'liquid metallic ribbons flowing across a dark field',
  'sunrise gradients with drifting particles of light',
  'retro-futuristic grid horizon with a glowing sun',
  'abstract botanical bloom unfolding in slow motion',
  'iridescent soap-bubble textures, prismatic highlights',
  'cosmic nebula swirl with slow parallax stars',
  'crisp origami shapes folding and unfolding',
];

// Per-style framing so each surface reads correctly on its sign.
const STYLE_FRAMING = {
  frame_break: 'a single hero subject that appears to break out of the frame toward the viewer, strong central focal point, empty margins',
  eon_connected: 'one continuous wide composition with a clear element that travels left-to-right across the full width',
  eon_single: 'a self-contained vertical composition, balanced for a tall narrow panel',
};

/** Stable non-negative hash of a string (FNV-1a). Pure. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Build the prompt for one job.
 * @param {{ surface, style, specKey, option, weekOf }} job
 * @returns {string}
 */
export function buildPrompt({ style, specKey, option, weekOf }) {
  const seed = hash(`${weekOf || 'week'}:${specKey}:${option}`);
  const theme = THEMES[seed % THEMES.length];
  const framing = STYLE_FRAMING[style] || 'a striking abstract composition';
  return `WOW billboard artwork — ${framing}. Style: ${theme}. ` +
    'Vivid, premium, brand-safe, no text, no logos, no watermarks.';
}

export { THEMES };
export default { buildPrompt, THEMES };
