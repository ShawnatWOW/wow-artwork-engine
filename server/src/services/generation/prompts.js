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
// Every family casts three named non-human characters into fixed NARRATIVE
// ROLES (story overhaul 2026-08-11), so every arc beat has a clear lead:
//   keeper    — the large, rooted presence at the heart of the scene
//   hero      — the agile protagonist; owns the frame-punch payoffs
//   companion — the secondary mover; reacts, chases, mirrors
const SPECTACULAR_FAMILIES = [
  {
    key: 'liquid_chrome',
    style: 'liquid-chrome psychedelia — molten mirror surfaces streaked with hot pink, electric blue and acid green',
    cast: {
      keeper: 'a mirrored octopus dripping rainbow paint',
      hero: 'a serpent of liquid chrome',
      companion: 'a molten-mercury hummingbird',
    },
  },
  {
    key: 'neon_botanical',
    style: 'neon botanical jungle — day-glo flora, luminous vines and hyper-saturated tropical light',
    cast: {
      keeper: 'a giant day-glo orchid with curling luminous tendrils',
      hero: 'an electric-green vine serpent',
      companion: 'a neon hummingbird moth',
    },
  },
  {
    key: 'cosmic_candy',
    style: 'cosmic candy — glossy sugar-glass surfaces, swirling nebula taffy and hyper-sweet saturated color',
    cast: {
      keeper: 'a gummy comet whale trailing sparkling sugar dust',
      hero: 'a candy-glass koi fish',
      companion: 'a taffy-winged phoenix',
    },
  },
  {
    key: 'stained_glass',
    style: 'stained-glass kaleidoscope — jewel-toned translucent facets refracting brilliant light',
    cast: {
      keeper: 'a stained-glass phoenix perched with wings spread wide',
      hero: 'a crystal butterfly with kaleidoscope stained-glass wings',
      companion: 'a prism-shelled beetle',
    },
  },
  {
    key: 'wet_paint',
    style: 'wet-paint pop surrealism — thick glossy paint in collision, splashing and swirling in saturated color',
    cast: {
      keeper: 'a dripping-rainbow cobra risen in a gleaming coil',
      hero: 'a paint-splash cheetah',
      companion: 'an ink-burst falcon',
    },
  },
  {
    key: 'deep_sea',
    style: 'iridescent deep-sea bioluminescence — electric glowing life against rich abyssal color',
    cast: {
      keeper: 'a pulsing electric jellyfish with trailing neon tentacles',
      hero: 'an iridescent manta ray',
      companion: 'a bioluminescent anglerfish',
    },
  },
  {
    key: 'ultraviolet',
    style: 'ultraviolet blacklight neon — trippy UV glow, vivid and electric',
    cast: {
      keeper: 'a dancing cluster of glowing neon mushrooms',
      hero: 'an ultraviolet chameleon',
      companion: 'a neon-striped gecko',
    },
  },
  {
    key: 'cosmic_tiedye',
    style: 'cosmic tie-dye nebula — swirling stardust bursting with saturated color',
    cast: {
      keeper: 'a stardust dragon serpent wound through the deep distance',
      hero: 'a cosmic koi fish',
      companion: 'a nebula fox with a comet tail',
    },
  },
];

/** The cast as a list (keeper, hero, companion). Pure; exported for tests/UI. */
export const castList = (family) => [family.cast.keeper, family.cast.hero, family.cast.companion];

// ===========================================================================
// WILD THEMES (Shawn, 2026-08-18): one slot per screen goes fully off-book —
// a randomized era/world theme (cyberpunk, the twenties, …) instead of the
// house psychedelic families. Always DIGITAL ART grounded in that theme,
// with characters and scenery that belong to it. The wild slots:
//   spectacular option 3  ·  EON-connected option 2
// The pick is seeded by the batch (promptSeed salts with the run id), so
// every "New batch" rolls a fresh theme, yet each run stays reproducible.
// The chosen theme's LABEL is stored on the artwork row (theme_label) so the
// dashboard can say which design is the wild one and what it rolled.
// Vocabulary laws still apply: no meta-art nouns (poster/canvas/…), no
// placement terms, no drawable seam nouns — same lessons as everywhere else.
// ===========================================================================
const WILD_THEMES = [
  {
    key: 'cyberpunk',
    label: 'Cyberpunk',
    style: 'cyberpunk digital art — a rain-slicked neon megacity of holographic light, chrome towers and electric color',
    cast: {
      keeper: 'a colossal chrome mech-dragon coiled around a glowing skyscraper spire',
      hero: 'a neon-visored courier racing a light-trailing hoverbike',
      companion: 'a holographic cat with glitching pixel fur',
    },
  },
  {
    key: 'twenties',
    label: 'Roaring Twenties',
    style: '1920s jazz-age art-deco digital art — gleaming gold geometry, champagne sparkle and velvet-black elegance',
    cast: {
      keeper: 'a grand gilded gramophone pouring out ribbons of musical light',
      hero: 'a swing-dancing flapper in a beaded gold dress',
      companion: 'a top-hatted jazz cat with a shining saxophone',
    },
  },
  {
    key: 'steampunk',
    label: 'Steampunk',
    style: 'steampunk digital art — brass gears, copper pipes, drifting steam and warm amber glow',
    cast: {
      keeper: 'a towering brass clockwork elephant venting gentle steam',
      hero: 'a goggled sky-pirate riding a whirring copper glider',
      companion: 'a wind-up mechanical hummingbird with ticking gears',
    },
  },
  {
    key: 'synthwave',
    label: 'Synthwave',
    style: 'retro synthwave digital art — a chrome sunset horizon of hot pink, purple and electric blue',
    cast: {
      keeper: 'a giant chrome sun setting between mirrored mountains',
      hero: 'a scarlet turbo roadster streaking neon light',
      companion: 'a chrome falcon with glowing magenta wings',
    },
  },
  {
    key: 'wild_west',
    label: 'Wild West',
    style: 'wild-west digital art — golden desert light, red canyons and dusty cinematic haze',
    cast: {
      keeper: 'a mighty saguaro cactus crowned with blooming desert flowers',
      hero: 'a poncho-clad gunslinger on a galloping black stallion',
      companion: 'a swooping red-tailed hawk',
    },
  },
  {
    key: 'feudal_japan',
    label: 'Feudal Japan',
    style: 'feudal-Japan ukiyo-e digital art — ink-brushed mountains, cherry blossoms and lantern-lit dusk',
    cast: {
      keeper: 'an ancient cherry tree raining glowing pink petals',
      hero: 'an armored samurai with a gleaming katana',
      companion: 'a nine-tailed spirit fox trailing white fire',
    },
  },
  {
    key: 'ancient_egypt',
    label: 'Ancient Egypt',
    style: 'ancient-Egypt digital art — golden sandstone, lapis blue, torchlight and drifting sand',
    cast: {
      keeper: 'a colossal golden sphinx with glowing sapphire eyes',
      hero: 'a winged scarab of polished gold and turquoise',
      companion: 'a sleek black jackal with gilded markings',
    },
  },
  {
    key: 'deep_space',
    label: 'Deep Space',
    style: 'deep-space opera digital art — vast nebulae, ringed giants and starlight in saturated color',
    cast: {
      keeper: 'a ringed lavender gas giant looming vast in the sky',
      hero: 'a sleek silver starfighter trailing ion light',
      companion: 'a school of star-glass manta rays swimming the void',
    },
  },
  {
    key: 'medieval_fantasy',
    label: 'Medieval Fantasy',
    style: 'high-fantasy digital art — castle spires, enchanted forests and golden magical light',
    cast: {
      keeper: 'an emerald dragon perched on a stone tower',
      hero: 'a silver-armored knight on a white charger',
      companion: 'a tiny golden fairy trailing sparkling dust',
    },
  },
  {
    key: 'lost_atlantis',
    label: 'Lost Atlantis',
    style: 'sunken-Atlantis digital art — turquoise depths, marble ruins and shafts of underwater sunlight',
    cast: {
      keeper: 'a wise giant sea-turtle carrying a glowing marble temple on its shell',
      hero: 'a trident-bearing merfolk warrior',
      companion: 'a flashing school of silver fish',
    },
  },
  {
    key: 'prehistoric',
    label: 'Prehistoric',
    style: 'prehistoric-jungle digital art — giant ferns, volcanic glow and golden primeval mist',
    cast: {
      keeper: 'a long-necked brontosaurus towering over the ferns',
      hero: 'a feathered velociraptor sprinting at full stretch',
      companion: 'a soaring turquoise pterodactyl',
    },
  },
  {
    key: 'masquerade',
    label: 'Masquerade Carnival',
    style: 'venetian-masquerade digital art — jewel-toned silks, gilded masks and candlelit midnight blues',
    cast: {
      keeper: 'a towering harlequin marionette strung with golden light',
      hero: 'a masked dancer twirling in a peacock-feather gown',
      companion: 'a white dove trailing glittering confetti',
    },
  },
];

/** Which (style, option) slots roll a wild theme. Pure; exported for tests. */
export function isWildSlot(style, option) {
  return (style === 'frame_break' && option === 3) || (style === 'eon_connected' && option === 2);
}

/** The wild theme one slot rolled — seeded by batch, so every batch differs. Pure. */
export function wildThemeFor({ specKey, option, weekOf }) {
  return WILD_THEMES[hash(`wild:${weekOf || 'week'}:${specKey}:${option}`) % WILD_THEMES.length];
}

/** The wild theme for a job, or null when the slot isn't wild. Pure. */
export function wildThemeInfo({ style, specKey, option, weekOf }) {
  return isWildSlot(style, option) ? wildThemeFor({ specKey, option, weekOf }) : null;
}

// Two-act scene arcs — each one a STORY told through movement, not a motion
// texture. Live QA 2026-08-10 (Shawn): the old vocabulary ("orbit", "vortex",
// "figure-eights", "interlocking loops") literalized into characters circling
// in the center of the frame. Every arc now stages a narrative journey that
// TRAVELS — entrances, pursuits, encounters, escalation — claiming the full
// ultra-wide canvas edge to edge and front to deep. Each template takes the
// joined cast string and returns act 1 (setup + inciting motion), act 2 (the
// scene TRANSFORMS as the story escalates), and the finale (a closing-frame
// description, kept for legacy storyboard rows).
// Vocabulary guardrails from live QA 2026-08-05: no "celebration" (pulled
// CROWDS of neon human runners), no "frozen" (pulled stone statues + a museum
// room) — beats are described purely as the cast + light + scenery.
// Narrative arcs — each is a complete little STORY told across the 30 seconds,
// written as ordered beats with a clear LEAD character per beat (story
// overhaul 2026-08-11, Shawn: "not flowing with a clear plot" — simultaneous
// unordered activity reads as screensaver soup; the model needs sequence,
// cause → reaction, and a protagonist).
//
// Each arc ships FIVE pieces telling one story:
//   opening — the establishing scene (the opening still; the video's frame 1)
//   act1    — the setup and inciting event (first movement)
//   act2    — the consequence and transformation (second movement)
//   payoff  — the ending AS MOTION (third movement) — described in words and
//             left free, never anchored on a target frame (live QA 2026-08-10)
//   finale  — the ending as a TABLEAU (the closing still, when storyboard is
//             flipped back on; legacy rows still render it)
//
// Vocabulary laws (all learned live): TRAVEL verbs only — orbit/spiral/swirl/
// figure-eight/interlocking literalized into characters circling the center
// (2026-08-10); no "frozen" (statues), "celebration" (crowds), "monumental"
// (pedestals), "figures", show words, screen words, or drawable nouns inside
// negations. Pauses are "poised", never frozen.
const SPECTACULAR_ARCS = [
  // THE DISCOVERY — curiosity rewarded. Keeper LEFT, hero enters RIGHT.
  ({ keeper, hero, companion }) => ({
    opening: `${keeper} rests glowing softly in the left third of the scene while ${companion} drifts high across the deep background on the right; at the far right edge ${hero} has just slipped into view, small and curious, leaning toward the distant glow, the nearest curl of ${keeper}'s light spilling gently through the opening over the black frame`,
    act1: `the story begins in quiet wonder — ${keeper} glows in the left third as ${hero} enters at the far right edge and crosses the whole scene toward it, hugging the near foreground through the right half, plunging deep through the middle. Midway through, ${hero} reaches the left third, discovers ${keeper}, and sweeps past it in one close delighted flyby; ${keeper} stirs and flares in answer, a ripple of light racing from the left edge all the way to the right. At the movement's peak ${hero} banks off the left edge, charges back toward the right foreground, and bursts through the opening over the black frame with ${companion} diving down from the deep right to follow`,
    act2: `${hero} re-enters at the right and leads ${companion} on a joyful chase the OTHER way — right edge to left edge through the near foreground, back left-to-right through the deep background — and every region they cross blooms brighter in their wake, the scenery transforming strip by strip until the whole width has turned radiant`,
    payoff: `${keeper} erupts into full radiant bloom in the left third and hurls a wave of light rightward across the whole scene; ${hero} outruns the wave from left to right, growing from deep-distance small to foreground huge, and bursts through the opening over the black frame at the right of center, ${companion} sweeping wide along the top, the transformed world blazing to every edge`,
    finale: `${keeper} at full radiant bloom in the left third of the transformed scenery, ${hero} bursting through the opening over the black frame right of center, ${companion} banking along the top edge toward it, ribbons of settling light spanning the full width`,
  }),
  // THE SPARK THIEF — a playful theft, returned as a gift. Keeper RIGHT, escape LEFT.
  ({ keeper, hero, companion }) => ({
    opening: `${keeper} cradles a small brilliant orb of light in the right third of the scene while ${companion} glides slow watchful passes across the middle at mid-depth; at the far left edge ${hero} leans into view, eyes on the distant orb, one stray ribbon of the orb's glow spilling gently through the opening over the black frame`,
    act1: `the story begins with a heist — ${hero} enters at the far left edge and works its way right across the whole scene, slipping past ${companion} in the middle with quick feints. Midway through, ${hero} reaches the right third and snatches the blazing orb from ${keeper}; ${keeper} flares in surprise and ${companion} whips into pursuit. At the movement's peak ${hero} tears back left across the full width with the orb blazing, and dives through the opening over the black frame near the left edge, ${companion} closing fast behind`,
    act2: `the chase doubles back — ${hero} re-enters low at the left and races right through the near foreground with ${companion} hard behind, the orb's light igniting every strip of scenery they cross, until at the right third ${hero} relents and returns the orb to ${keeper}, whose lifted light detonates outward and rolls a transformation leftward across the whole scene`,
    payoff: `${keeper} raises the orb to full blaze at the right and the wave of new light sweeps to the far left edge; ${hero} and ${companion} ride it side by side from right to left, swelling huge in the near foreground, and burst through the opening over the black frame together left of center, the transformed world flaring behind them`,
    finale: `${keeper} holding the blazing orb aloft in the right third of the transformed scenery, its light washing every strip of the scene to the far left edge, ${hero} bursting through the opening over the black frame left of center, ${companion} gliding just behind it at mid-depth`,
  }),
  // THE AWAKENING — one bright visitor wakes the whole world, left to right.
  ({ keeper, hero, companion }) => ({
    opening: `the scene waits in deep rich stillness — ${keeper} sleeps dim and low in the right third, ${companion} hovering watchfully above the middle at mid-depth, while ${hero} enters at the far left edge carrying a trail of bright light, its first glow spilling through the opening over the black frame`,
    act1: `the story begins in hush — ${hero} glides in at the far left edge trailing bright light and crosses the sleeping scenery left to right, skimming the near foreground then rising through the deep middle. Midway through, ${hero} reaches the right third and touches its light to ${keeper}; ${keeper} wakes and unfurls in spreading glow, color rolling back leftward wave after wave while ${companion} darts down from the middle in wonder. At the movement's peak ${hero} rides the returning wave leftward and bursts through the opening over the black frame left of center, just as the color reaches the far left edge`,
    act2: `the awakening claims the whole width — ${keeper} rises at the right and pours light outward while ${hero} and ${companion} split the scene between them, ${hero} sweeping the near foreground right-to-left and ${companion} the deep background left-to-right, each strip they cross blooming into a completely new landscape`,
    payoff: `${keeper} rises to full height at the right and casts light to every edge; ${hero} turns at the far left and charges the full width back toward the viewer, growing from deep-distance small to foreground huge, bursting through the opening over the black frame right of center trailing its whole ribbon of light, ${companion} flanking along the top, the scene at maximum brilliance`,
    finale: `the fully awakened scene glowing in rich transformed color across its whole width, ${keeper} risen tall in the right third, ${hero} bursting through the opening over the black frame right of center with its light-trail streaming back to the far left edge, ${companion} poised above the middle`,
  }),
  // THE DUEL OF LIGHT — a contest that becomes an alliance, fought across the width.
  ({ keeper, hero, companion }) => ({
    opening: `${hero} and ${companion} face each other from the far left and far right edges at mid-depth, bright energy gathering around each of them, while ${keeper} watches calm and glowing from the deep middle distance; one streamer of gathered light already spills through the opening over the black frame`,
    act1: `the story begins as a contest — ${hero} charges from the far left and ${companion} from the far right, crossing mid-scene and detonating color where they pass, each returning charge cutting a wider path through a new strip of scenery. Midway through, the raids cross the near foreground in alternating passes, left-to-right then right-to-left. At the movement's peak ${hero} throws the boldest charge yet, sweeping from the far left all the way out through the opening and across the black frame right of center, as ${companion} rises to match it along the top`,
    act2: `${keeper} surges up from the deep middle and braids the duelling ribbons into one — the contest turns to alliance, ${hero} and ${companion} now charging together, left edge to right edge through the near foreground, back through the deep background, their merged light fusing the warring halves of the scenery into one majestic new vista`,
    payoff: `the braided stream of light swells into a torrent spanning the full width; ${hero} rides its crest from the deep middle out to foreground huge and bursts through the opening over the black frame left of center, ${companion} arcing along the right, ${keeper} blazing at the source, the fused vista at full brilliance edge to edge`,
    finale: `one great braided stream of light spanning the full width and flowing out through the opening over the black frame, ${hero} riding its crest left of center, ${companion} arcing along the right at mid-depth, ${keeper} glowing at the deep middle source`,
  }),
];

/** Join a cast list into prose: "a, b and c". Pure. */
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

/** The narrative arc for one spectacular option. Pure; exported for tests.
 *  The wild slot (option 3) casts its rolled theme's characters. */
export function arcFor({ specKey, option, weekOf }) {
  const f = wildThemeInfo({ style: 'frame_break', specKey, option, weekOf })
    ?? familyFor({ specKey, option, weekOf });
  const arc = SPECTACULAR_ARCS[hash(`arc:${weekOf || 'week'}:${specKey}:${option}`) % SPECTACULAR_ARCS.length];
  return arc(f.cast);
}

// 3-act journeys for the connected wide master. Each act plays out in one
// third of the frame — which is exactly one screen of the triptych — so the
// subject performs on the first screen, does something unique in the middle,
// and lands on the far screen. Rotated by week + option so no two runs feel
// the same. Templates take (subject, travel) and must keep the subject inside
// the frame with continuous motion (a stalled subject reads as a frozen loop).
const CHOREOGRAPHIES = [
  (s, tr) =>
    `Scene is in perpetual motion: the entire background swirls and morphs continuously; ${s} performs a violent vertical loop-the-loop in the ${tr.start} third diving and soaring while the scene around it churns with streaming color trails, then barrel-rolls through the middle third with the environment rippling in sync, finally swells huge in the near foreground, landing at the ${tr.end} edge as the entire frame crackles with kinetic energy`,
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
    `Entire scene detonates and reforms: the background fractalizes and blooms explosively; ${s} erupts upward from the ${tr.start} third with explosive force spiraling and surging as the scene around it explodes outward in fractals, blossoms into massive radiating patterns at the center of the frame with the entire composition expanding with kinetic light, then collapses and shrinks deep into the distance as the environment swirls back inward before streaking to the ${tr.end} edge as one unified detonation`,
];

// Dynamic motion for standalone surfaces — entire SCENE in constant motion, not just the subject.
// Seedance responds to scene-wide activity descriptions better than subject-only prompts.
const SOLO_MOTIONS = [
  (s) => `Intense scene: the entire background is rippling and swirling with dynamic color shifts; ${s} swells to fill the near foreground, growing massive in place, while the scene around it churns with streaming light trails and vibrant motion across every pixel of the frame`,
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
// Humans and any characters are allowed (Shawn, 2026-08-14) — only
// text/logos/watermarks stay banned (billboard art must never carry stray type).
// NO PHOTOREAL PEOPLE (2026-08-26, proven live): ByteDance's anti-deepfake
// moderation refuses to animate any image containing what reads as a
// photograph of a person — fictional or not (loc: image_url,
// "likenesses of real people", reason: partner_validation_failed). Controlled
// test: the SAME Atlantis merfolk still passed at 1280px preview detail and
// was refused at the full 4096px master, benign prompt both times — the
// trigger is photograph-grade human detail in the image, nothing else. Humans
// stay allowed (Shawn, 2026-08-14); they must simply be STYLIZED. Positive
// description leads; the negation tail stays short (drawable nouns inside
// negations literalize — the "bands" lesson).
const SAFE =
  'Ultra high detail. No text, no logos, no watermarks. ' +
  'The whole picture is stylized painterly digital art, never photographic: any person or ' +
  'humanoid character is a clearly stylized animated-film character with illustrated ' +
  'features — never a photorealistic human likeness.';
// Energy clause for standalone stills — the subject should feel alive even as
// a still frame. (Kept off the connected master, whose environment must stay
// clean and uniform for the travel illusion.)
const ENERGY =
  'The subject is caught mid-explosion of motion, absolutely bursting with kinetic energy — ' +
  'violent trails of light streak across the frame, kaleidoscopic shockwaves radiate outward, ' +
  'explosive blooms of saturated color detonate around it, with layered depth suggesting ' +
  'the subject is moving through 3D space at high velocity.';

// The spectacular frame geometry. Reworded 2026-08-07 (was the 2026-08-04
// "recessed niche with interior walls" text): live still 125 turned the niche
// walls into literal ROOM ARCHITECTURE — an aquarium hall with a doorway —
// leaving the true perimeter as water and floor, so the art could never sit
// flush against the billboard structure's bezel (Scott). The depth is now
// described as pure black inner shadow, and the EXACT perimeter band is
// guaranteed by the composited frame plate (ffmpeg.buildFramePlateFilter)
// regardless of what the model paints. Byte-stable: opening AND closing
// stills share these so the two storyboard frames agree on geometry.
const FRAME_GEOMETRY =
  `Composition: the picture's border IS a thick matte-black frame — flat matte-black strips run along ` +
  `the top edge, bottom edge, left edge and right edge of the picture, meeting at the four corners, ` +
  `flush with the picture's edges on all sides. Just inside those black strips the image darkens into ` +
  `pure matte-black depth on all four sides — a soft black inner shadow, as if the scene sits deep ` +
  `behind the black border — and through the opening the scene recedes into deep vivid ` +
  `distance. The frame is never shown as an object: no outside of it, no top or sides of any box, no ` +
  `ground it sits on, no room around it, no tilt or angle — the viewpoint is exactly perpendicular, ` +
  `centered, and cropped precisely at the frame's outer edge.`;
// Frame STYLE pin, appended after FRAME_GEOMETRY in BOTH still builders.
// The opening and closing stills are independent Seedream samples, and
// "matte-black frame" alone left the molding to chance: production video 124
// opened on a flat modern frame and ended (via the closing still it was
// anchored to) on ornate stepped molding — the model invented a different
// frame per still (forensics, 2026-08-07). Positive description first;
// negation kept short (drawable nouns inside negations can literalize —
// lesson of 2026-07-31/08-05).
const FRAME_STYLE =
  `The black frame is perfectly plain and flat: uniform width on all four sides, sharp square ` +
  `corners, a smooth matte surface — no molding, no ornament.`;
const FRAME_CONTAINMENT =
  `Every element stays well inside the picture's borders: nothing but the black frame itself ever ` +
  `touches the picture's edge, and nothing is cropped by the picture's boundary — every character ` +
  `and every trail stays fully contained within the frame's outer edge, one solid contained 3D space.`;
// Poise clause for the OPENING still — a story has to start somewhere lower
// than its climax (story overhaul 2026-08-11). CAST_ENERGY stays on the
// closing still (the payoff tableau, when the storyboard flow is on).
// The opening still seeds the VIDEO's energy (image-to-video inherits the
// first frame's momentum): the environment must already be visibly in motion
// — flowing, streaming, churning — not poised and waiting (Shawn, 2026-08-15:
// "the environment inside the frame is dull and lacks movement"). Characters
// stay mid-stride rather than mid-explosion (frozen detonations smear when
// animated — 2026-08-11).
const CAST_POISE =
  'The whole scene is visibly mid-motion: currents of light stream through it, the scenery itself ' +
  'flows, sways and churns, every character distinct and mid-stride at its own depth, the whole ' +
  'space glowing with rich saturated color and unmistakable momentum.';
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
  // WILD SLOT (Shawn, 2026-08-18): this option rolls a randomized era/world
  // theme — digital art in that theme, subject/cast pulled from it.
  const wild = wildThemeInfo({ style, specKey, option, weekOf });
  if (style === 'eon_connected') {
    const tr = travelFor(option);
    const st = wild ? wild.style : t.style;
    const subject = wild ? wild.cast.hero : t.subject;
    return `An ultra-wide continuous panoramic scene with dynamic motion throughout. Style: ${st}. ` +
      `The single hero subject is ${subject}, caught mid-motion and trailing ribbons of glowing light, ` +
      `positioned at the ${tr.start} edge, occupying about one third ` +
      `of the frame width and at least 60% of the frame height, with a continuous seamless environment extending ` +
      `across the full width for it to travel through. The background itself is alive with motion — ` +
      `swirling patterns, flowing textures, and dynamic layers that suggest movement and depth as the subject travels. ` +
      `Lighting shifts and evolves as the subject journeys; no secondary focal objects; ` +
      `keep the subject clear of the areas at one-third and two-thirds of the frame width. ` +
      `${WRAP_BANDS_CONNECTED} ${CONTRAST} ${SAFE}`;
  }
  if (style === 'frame_break') {
    // The WOW signature 3D pop-out — story edition (Shawn, 2026-08-11).
    // The black frame is PAINTED INTO the scene (trompe-l'oeil); characters
    // physically break through it. Never rely on a post-composited letterbox
    // alone — that clips the art BEHIND the frame so nothing can ever pop out
    // (Shawn, 2026-07-15 + 2026-07-21). Geometry formula verified live
    // 2026-08-04 — see FRAME_GEOMETRY / FRAME_CONTAINMENT; never regress to
    // "inset border" or "shadow box as an object" wording (both failed live).
    //
    // This is the ESTABLISHING SHOT — the arc's opening scene, poised rather
    // than exploding, so the 30-second story has somewhere to build to
    // (when frame one is already mid-explosion, the frozen light-detonations
    // smear when animated and the video has no rising action). The gentle
    // frame overlap in each arc's opening keeps the 3D read from second one;
    // the big punches belong to the movements and the ending.
    // Option 3 is the WILD slot: its family/cast come from the rolled theme
    // instead of the house psychedelic families (Shawn, 2026-08-18).
    const f = wild ?? familyFor({ specKey, option, weekOf });
    const cast = joinCast(castList(f));
    // SPLIT TRACKS (Shawn, 2026-08-18, shipping to WOW): option 1 keeps the
    // signature painted border (the mastery track); options 2+ are BORDERLESS
    // full-bleed pieces built to ship now — pure immersive scenery, maximum
    // motion and story.
    if (option === 1) {
      const arc = arcFor({ specKey, option, weekOf });
      return `An ultra-wide trompe-l'oeil deep-relief composition in perfectly frontal, dead-centered, ` +
        `symmetrical one-point perspective. Style: ${f.style}. ` +
        `${FRAME_GEOMETRY} ${FRAME_STYLE} ` +
        `The scene is home to an ensemble of characters: ${cast}. ` +
        `Beyond that cast there is full creative freedom — any characters and scenery that serve the ` +
        `scene are welcome: creatures, people, living objects, anything with personality. ` +
        `This is how the story opens: ${arc.opening}. ` +
        `Whatever moves onto the frame's inner edge is rendered IN FRONT of the black strips, partially ` +
        `covering them and casting soft shadows onto them — unmistakably closer to the viewer than the ` +
        `frame plane. ${FRAME_CONTAINMENT} ` +
        `${CAST_POISE} ${CONTRAST} ${SAFE}`;
    }
    const { keeper, hero, companion } = f.cast;
    const [near, far] = option % 2 === 0 ? ['left', 'right'] : ['right', 'left'];
    return `An ultra-wide cinematic full-bleed composition with sweeping 3D depth. Style: ${f.style}. ` +
      `The scene fills the ENTIRE picture edge to edge and corner to corner — one continuous, deep, ` +
      `living world with no border, no frame, no vignette, no dark edges: pure immersive scenery ` +
      `everywhere. ` +
      `The scene is home to an ensemble of characters: ${cast}. ` +
      `Beyond that cast there is full creative freedom — any characters and scenery that serve the ` +
      `scene are welcome: creatures, people, living objects, anything with personality. ` +
      `This is how the story opens: ${keeper} dominates the ${near} third mid-motion while ${hero} ` +
      `streaks in from the far ${far} edge trailing light and ${companion} sweeps through the deep ` +
      `middle distance — the whole scene already surging. ` +
      `${CAST_POISE} ${CONTRAST} ${SAFE}`;
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
  const f = wildThemeInfo({ style, specKey, option, weekOf }) ?? familyFor({ specKey, option, weekOf });
  const cast = joinCast(castList(f));
  const arc = arcFor({ specKey, option, weekOf });
  return `An ultra-wide trompe-l'oeil deep-relief composition in perfectly frontal, dead-centered, ` +
    `symmetrical one-point perspective. Style: ${f.style}. ` +
    `${FRAME_GEOMETRY} ${FRAME_STYLE} ` +
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
 * Repair a STORED motion prompt at animate time. Two legacy defects, both
 * fixed here (the one place the motion spend happens) so already-approved
 * designs animate correctly without a data migration:
 * - the "vertical band" sentences Seedance literalized into painted white
 *   lines (Scott's pillar videos, 2026-07-31);
 * - the buried tail-position camera clause, replaced by CAMERA_LOCK up front —
 *   the tail clause never named dolly/push-in, and Seedance's push-in was
 *   eating the painted frame (Scott, 2026-08-07).
 * Pure; a no-op on prompts built after 2026-08-07.
 */
export function sanitizeMotionPrompt(prompt) {
  if (!prompt) return prompt;
  let out = prompt;
  for (const sentence of LEGACY_BAND_SENTENCES) out = out.split(sentence).join('');
  // Both mid-prompt (trailing space) and end-of-prompt occurrences.
  out = out.split('Locked static camera; no zoom, no pan. ').join('');
  out = out.split('Locked static camera; no zoom, no pan.').join('').trimEnd();
  if (!out.startsWith(CAMERA_LOCK)) out = `${CAMERA_LOCK} ${out}`;
  return out;
}

// Camera lock — ALWAYS the first sentence of every motion prompt. Seedance 2.0
// has no camera_fixed parameter (v1 had one; the 2.0 schema does not), so the
// prompt is the only lever, and ByteDance's own guidance is: ONE primary
// camera instruction, placed early, in "fixed framing" vocabulary. The old
// clause sat dead last in a ~150-word prompt and named only zoom/pan — not
// dolly or push-in, which is exactly the drift that was eating the painted
// frame (Scott, 2026-08-07).
const CAMERA_LOCK =
  'Fixed camera, locked-off shot: the camera holds fixed framing for the entire clip — ' +
  'no dolly, no push-in, no pull-back, no zoom, no pan, no reframing.';

/**
 * The motion prompt for one option — how the art moves within the frame.
 * @param {{ style, specKey, option, weekOf }} job
 */
export function buildMotionPrompt({ style, specKey, option, weekOf }) {
  const t = themeFor({ specKey, option, weekOf });
  const CONSTANCY =
    'Colors, saturation and lighting remain exactly constant for the entire duration; no fading, no color drift.';
  if (style === 'eon_connected') {
    const tr = travelFor(option);
    // Wild slot: the motion names the wild theme's hero, matching the still.
    const wild = wildThemeInfo({ style, specKey, option, weekOf });
    const acts = choreographyFor({ specKey, option, weekOf })(wild ? wild.cast.hero : t.subject, tr);
    return `${CAMERA_LOCK} Choreographed whole-scene motion: ${acts}. ` +
      `The journey starts in the ${tr.start} third of the frame in the very first frame and finishes at the ` +
      `${tr.end} edge of the frame only in the final frame; the subject stays inside the frame and keeps ` +
      `fluid, continuous motion the whole time — it never stops or hovers in place, and the journey ` +
      `accelerates in surges, each act more kinetic than the one before. ` +
      `Critically: the entire background is in constant motion at all times — not calm or steady. ` +
      `The background environment swirls, ripples, flows, shifts, and evolves continuously in sync with the subject's journey; ` +
      `every pixel of the composition is active. The entire scene is kinetic and alive, never static or passive. ` +
      `${NO_SEAMS} ${CONSTANCY}`;
  }
  if (style === 'frame_break') {
    // SPLIT TRACKS (Shawn, 2026-08-18): only option 1 carries the painted
    // border; options 2+ are borderless full-bleed → framed motion rules
    // would describe a frame that isn't there.
    return buildSpectacularArcPrompt({ specKey, option, weekOf, framed: option === 1 });
  }
  const solo = soloMotionFor({ specKey, option, weekOf })(t.subject);
  return `${CAMERA_LOCK} Vivid ambient motion: ${solo}. ` +
    `${NO_SEAMS} Relentless, high-velocity, premium movement — never static, never jittery. ${CONSTANCY}`;
}

// Spectacular color rule: scenes TRANSFORM on purpose (Scott: "scenes
// constantly changing"), so the EON "colors remain exactly constant" wording
// would fight the arc. What must not happen is DRIFT — Seedance's slow
// desaturation — so saturation is pinned while deliberate change stays free.
const CONSTANCY_SPEC =
  'Saturation stays rich and maxed for the entire duration — colors may transform as the scene changes, ' +
  'but they never fade, wash out, or drift toward grey.';

// The frame rule for both spectacular acts: fixed, flush, inviolable. Since
// 2026-08-11 the delivered video carries NO composited plate (it buried the
// pop-outs), so the model's own painted frame IS the frame — it must stay
// crisp to the last frame, and crossers must render in front of it.
const FRAME_MOTION_RULE =
  `The matte-black frame running along all four outer edges of the image stays perfectly fixed for the whole clip — ` +
  `it never moves, bends, shrinks, detaches from the edges or fades, and nothing ever appears outside it: ` +
  `the frame's outer edge remains the absolute boundary of the piece at all times. ` +
  `The black strips stay crisp, straight and solid black to the very last frame, painted as the nearest ` +
  `layer of the scene — except when a character moves onto them, when the character is drawn ` +
  `IN FRONT of the strips, covering them. ` +
  `Characters on the frame visibly occlude it, casting moving shadows onto it, yet always keep their ` +
  `entire form inside the image bounds — every character, trail and effect stays fully inside the image, ` +
  `never touched or cropped by the outer boundary. ` +
  `The four black strips remain flush with the four edges of the image in every single frame, ` +
  `the same width from the first frame to the last. ` +
  `The viewpoint stays outside the frame, in front of the black border, for the entire clip — ` +
  `it never travels through the opening into the scene. The scene transforms and the characters ` +
  `perform inside the opening and come forward onto the frame plane, always watched from outside.`;

/**
 * The spectacular's motion prompt — deliberately MINIMAL (Shawn, 2026-08-14,
 * after three live 2.5 rounds): choreographing the motion kept backfiring. The
 * timestamped "movements" structure read to Seedance 2.5 as a multi-shot
 * storyboard and it CUT on the beat boundaries, abandoning the frame; the
 * scripted story beats over-constrained motion the model handles better on
 * its own. So the prompt now says only what the model cannot infer: one
 * continuous take (never cut), the painted frame stays exactly as it is
 * (never reframed, never removed), the characters interact with it, the
 * colors hold — plus ONE untimed story sentence naming the design's own
 * cast (beginning → journey → payoff), so the motion has a plot without a
 * shot list. Everything else is the model's. Pure.
 */
/**
 * Wrap ANY story paragraph in the fixed motion contract. The story supplies
 * WHAT happens; the wrapper supplies the immutable rules (camera lock, one
 * take, frame kept + worked, constant full-cast motion, color constancy).
 * Used by both the vision-directed story (director.js — written from the
 * actual generated still) and the template fallback below. Pure.
 */
export function composeSpectacularMotionPrompt(story, { framed = true } = {}) {
  const s = String(story || '').trim();
  const shared =
    `${CAMERA_LOCK} One single continuous take for the entire clip — no cuts, no shot changes, ` +
    `no new angles, no transitions of any kind, ever. ` +
    `The clip begins exactly on this picture's frozen moment and immediately moves AWAY from it — the ` +
    `story never returns to, recreates, or ends on the arrangement shown at the start; the final moment ` +
    `looks clearly different from the first. ` +
    `${s}${s && !s.endsWith('.') ? '.' : ''} ` +
    `Every character is in motion at every single moment of the clip — none of them ever stands still, ` +
    `poses, hovers or waits; even while one leads the action the others keep moving through the scene. ` +
    `The environment is a character too: the ENTIRE scene is in constant vigorous motion at all times — ` +
    `water flows and ripples, plants sway and whip, drips run, clouds and mist churn, light pulses and ` +
    `streams — the scenery visibly reacts to every character that passes through it; no region of the ` +
    `picture is ever calm or frozen; every pixel is alive. `;
  const margins =
    `The picture may sit letterboxed between pure black margins above and below; those margins are outside ` +
    `the picture entirely — dead space that stays pure black for the whole clip; nothing ever enters, ` +
    `crosses, or lights them, and the picture band never moves, shrinks, or resizes between them. `;
  if (framed) {
    return shared +
      `The action travels in depth the whole time — from the deep distance up to the frame plane at the ` +
      `very front and back again. ` +
      `The characters freely pass IN FRONT of the frame — sweeping over the black border strips, wingtips ` +
      `and limbs covering them, casting light and moving shadows onto them — and diving back into the ` +
      `scene; bursts of paint and light may splash across the frame too. ` +
      `The ONE inviolable boundary is the picture's outer edge: every element keeps its entire silhouette ` +
      `inside the image at all times — even at its closest and largest, a character still fits completely ` +
      `within the picture, never clipped by the image's edge, never filling the whole screen. ` +
      margins +
      `${FRAME_MOTION_RULE} ` +
      `Rapid, exciting, high-energy movement — never static, never jittery. ${CONSTANCY_SPEC}`;
  }
  // BORDERLESS track (Shawn, 2026-08-18): full-bleed cinematography — no frame
  // to protect, so characters may sweep in and out across the picture's edges
  // like any cinematic shot. What stays banned is a character swelling so
  // close that it fills the whole screen and blots out the scene.
  return shared +
    `The action travels in depth the whole time — from the deep distance right up to the very front, ` +
    `close to the viewer, and back again. ` +
    `The scene is full-bleed with no frame or border: characters may sweep in and out across the ` +
    `picture's edges freely, entering and exiting the shot like living things crossing a window. ` +
    `No single character ever fills the whole screen or blots out the scene — even at its closest ` +
    `and largest, the world around it stays visible. ` +
    margins +
    `Maximum intensity: this is the most kinetic, most breathtaking version of this scene possible — ` +
    `relentless speed, dramatic near-misses, explosive turns, the whole world surging with the story. ` +
    `Rapid, exciting, high-energy movement — never static, never jittery. ${CONSTANCY_SPEC}`;
}

export function buildSpectacularArcPrompt({ specKey, option, weekOf, framed = true } = {}) {
  // TEMPLATE story — the fallback when the vision director (director.js)
  // can't run (no OpenAI key, fixture mode, or a failed call). A chase with
  // real stakes (Shawn, 2026-08-14: story = pursuit, scenery used as cover,
  // depth travel, decisive payoff), with NO timestamps and NO numbered beats
  // (those read as a shot list and caused the cuts). The cast names match
  // the design's still, so the story is about the characters in the picture.
  const key = specKey ?? 'spectacular_wow1_8';
  const opt = option ?? 1;
  // Option 3 is the wild slot — the fallback story stars the wild cast so it
  // matches the design's still even when the vision director can't run.
  const f = wildThemeInfo({ style: 'frame_break', specKey: key, option: opt, weekOf })
    ?? familyFor({ specKey: key, option: opt, weekOf });
  const { keeper, hero, companion } = f.cast;
  const front = framed ? 'up to the frame itself and back' : 'up to the very front and back';
  const story = `A chase with real stakes plays out across this one take: ${hero} flees across the full ` +
    `width of the scene with ${companion} in relentless pursuit — weaving through the painted scenery, ` +
    `ducking behind it, breaking cover, diving from the deep distance ${front} — ` +
    `— the whole environment surging in their wake, scenery bending and light churning wherever they pass — ` +
    `until the chase peaks at ${keeper}, where the pursuit ends in one decisive dramatic payoff far ` +
    `from where it began, and the whole world erupts with light.`;
  return composeSpectacularMotionPrompt(story, { framed });
}

/**
 * LEGACY — one act of the chain-era two-act motion. No longer stored on new
 * designs (they get buildSpectacularArcPrompt as their single motion prompt);
 * kept because pre-2.5 rows still carry an act-2 prompt that
 * combineSpectacularActs appends at animation time.
 * @param {{ specKey, option, weekOf, act: 1|2 }} job
 */
export function buildSpectacularAct({ specKey, option, weekOf, act }) {
  const arc = arcFor({ specKey, option, weekOf });
  const body = act === 2 ? arc.act2 : arc.act1;
  const landing = act === 2
    ? `In the final moments every character eases into its place in one grand settled formation — ` +
      `the composition resolves into a majestic final scene and holds it as the clip ends. `
    : '';
  return `${CAMERA_LOCK} Trompe-l'oeil 3D pop-out motion, act ${act} of 2: ${body}. ` +
    `${FRAME_MOTION_RULE} ` +
    `Multiple characters are in motion at every moment — none of them ever freezes or hovers; the whole ` +
    `environment moves with them, swirling, flowing and evolving continuously; every pixel is alive. ` +
    `${landing}` +
    `Smooth, premium, explosive high-energy movement — never static, never jittery. ${CONSTANCY_SPEC}`;
}

/**
 * A stored motion prompt + optional LEGACY act-2 prompt as one single-pass
 * prompt. New designs store the full arc as their only motion prompt (act2 is
 * null → passthrough); pre-2.5 rows store act 1 + act 2 separately, and this
 * joins the STORED strings — not a template rebuild — so reviewer edits
 * survive into the render. Pure.
 */
export function combineSpectacularActs(act1, act2) {
  if (!act2) return act1;
  if (!act1) return act2;
  return `${act1} Then, flowing on continuously with no cut or pause, the second act follows. ${act2}`;
}

export { THEMES, CHOREOGRAPHIES, SOLO_MOTIONS, SPECTACULAR_FAMILIES, SPECTACULAR_ARCS, WILD_THEMES };
export default {
  buildStillPrompt, buildClosingStillPrompt, buildMotionPrompt, buildSpectacularArcPrompt,
  composeSpectacularMotionPrompt, buildSpectacularAct, combineSpectacularActs, sanitizeMotionPrompt,
  travelFor, themeFor, choreographyFor, soloMotionFor, familyFor, arcFor, THEMES, SPECTACULAR_FAMILIES,
  WILD_THEMES, wildThemeFor, wildThemeInfo, isWildSlot,
};
