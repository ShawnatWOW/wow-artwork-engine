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
    `Scene is in perpetual motion: the entire background swirls and morphs continuously; ${s} performs a violent vertical loop-the-loop in the ${tr.start} third diving and soaring while the scene around it churns with streaming color trails, then barrel-rolls through the middle third with the environment rippling in sync, finally explodes toward viewer landing at the ${tr.end} edge as the entire frame crackles with kinetic energy`,
  (s, tr) =>
    `Background is alive and turbulent: shapes pulse and undulate across the full frame; ${s} fractures into spinning particles from the ${tr.start} third as the scene around it fragments, particles and environment swirl chaotically through the middle third in aggressive eddies, then snap back together merging with the dynamic background as ${s} rockets to the ${tr.end} edge in a wave of cascading color`,
  (s, tr) =>
    `Entire scene undulates with hypnotic motion: the background flows like living liquid; ${s} rides towering rolling wave-arcs from the ${tr.start} third plunging and launching upward while the environment crests and dips in perfect sync, reaches the center of the frame as lighting blazes and shockwaves ripple outward across the entire composition, then plummets to the ${tr.end} edge with tremendous force as the scene explodes with light`,
  (s, tr) =>
    `Background rotates and orbits continuously: the scene is one unified vortex of motion; ${s} spins violently in the ${tr.start} third shedding explosive bursts as the surrounding environment whips and spirals, then enters a chaotic orbit around the center of the frame with the entire scene rotating faster, finally spirals outward to the ${tr.end} edge as the whole composition culminates in a crescendo of movement`,
  (s, tr) =>
    `Everything ricochets and bounces: the background is filled with kinetic particles and light in constant collision; ${s} zigzags with frenetic energy from the ${tr.start} third bouncing between top and bottom while the entire frame vibrates with resonant light waves, reaches the center of the frame and detonates with the whole scene exploding outward, then rockets to the ${tr.end} edge through a maelstrom of motion`,
  (s, tr) =>
    `Scene pulses with unified rhythm: the entire background and subject are one organism; ${s} shatters into glowing echoes in the ${tr.start} third as the background fragments in sync, echoes and environment chase and rebound through the middle third in dizzying spirals, then merge back at the center of the frame with the whole composition snapping together and accelerating as a unified force to the ${tr.end} edge`,
  (s, tr) =>
    `Background swirls in aggressive figure-eights: the entire space is defined by continuous motion; ${s} hurls itself through the ${tr.start} third in a violent barrel-roll leaving trails as the background streams and twists around it, carves a massive figure-eight across the center of the frame with the entire scene rotating through the motion, momentum builds with each loop as the environment crescendos, then explodes forward in an arc to the ${tr.end} edge through waves of kinetic color`,
  (s, tr) =>
    `Entire scene detonates and reforms: the background fractalizes and blooms explosively; ${s} erupts upward from the ${tr.start} third with explosive force spiraling and surging as the scene around it explodes outward in fractals, blossoms into massive radiating patterns at the center of the frame with the entire composition expanding with kinetic light, then collapses and rockets backward with the environment imploding inward before streaking to the ${tr.end} edge as one unified detonation`,
];

// Dynamic motion for standalone surfaces — entire SCENE in constant motion, not just the subject.
// Seedance responds to scene-wide activity descriptions better than subject-only prompts.
const SOLO_MOTIONS = [
  (s) => `Intense scene: the entire background is rippling and swirling with dynamic color shifts; ${s} surges directly toward the viewer growing massive, while the scene around it churns with streaming light trails and vibrant motion across every pixel of the frame`,
  (s) => `Hyperactive scene: kaleidoscopic patterns pulse and rotate continuously across the entire background; ${s} spirals chaotically through the center at high speed while the surrounding environment explodes with color bursts and kinetic light effects`,
  (s) => `Explosive scene: the full background is alive with blooming fractals and radiating waves of color; ${s} unfolds dramatically in layers while the entire frame crackles with electric movement and cascading light`,
  (s) => `Turbulent scene: swirling vortexes of color consume the full frame in constant motion; ${s} spins with violent rotational energy at the center while waves of light ripple outward to the edges, engulfing the entire composition`,
  (s) => `Frenetic scene: the entire frame is a non-stop whirlwind of motion with particles and light ricocheting between all edges; ${s} launches wildly through the chaos, colliding with and bouncing through the kinetic environment`,
  (s) => `Detonating scene: the background itself pulses like a massive beating heart with waves of color exploding outward; ${s} expands and contracts in sync, sending shockwaves of kaleidoscopic light rippling across the entire width and height of the frame`,
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
    return `An ultra-wide cinematic scene with strong 3D depth planes. Style: ${t.style}. ` +
      `Composition: a dark vignette frame around the edges (naturally framing the scene), with ${t.subject} centered in the bright focal area. ` +
      `The subject sits in the middle plane with a rich, detailed background behind it receding into deep distance, and a foreground layer in front suggested by lighting and shadow. ` +
      `The subject is large enough to break partially out of the bright central frame into the darker edge area, creating a natural 3D depth effect. ` +
      `${ENERGY} Dramatic cinematic lighting creates clear foreground-to-background separation and casts strong shadows suggesting multiple planes. ${CONTRAST} ${SAFE}`;
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
    return `Choreographed whole-scene motion: ${acts}. ` +
      `The journey starts in the ${tr.start} third of the frame in the very first frame and finishes at the ` +
      `${tr.end} edge of the frame only in the final frame; the subject stays inside the frame and keeps ` +
      `fluid, continuous motion the whole time — it never stops or hovers in place. ` +
      `Critically: the entire background is in constant motion at all times — not calm or steady. ` +
      `The background environment swirls, ripples, flows, shifts, and evolves continuously in sync with the subject's journey; ` +
      `every pixel of the composition is active. The entire scene is kinetic and alive, never static or passive. ${CONSTANCY}`;
  }
  const solo = soloMotionFor({ specKey, option, weekOf })(t.subject);
  if (style === 'frame_break') {
    return `Cinematic scene-wide motion with extreme 3D depth: ${solo}. ` +
      `The entire composition is in perpetual motion — the background environment shifts, flows, and evolves continuously; ` +
      `foreground elements ripple and shimmer; lighting pulses and moves across the scene; the subject moves through three spatial planes ` +
      `(foreground, middle subject plane, deep background) creating the natural illusion of 3D depth without letterboxing. ` +
      `The subject darts toward camera, retreats into distance, and travels diagonally across the full width. ` +
      `The dark vignette edge of the scene is natural framing, not a barrier — the subject moves naturally through all spatial zones. ` +
      `Smooth, premium, explosive high-energy movement — never static, never jittery. ${CONSTANCY}`;
  }
  return `Vivid ambient motion: ${solo}. Smooth and hypnotic, never chaotic or jittery. ${CONSTANCY}`;
}

export { THEMES, CHOREOGRAPHIES, SOLO_MOTIONS };
export default { buildStillPrompt, buildMotionPrompt, travelFor, themeFor, choreographyFor, soloMotionFor, THEMES };
