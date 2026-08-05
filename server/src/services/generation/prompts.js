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
// - WRAP FOLDS (Shawn, 2026-07-25, hardened 2026-07-31): every EON pod has a
//   narrow LED spine down its left side, cut from the same master as its face
//   (see eonSlicer.js), so parts of the frame bend 90 degrees away from the
//   viewer. Two art rules: the scene must stay seamless through the fold
//   positions, and the subject's finest detail must stay out of them (detail
//   landing on a fold is lost around the corner). Described strictly as AREAS —
//   never as bands/lines/stripes (Seedance painted literal white lines at the
//   named positions) and never as spines/hardware.
// Pure + deterministic (seeded by week + option) so runs are reproducible.

// Where the wrap folds fall, as plain-language frame positions: the far-left
// edge and just past the one-third and two-thirds marks (a pod slab is exactly
// one third of the connected master, and its spine leads the slab). A single
// pod is one slab, so its fold zone is the left fifth.
//
// CRITICAL VOCABULARY RULE (learned the hard way, 2026-07-31): describe these
// as AREAS to keep clear, never as "bands", "lines" or "stripes". The first
// version said "narrow vertical bands at the one-third and two-thirds lines" —
// and Seedance PAINTED white vertical lines at exactly those positions in the
// finished pillar videos. Models literalize drawable nouns; areas are spatial,
// not drawable.
const WRAP_BANDS_CONNECTED =
  'The scene is one unbroken continuous environment across its entire width, perfectly seamless everywhere. ' +
  'Keep the hero subject\'s head and finest detail away from the far left edge of the frame and away from ' +
  'the areas just right of one-third and two-thirds of the frame width; background color and texture flow ' +
  'evenly through those areas.';
const WRAP_BAND_SINGLE =
  'The scene is one unbroken continuous environment across its entire width, perfectly seamless everywhere. ' +
  'Keep the hero subject\'s head and finest detail out of the left fifth of the frame; background color and ' +
  'texture flow evenly through it.';

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

// ===========================================================================
// SPECTACULAR v2 (Scott's notes, 2026-08-05): ensemble casts, two-act scene
// arcs, distinct style families. The spectacular is a 30s piece built from two
// chained 15s segments — act 1 and act 2 — with a generated CLOSING still that
// the reviewer sees as a storyboard ("opens with / ends with") and Seedance
// receives as end_image_url, so the clip provably lands on the approved frame.
// ===========================================================================

// Style families × matching ensemble casts. Every family is hyper-colorful and
// built for constant motion; every cast member is a NAMED non-human creature
// (vague subjects collapse to humanoids, which Seedance moderation refuses).
// The 3 weekly options are guaranteed DIFFERENT families — see familyFor().
const SPECTACULAR_FAMILIES = [
  {
    key: 'liquid_chrome',
    style: 'liquid-chrome psychedelia — molten mirror surfaces streaked with hot pink, electric blue and acid green',
    cast: ['a serpent of liquid chrome', 'a mirrored octopus dripping rainbow paint', 'a molten-mercury hummingbird'],
  },
  {
    key: 'neon_botanical',
    style: 'neon botanical jungle — day-glo flora, luminous vines and hyper-saturated tropical light',
    cast: ['a giant day-glo orchid with curling luminous tendrils', 'an electric-green vine serpent', 'a neon hummingbird moth'],
  },
  {
    key: 'cosmic_candy',
    style: 'cosmic candy — glossy sugar-glass surfaces, swirling nebula taffy and hyper-sweet saturated color',
    cast: ['a candy-glass koi fish', 'a taffy-winged phoenix', 'a gummy comet whale trailing sparkling sugar dust'],
  },
  {
    key: 'stained_glass',
    style: 'stained-glass kaleidoscope — jewel-toned translucent facets refracting brilliant light',
    cast: ['a crystal butterfly with kaleidoscope stained-glass wings', 'a stained-glass phoenix', 'a prism-shelled beetle'],
  },
  {
    key: 'wet_paint',
    style: 'wet-paint pop surrealism — thick glossy paint in collision, splashing and swirling in saturated color',
    cast: ['a paint-splash cheetah', 'a dripping-rainbow cobra', 'an ink-burst falcon'],
  },
  {
    key: 'deep_sea',
    style: 'iridescent deep-sea bioluminescence — electric glowing life against rich abyssal color',
    cast: ['a pulsing electric jellyfish with trailing neon tentacles', 'an iridescent manta ray', 'a bioluminescent anglerfish'],
  },
  {
    key: 'ultraviolet',
    style: 'ultraviolet blacklight neon — trippy UV glow, vivid and electric',
    cast: ['a dancing cluster of glowing neon mushrooms', 'an ultraviolet chameleon', 'a neon-striped gecko'],
  },
  {
    key: 'cosmic_tiedye',
    style: 'cosmic tie-dye nebula — swirling stardust bursting with saturated color',
    cast: ['a cosmic koi fish swimming through swirls of stardust', 'a nebula fox with a comet tail', 'a stardust dragon serpent'],
  },
];

// Two-act scene arcs. Each template takes the joined cast string and returns
// act 1 (segment A motion), act 2 (segment B motion — the scene TRANSFORMS),
// and the finale (the closing still's scene — segment B's end_image target).
// Every act keeps multiple characters moving at once and takes turns punching
// through the frame; the finale reads as a settled, poster-worthy composition.
const SPECTACULAR_ARCS = [
  (cast) => ({
    act1: `The scene erupts to life: ${cast} chase each other in sweeping interlocking loops, diving deep into the distance and lunging forward through the opening, each taking a turn bursting over the black frame while the environment churns with streaming color trails`,
    act2: `The environment transforms around them — the deep space blooms into a completely new landscape of the same vivid palette; the characters regroup and spiral together into one grand formation, weaving between foreground and deep background as the new scenery surges with kinetic light`,
    finale: 'the full cast gathered in one dramatic settled formation, the largest character front and center bursting through the opening over the black frame, the others arranged at staggered depths behind it in the transformed scenery',
  }),
  (cast) => ({
    act1: `A playful high-speed pursuit: ${cast} ricochet between the deep interior and the near foreground, colliding into bursts of color, one after another punching out through the opening and over the frame while the scene ripples in their wake`,
    // "celebration" pulled CROWDS of neon human runners into the walls, and
    // "frozen" pulled stone statues + a museum room (live QA, 2026-08-05).
    // Keep this arc's beats described purely as the cast + light.
    act2: `The chase erupts into a blaze of shared light — the environment fractures and reforms into a brighter, denser dreamscape; the characters swirl in a shared vortex, trading places between front and back, throwing cascades of light against the transformed scenery`,
    finale: 'the full cast caught mid-leap in the reformed dreamscape, two characters bursting through the opening over the black frame from opposite sides, the rest fanned out at depth between them',
  }),
  (cast) => ({
    act1: `The scene breathes like one organism: ${cast} orbit a blazing center of light, plunging toward the viewer and back into the depths in rolling waves, each pass sending one of them through the opening and across the black frame`,
    act2: `The center of light blossoms and swallows the scene — an entirely new environment unfurls from it in the same palette; the characters ride the expanding wave outward and regroup in the fresh scenery, weaving figure-eights between depth layers as everything pulses with light`,
    finale: 'the full cast arranged in a sweeping arc around the blossomed center of light in the new environment, the nearest character surging through the opening over the black frame, the scene at maximum brilliance',
  }),
  (cast) => ({
    act1: `Duelling energies: ${cast} split the space and spar in flamboyant bursts, whipping the environment into spirals, lunging past each other through the opening and over the frame in alternating waves`,
    act2: `The duel resolves into harmony — the churning environment recomposes into a majestic new vista of the same colors; the characters merge their trails into one braided stream of light that sweeps through the deep space and out over the frame`,
    finale: 'the full cast aligned along one braided stream of light flowing from deep in the vista out through the opening and across the black frame, every character distinct and glowing',
  }),
];

/** Join a cast into prose: "a, b and c". Pure. */
const joinCast = (cast) => `${cast.slice(0, -1).join(', ')} and ${cast.at(-1)}`;

/**
 * The style family for one spectacular option. Consecutive options are
 * GUARANTEED different families: the week picks a base index, the option
 * strides from it. Pure; exported for the UI/tests.
 */
export function familyFor({ specKey, option, weekOf }) {
  const base = hash(`fam:${weekOf || 'week'}:${specKey}`);
  return SPECTACULAR_FAMILIES[(base + (option - 1)) % SPECTACULAR_FAMILIES.length];
}

/** The two-act arc for one spectacular option. Pure; exported for tests. */
export function arcFor({ specKey, option, weekOf }) {
  const f = familyFor({ specKey, option, weekOf });
  const arc = SPECTACULAR_ARCS[hash(`arc:${weekOf || 'week'}:${specKey}:${option}`) % SPECTACULAR_ARCS.length];
  return arc(joinCast(f.cast));
}

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

// The VERIFIED spectacular frame geometry (3 live Seedream tests, 2026-08-04).
// The picture's border IS the frame, flush on all four sides, interior niche
// walls in one-point perspective, never depicted as an object in a room.
// Byte-stable: opening AND closing stills share these so the two storyboard
// frames agree on geometry. Do not reword without a live re-test.
const FRAME_GEOMETRY =
  `Composition: the picture's border IS a thick matte-black frame — flat matte-black strips run along ` +
  `the top edge, bottom edge, left edge and right edge of the picture, meeting at the four corners, ` +
  `flush with the picture's edges on all sides. Just inside those black strips the frame's interior ` +
  `walls recede inward in one-point perspective — a ceiling, a floor and two side walls, like looking ` +
  `straight into a deep recessed niche — and through the opening the scene recedes into deep vivid ` +
  `distance. The frame is never shown as an object: no outside of it, no top or sides of any box, no ` +
  `ground it sits on, no room around it, no tilt or angle — the viewpoint is exactly perpendicular, ` +
  `centered, and cropped precisely at the frame's outer edge.`;
const FRAME_CONTAINMENT =
  `Every element stays well inside the picture's borders: nothing but the black frame itself ever ` +
  `touches the picture's edge, and nothing is cropped by the picture's boundary — every character ` +
  `and every trail stays fully contained within the frame's outer edge, one solid contained 3D space.`;
// Ensemble variant of ENERGY: the whole cast alive at layered depths.
const CAST_ENERGY =
  'Every character is caught mid-motion and bursting with kinetic energy — trails of light streak ' +
  'behind them, kaleidoscopic shockwaves radiate outward, explosive blooms of saturated color ' +
  'detonate across the scene, with layered depth placing the characters at clearly different distances.';
// Cast WHITELIST, stated early where it carries weight. The trailing SAFE
// blacklist alone was not enough: the first live 30s validation rendered
// gallery-visitor silhouettes in the opening frame and a stage full of human
// statues and a central man in the closing frame (2026-08-05). An explicit
// "only these" beats a distant "none of those" — and the whitelist must stay
// NOUN-FREE on the banned side: listing "statues, sculptures, carved figures"
// here literalized into an avenue of statues (the "bands" lesson again).
// ("figures" is itself a humanoid-shaped drawable noun — v4 drew neon runner
// outlines along the walls while the whitelist said "the ONLY figures".)
const ONLY_CAST = (cast) =>
  `These are the ONLY living things anywhere in the scene: ${cast}. ` +
  `Nothing else appears — every other shape in the scene is pure scenery: plants, flowers, light and color.`;

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
      `keep the subject clear of the areas at one-third and two-thirds of the frame width. ` +
      `${WRAP_BANDS_CONNECTED} ${CONTRAST} ${SAFE}`;
  }
  if (style === 'frame_break') {
    // The WOW signature 3D pop-out — ensemble edition (Scott, 2026-08-05).
    // The black frame is PAINTED INTO the scene (trompe-l'oeil); characters
    // physically break through it. Never rely on a post-composited letterbox —
    // that clips the art BEHIND the frame so nothing can ever pop out
    // (Shawn, 2026-07-15 + 2026-07-21). Geometry formula verified live
    // 2026-08-04 — see FRAME_GEOMETRY / FRAME_CONTAINMENT; never regress to
    // "inset border" or "shadow box as an object" wording (both failed live).
    const f = familyFor({ specKey, option, weekOf });
    const cast = joinCast(f.cast);
    return `An ultra-wide trompe-l'oeil deep-relief composition in perfectly frontal, dead-centered, ` +
      `symmetrical one-point perspective. Style: ${f.style}. ` +
      `${FRAME_GEOMETRY} ` +
      `The scene is home to an ensemble of characters: ${cast}. ${ONLY_CAST(cast)} They are placed at clearly ` +
      `different depths — some deep in the distance, some mid-ground, and at least one bursting forward through the ` +
      `opening toward the viewer: its body and trailing light cross the frame's inner edge and overlap the ` +
      `frame's black front strips — rendered IN FRONT of them, partially covering them, casting soft shadows ` +
      `onto them — unmistakably closer to the viewer than the frame plane. Every character is distinct, ` +
      `mid-motion and interacting with the others. ${FRAME_CONTAINMENT} ` +
      `${CAST_ENERGY} ${CONTRAST} ${SAFE}`;
  }
  // eon_single: tall portrait composition, composed to wrap (the left band is
  // cut away onto the pod's spine — see WRAP_BAND_SINGLE).
  return `A tall vertical scene. Style: ${t.style}. ` +
    `The single hero subject is ${t.subject}, filling most of the frame height with a strong central focal point ` +
    `and bold silhouette, centred in the right four-fifths of the frame. ` +
    `${WRAP_BAND_SINGLE} ${ENERGY} ${CONTRAST} ${SAFE}`;
}

/**
 * The CLOSING still for a storyboard surface (spectacular only): the exact
 * frame the 30s piece must END on. Same geometry, same family, same cast as
 * the opening still — the scene is the arc's finale. Shown to the reviewer as
 * the second storyboard panel and handed to Seedance segment B as
 * end_image_url, so approval of this image is approval of the ending.
 * @param {{ style, specKey, option, weekOf }} job
 */
export function buildClosingStillPrompt({ style, specKey, option, weekOf }) {
  if (style !== 'frame_break') return null; // storyboard is a spectacular-only feature
  const f = familyFor({ specKey, option, weekOf });
  const cast = joinCast(f.cast);
  const arc = arcFor({ specKey, option, weekOf });
  return `An ultra-wide trompe-l'oeil deep-relief composition in perfectly frontal, dead-centered, ` +
    `symmetrical one-point perspective. Style: ${f.style}. ` +
    `${FRAME_GEOMETRY} ` +
    `The scene is home to an ensemble of characters: ${cast}. ${ONLY_CAST(cast)} ` +
    // "grand finale"/"closing pose of a performance" wording literalized into a
    // STAGE SHOW — human statues and a central performer (live QA, 2026-08-05);
    // "final scene" then drew a framed screen INSIDE the picture, and BANNING
    // "a screen, a framed rectangle" drew an empty framed rectangle — models
    // literalize drawable nouns even inside negations (same lesson as the
    // painted "bands", 2026-07-31). So: no show words, no screen words at all;
    // instead POSITIVELY fill the back of the box so nothing invents a panel.
    `This is how the story ends: ${arc.finale}. ` +
    `Every character is distinct and glowing with energy, the composition settled and majestic. ` +
    `Glowing scenery, drifting light and rich atmospheric color fill the space continuously all the way ` +
    `to its deep far end. ` +
    `${FRAME_CONTAINMENT} ` +
    `${CAST_ENERGY} ${CONTRAST} ${SAFE}`;
}

// Negative guard for the EON motion prompts (frame_break keeps its border on
// purpose, so it does NOT get this): the pillar videos are cut at fixed x
// offsets, so any painted seam lands mid-panel and reads as a defect on the
// physical sign.
const NO_SEAMS =
  'The scene stays one seamless continuous environment for the whole clip — no borders, no frames, ' +
  'no dividing marks, no pale vertical streaks appear anywhere at any time.';

// The exact wrap sentences shipped 2026-07-25..30. Stills generated in that
// window carry them in their STORED motion_prompt, and re-animating replays the
// stored prompt — so the orchestrator strips these at animate time
// (sanitizeMotionPrompt below). Keep byte-identical to what the builders
// emitted; do not reword.
const LEGACY_BAND_SENTENCES = [
  'Motion runs continuously through the narrow vertical bands at the left edge and just past the one-third and ' +
    'two-thirds lines — streaks of colour flow through them without pausing — but the subject never parks its head ' +
    'or finest detail inside one of those bands. ',
  'Colour and light stream continuously down the narrow vertical band at the very left edge of the frame, ' +
    'while the subject keeps its head and finest detail out of that band. ',
];

/**
 * Strip the legacy "vertical band" sentences from a stored motion prompt.
 * Seedance literalized them into painted white lines at the named positions
 * (Scott's pillar videos, 2026-07-31). Pure; a no-op on current prompts.
 */
export function sanitizeMotionPrompt(prompt) {
  if (!prompt) return prompt;
  let out = prompt;
  for (const sentence of LEGACY_BAND_SENTENCES) out = out.split(sentence).join('');
  return out;
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
      `every pixel of the composition is active. The entire scene is kinetic and alive, never static or passive. ` +
      `${NO_SEAMS} ${CONSTANCY}`;
  }
  if (style === 'frame_break') {
    return buildSpectacularAct({ specKey, option, weekOf, act: 1 });
  }
  const solo = soloMotionFor({ specKey, option, weekOf })(t.subject);
  return `Vivid ambient motion: ${solo}. ` +
    `${NO_SEAMS} Smooth and hypnotic, never chaotic or jittery. ${CONSTANCY}`;
}

// Spectacular color rule: scenes TRANSFORM on purpose (Scott: "scenes
// constantly changing"), so the EON "colors remain exactly constant" wording
// would fight the arc. What must not happen is DRIFT — Seedance's slow
// desaturation — so saturation is pinned while deliberate change stays free.
const CONSTANCY_SPEC =
  'Locked static camera; no zoom, no pan. ' +
  'Saturation stays rich and maxed for the entire duration — colors may transform as the scene changes, ' +
  'but they never fade, wash out, or drift toward grey.';

// The frame rule for both spectacular acts: fixed, flush, inviolable.
const FRAME_MOTION_RULE =
  `The matte-black frame running along all four outer edges of the image stays perfectly fixed for the whole clip — ` +
  `it never moves, bends, shrinks, detaches from the edges or fades, and nothing ever appears outside it: ` +
  `the frame's outer edge remains the absolute boundary of the piece at all times. ` +
  `Characters crossing the frame visibly occlude it, casting moving shadows onto it, yet always stop ` +
  `short of the image's outer edge — every character, trail and effect stays fully inside the image bounds, ` +
  `never touched or cropped by the outer boundary.`;

/**
 * One act of the spectacular's two-act motion (act 1 = segment A off the
 * opening still; act 2 = segment B, chained from A's last frame and landing on
 * the closing still via end_image_url). Pure; exported for the orchestrator.
 * @param {{ specKey, option, weekOf, act: 1|2 }} job
 */
export function buildSpectacularAct({ specKey, option, weekOf, act }) {
  const arc = arcFor({ specKey, option, weekOf });
  const body = act === 2 ? arc.act2 : arc.act1;
  const landing = act === 2
    ? `In the final moments every character eases into its place in one grand settled formation — ` +
      `the composition resolves into a majestic final scene and holds it as the clip ends. `
    : '';
  return `Trompe-l'oeil 3D pop-out motion, act ${act} of 2: ${body}. ` +
    `${FRAME_MOTION_RULE} ` +
    `Multiple characters are in motion at every moment — none of them ever freezes or hovers; the whole ` +
    `environment moves with them, swirling, flowing and evolving continuously; every pixel is alive. ` +
    `${landing}` +
    `Smooth, premium, explosive high-energy movement — never static, never jittery. ${CONSTANCY_SPEC}`;
}

export { THEMES, CHOREOGRAPHIES, SOLO_MOTIONS, SPECTACULAR_FAMILIES, SPECTACULAR_ARCS };
export default {
  buildStillPrompt, buildClosingStillPrompt, buildMotionPrompt, buildSpectacularAct, sanitizeMotionPrompt,
  travelFor, themeFor, choreographyFor, soloMotionFor, familyFor, arcFor, THEMES, SPECTACULAR_FAMILIES,
};
