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
    `${s} explodes through a vertical loop-the-loop in the ${tr.start} third, diving down then soaring up ` +
    `while moving forward in space, leaving streaking trails of light, then ` +
    `barrel-rolls through the middle third with aggressive rotational energy, growing and shrinking with depth, ` +
    `finally accelerates toward the viewer and crashes landing at the ${tr.end} edge dramatically`,
  (s, tr) =>
    `${s} fractures into a violent burst of spinning particles from the ${tr.start} third, ` +
    `the fragments explode outward in all directions including toward and away from the camera through the middle third, ` +
    `ricocheting and swirling in aggressive eddies, then snap back together with kinetic force ` +
    `to arrive as a unified whole rocketing to the ${tr.end} edge in the final frame`,
  (s, tr) =>
    `${s} rides towering rolling wave-arcs from the ${tr.start} third, plunging deep down into the frame and launching upward, ` +
    `crests spectacularly at the center of the frame growing larger as it approaches the viewer with blinding light, ` +
    `then plummets downward in a steep arc to the ${tr.end} edge with tremendous velocity in the final frame`,
  (s, tr) =>
    `${s} spins violently in place in the ${tr.start} third, shedding explosive bursts of color in all directions, ` +
    `then whips into a chaotic orbit around a blazing core of light at the center of the frame, getting closer and farther with ` +
    `dizzying speed and energy, finally spirals outward and streaks through the frame to the ${tr.end} edge`,
  (s, tr) =>
    `${s} zigzags with frenetic energy from the ${tr.start} third, bouncing between top and bottom while moving forward in space, ` +
    `expanding and contracting with violent momentum, reaches the center of the frame and detonates with rippling waves of color, ` +
    `then rockets in a blazing arc straight toward the viewer before veering to the ${tr.end} edge in the final frame`,
  (s, tr) =>
    `${s} shatters into three glowing echoes in the ${tr.start} third and chases itself chaotically through the middle, ` +
    `the echoes collide and rebound through the frame approaching and receding from the camera in a dizzying chase, ` +
    `then slam together with explosive force at the center and merge into one accelerating to the ${tr.end} edge`,
  (s, tr) =>
    `${s} hurls itself through the ${tr.start} third in a violent barrel-roll streaming ribbons of blazing light, ` +
    `carves a massive aggressive figure-eight across the center of the frame growing and shrinking as it moves through depth, ` +
    `momentum building with each loop until it explodes forward in an arc to the ${tr.end} edge in the final frame`,
  (s, tr) =>
    `${s} erupts upward from the ${tr.start} third with explosive force, spiraling faster and faster while also surging forward toward the viewer, ` +
    `blossoms into a massive fractal explosion of radiating color and movement at the center of the frame, ` +
    `then collapses and rockets backward away from the camera before streaking down to the ${tr.end} edge with tremendous energy`,
];

// Dynamic motion for the standalone surfaces — aggressive 3D depth, vertical travel, moving backgrounds.
const SOLO_MOTIONS = [
  (s) => `${s} explodes toward the viewer with violent acceleration, growing massive with streaming trails, ricocheting between top and bottom edges`,
  (s) => `${s} spirals chaotically at high speed toward the camera while rotating, growing and shrinking with aggressive depth changes, radiating explosive bursts of light`,
  (s) => `${s} detonates open dramatically unfurling layers outward in all directions at high energy, bursting toward the viewer with tremendous force`,
  (s) => `${s} spins violently at the center with massive rotational energy, waves of color exploding outward at the edges while it accelerates in 3D space`,
  (s) => `${s} launches in frantic non-stop motion across the full frame, bouncing between all edges, shooting toward and away from the camera with wild momentum`,
  (s) => `${s} pulses violently like a detonating heart, each massive pulse sending kaleidoscopic shockwaves rippling across the entire frame with explosive force`,
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
  'The subject is caught mid-explosion of motion, absolutely bursting with kinetic energy — ' +
  'violent trails of light streak across the frame, kaleidoscopic shockwaves radiate outward, ' +
  'explosive blooms of saturated color detonate around it, with layered depth suggesting ' +
  'the subject is moving through 3D space at high velocity.';

/**
 * The still (first-frame) prompt for one option — art + composition only.
 * @param {{ style, specKey, option, weekOf }} job
 */
export function buildStillPrompt({ style, specKey, option, weekOf }) {
  const t = themeFor({ specKey, option, weekOf });
  if (style === 'eon_connected') {
    const tr = travelFor(option);
    return `An ultra-wide continuous panoramic scene with dynamic motion throughout. Style: ${t.style}. ` +
      `The single hero subject is ${t.subject}, caught mid-motion and trailing ribbons of glowing light, ` +
      `positioned at the ${tr.start} edge, occupying about one third ` +
      `of the frame width and at least 60% of the frame height, with a continuous seamless environment extending ` +
      `across the full width for it to travel through. The background itself is alive with motion — ` +
      `swirling patterns, flowing textures, and dynamic layers that suggest movement and depth as the subject travels. ` +
      `Lighting shifts and evolves as the subject journeys; no secondary focal objects; ` +
      `keep the subject clear of the vertical lines at one-third and two-thirds of the frame width. ` +
      `${CONTRAST} ${SAFE}`;
  }
  if (style === 'frame_break') {
    return `An ultra-wide cinematic scene with dramatic layered depth. Style: ${t.style}. ` +
      `The single hero subject is ${t.subject}, centered, with generous open margins on both sides and ` +
      `the entire subject contained in the central horizontal band of the frame (the top and bottom edges are ` +
      `expendable background texture that extends deep into the distance). Multiple depth layers: ` +
      `the background environment is rich and dynamic, suggesting the subject can move forward and backward through the scene. ` +
      `${ENERGY} Extreme cinematic depth with dramatic lighting that creates strong shadows and highlights. ${CONTRAST} ${SAFE}`;
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
    return `Dynamic continuous choreography with aggressive background motion: ${acts}. ` +
      `The journey starts in the ${tr.start} third of the frame in the very first frame and finishes at the ` +
      `${tr.end} edge of the frame only in the final frame; the subject stays inside the frame and keeps ` +
      `fluid, continuous motion the whole time — it never stops or hovers in place. ` +
      `The background environment is also in motion — swirling, flowing, and shifting as the subject travels, ` +
      `creating a sense of speed and space. The entire scene feels alive and dynamic, not static. ${CONSTANCY}`;
  }
  const solo = soloMotionFor({ specKey, option, weekOf })(t.subject);
  if (style === 'frame_break') {
    return `Extreme cinematic motion with deep 3D perspective: ${solo}. ` +
      `The subject moves through 3D space — approaching the camera to fill the frame, ` +
      `receding away, moving vertically and diagonally across the entire width and height. ` +
      `The visible black frame border creates the illusion of depth; the subject should move through and around this frame, ` +
      `sometimes appearing to move BEHIND the frame edge (occluding), sometimes in front. ` +
      `Smooth, premium, explosive high-energy movement — never jittery. ${CONSTANCY}`;
  }
  return `Vivid ambient motion: ${solo}. Smooth and hypnotic, never chaotic or jittery. ${CONSTANCY}`;
}

export { THEMES, CHOREOGRAPHIES, SOLO_MOTIONS };
export default { buildStillPrompt, buildMotionPrompt, travelFor, themeFor, choreographyFor, soloMotionFor, THEMES };
