// Prompt library (Build Plan M1 · two-phase M2.5 · art-review hardened ·
// dynamic-motion pass 2026-07-14).
//
// Two prompts per option:
//   buildStillPrompt  — the Seedream still (the first-frame reference / style).
//   buildMotionPrompt — the Seedance motion applied to that still.
//
// RULES (learned from the first live runs + art-director review):
// - Describe ONLY the art and in-frame motion. Never placement/hardware (pod,
//   billboard, sign…) — the models don't know what those are. The three-screen
//   journey is expressed as frame THIRDS: right third → middle third → left.
// - NAME the hero subject. "A hero subject" alone collapses to a photoreal
//   person, which video-model moderation refuses ("likenesses of real people")
//   and is a likeness risk. Themes are (style, subject) pairs.
// - Poster contrast: bright saturated subject vs deep dark background (or the
//   inverse) — never all-white / all-black scenes (unreadable in direct sun).
// - No meta-artwork vocabulary (poster, framed, canvas…) — models literalize
//   it into pictures-of-pictures.
// - Motion: locked camera, explicit color-constancy (Seedance saturation
//   drains over a clip unless told not to).
// - DYNAMIC (Shawn, 2026-07-14): no more plain objects gliding in a straight
//   line. Subjects are characterful creatures caught mid-motion; the connected
//   wide master gets a choreographed 3-act journey (loop on the right screen,
//   a unique trick in the middle, land on the left) that rotates every week.
// Pure + deterministic (seeded by week + option) so runs are reproducible.

// (style, subject) pairs — the subject is a concrete, characterful, non-human
// creature or object with personality. Rotated deterministically by week + option.
const THEMES = [
  { style: 'kaleidoscopic fractal mandalas in electric rainbow hues', subject: 'a blooming fractal lotus with petals of living rainbow glass' },
  { style: 'swirling liquid-marble psychedelia in hot pink, electric blue and acid green', subject: 'a serpent of liquid chrome streaked with rainbow oil' },
  { style: 'melting rainbow gradients with glossy dripping liquid forms', subject: 'a playful shape-shifting creature of molten rainbow glass' },
  { style: '1960s psychedelic swirl art with pulsing paisley waves', subject: 'a strutting technicolor peacock with a fanned kaleidoscope tail' },
  { style: 'ultraviolet blacklight neon glow, trippy and vivid', subject: 'a dancing cluster of glowing neon mushrooms' },
  { style: 'day-glo tropical jungle psychedelia, hyper-saturated', subject: 'a giant day-glo orchid with curling luminous tendrils' },
  { style: 'holographic oil-slick iridescence with prismatic flares', subject: 'a crystal butterfly with kaleidoscope stained-glass wings' },
  { style: 'cosmic tie-dye nebula bursting with saturated color', subject: 'a cosmic koi fish swimming through swirls of stardust' },
  { style: 'vibrating op-art waves in clashing complementary colors', subject: 'a pulsing electric jellyfish with trailing neon tentacles' },
  { style: 'acid-bright chrome pop surrealism', subject: 'a mischievous mirrored octopus dripping rainbow paint' },
];

// In-frame travel direction per option (frame edges only — never placement).
const TRAVELS = [
  { dir: 'rtl', start: 'right', end: 'left', verb: 'glides' },
  { dir: 'ltr', start: 'left', end: 'right', verb: 'travels' },
  { dir: 'rtl', start: 'right', end: 'left', verb: 'drifts' },
];

// 3-act journeys for the connected wide master. Each act plays out in one
// third of the frame — which is exactly one screen of the triptych — so the
// subject performs on the first screen, does something unique in the middle,
// and lands on the far screen. Rotated by week + option so no two runs feel
// the same. Templates take (subject, travel) and must keep the subject inside
// the frame with continuous motion (a stalled subject reads as a frozen loop).
const CHOREOGRAPHIES = [
  (s, tr) =>
    `${s} swoops through a full loop-the-loop in the ${tr.start} third of the frame, ` +
    `corkscrews through the middle third trailing spirals of glowing color, ` +
    `then dives smoothly to rest at the ${tr.end} edge of the frame in the final frame`,
  (s, tr) =>
    `${s} bursts into a cloud of glowing particles in the ${tr.start} third of the frame, ` +
    `the particles swirl and dance through the middle third in playful eddies, ` +
    `then reassemble back into ${s} arriving at the ${tr.end} edge of the frame in the final frame`,
  (s, tr) =>
    `${s} rides deep rolling wave-arcs from the ${tr.start} third of the frame, dipping low and soaring high, ` +
    `crests dramatically at the center of the frame with a radiant flare of light, ` +
    `then swoops down to settle at the ${tr.end} edge of the frame in the final frame`,
  (s, tr) =>
    `${s} pirouettes in place in the ${tr.start} third of the frame shedding sparks of color, ` +
    `then orbits twice around a blooming burst of radiant light in the middle third, ` +
    `and spirals outward to land at the ${tr.end} edge of the frame in the final frame`,
  (s, tr) =>
    `${s} zigzags playfully through the ${tr.start} third of the frame, ricocheting between the top and bottom of the frame, ` +
    `pulses brightly with rippling rings of color at the center of the frame, ` +
    `then streaks in a smooth arc to the ${tr.end} edge of the frame in the final frame`,
  (s, tr) =>
    `${s} splits into three glowing echoes of itself in the ${tr.start} third of the frame, ` +
    `the echoes chase and weave around each other through the middle third, ` +
    `then merge back into one at the ${tr.end} edge of the frame in the final frame`,
  (s, tr) =>
    `${s} barrel-rolls through the ${tr.start} third of the frame streaming ribbons of light, ` +
    `carves a giant glowing figure-eight across the middle third, ` +
    `then sweeps gracefully to the ${tr.end} edge of the frame in the final frame`,
  (s, tr) =>
    `${s} spirals upward through the ${tr.start} third of the frame, ` +
    `blossoms into radiating fractal patterns of color at the center of the frame before re-forming, ` +
    `then drifts down to rest at the ${tr.end} edge of the frame in the final frame`,
];

// Dynamic motion for the standalone surfaces — same idea, single frame.
const SOLO_MOTIONS = [
  (s) => `${s} surges toward the viewer with streaming trails of light, growing steadily larger with confident energy`,
  (s) => `${s} spirals slowly toward the viewer while radiating pulsing rings of saturated color`,
  (s) => `${s} blooms open dramatically, unfurling layer after layer of glowing detail toward the viewer`,
  (s) => `${s} rotates majestically while waves of color ripple outward from its core in a hypnotic rhythm`,
  (s) => `${s} dances in place with fluid, playful energy, shedding swirling sparks of neon color`,
  (s) => `${s} pulses like a heartbeat, each pulse sending kaleidoscopic patterns rippling across the frame`,
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

/** The 3-act journey for one connected option. Pure; exported for tests. */
export function choreographyFor({ specKey, option, weekOf }) {
  return CHOREOGRAPHIES[hash(`choreo:${weekOf || 'week'}:${specKey}:${option}`) % CHOREOGRAPHIES.length];
}

/** The solo motion for one standalone option. Pure; exported for tests. */
export function soloMotionFor({ specKey, option, weekOf }) {
  return SOLO_MOTIONS[hash(`solo:${weekOf || 'week'}:${specKey}:${option}`) % SOLO_MOTIONS.length];
}

// Poster-readability + safety clauses appended to every still prompt.
const CONTRAST =
  'High-contrast lighting: a bright, saturated hero subject against a deep, dark background, ' +
  'strong tonal separation readable from far away in direct sunlight; never an all-white or all-black scene.';
const SAFE =
  'Ultra high detail. No people, no faces, no human figures, no human silhouettes, no mannequins, ' +
  'no statues of people, no hands, no text, no logos, no watermarks.';
// Energy clause for standalone stills — the subject should feel alive even as
// a still frame. (Kept off the connected master, whose environment must stay
// clean and uniform for the travel illusion.)
const ENERGY =
  'The subject is caught mid-motion, bursting with life — swirling trails of light, radiating ' +
  'kaleidoscopic patterns and explosive blooms of saturated color surround it.';

/**
 * The still (first-frame) prompt for one option — art + composition only.
 * @param {{ style, specKey, option, weekOf }} job
 */
export function buildStillPrompt({ style, specKey, option, weekOf }) {
  const t = themeFor({ specKey, option, weekOf });
  if (style === 'eon_connected') {
    const tr = travelFor(option);
    return `An ultra-wide continuous panoramic scene. Style: ${t.style}. ` +
      `The single hero subject is ${t.subject}, caught mid-motion and trailing ribbons of glowing light, ` +
      `positioned at the ${tr.start} edge, occupying about one third ` +
      `of the frame width and at least 60% of the frame height, with a continuous seamless environment extending ` +
      `across the full width for it to travel through; uniform lighting and background texture edge to edge; ` +
      `no secondary focal objects; keep the subject clear of the vertical lines at one-third and two-thirds of the frame width. ` +
      `${CONTRAST} ${SAFE}`;
  }
  if (style === 'frame_break') {
    return `An ultra-wide cinematic scene. Style: ${t.style}. ` +
      `The single hero subject is ${t.subject}, centered, with generous open margins on both sides and ` +
      `the entire subject contained in the central horizontal band of the frame (the top and bottom edges are ` +
      `expendable background texture). ${ENERGY} Cinematic depth and dramatic lighting. ${CONTRAST} ${SAFE}`;
  }
  // eon_single: tall portrait composition.
  return `A tall vertical scene. Style: ${t.style}. ` +
    `The single hero subject is ${t.subject}, filling most of the frame height with a strong central focal point ` +
    `and bold silhouette. ${ENERGY} ${CONTRAST} ${SAFE}`;
}

/**
 * The motion prompt for one option — how the art moves within the frame.
 * @param {{ style, specKey, option, weekOf }} job
 */
export function buildMotionPrompt({ style, specKey, option, weekOf }) {
  const t = themeFor({ specKey, option, weekOf });
  const CONSTANCY =
    'Locked static camera; no zoom, no pan. ' +
    'Colors, saturation and lighting remain exactly constant for the entire duration; no fading, no color drift.';
  if (style === 'eon_connected') {
    const tr = travelFor(option);
    const acts = choreographyFor({ specKey, option, weekOf })(t.subject, tr);
    return `Dynamic continuous choreography: ${acts}. ` +
      `The journey starts in the ${tr.start} third of the frame in the very first frame and finishes at the ` +
      `${tr.end} edge of the frame only in the final frame; the subject stays inside the frame and keeps ` +
      `fluid, continuous motion the whole time — it never stops or hovers in place. ` +
      `The background environment stays calm and steady so the subject is the only focus. ${CONSTANCY}`;
  }
  const solo = soloMotionFor({ specKey, option, weekOf })(t.subject);
  if (style === 'frame_break') {
    return `Bold cinematic motion: ${solo}. Smooth, premium, high-energy movement — never jittery. ${CONSTANCY}`;
  }
  return `Vivid ambient motion: ${solo}. Smooth and hypnotic, never chaotic or jittery. ${CONSTANCY}`;
}

export { THEMES, CHOREOGRAPHIES, SOLO_MOTIONS };
export default { buildStillPrompt, buildMotionPrompt, travelFor, themeFor, choreographyFor, soloMotionFor, THEMES };
