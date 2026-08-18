import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStillPrompt, buildClosingStillPrompt, buildMotionPrompt, buildSpectacularArcPrompt,
  composeSpectacularMotionPrompt,
  buildSpectacularAct, combineSpectacularActs, sanitizeMotionPrompt, castList,
  travelFor, themeFor, choreographyFor, familyFor, arcFor, THEMES, CHOREOGRAPHIES, SPECTACULAR_FAMILIES,
} from '../src/services/generation/prompts.js';
import { checkPrompt } from '../src/services/guardrails.js';
import { planJobs } from '../src/services/generation/catalog.js';

// Placement/hardware terms the models don't understand — must never leak into a
// prompt (they only know how to make art, not where it runs).
const DOMAIN_TERMS = /\b(pod|pods|eon|eons|spectacular|spectaculars|billboard|billboards|sign|signs|panel|panels)\b/i;
// Meta-artwork vocabulary gets literalized into pictures-of-pictures
// (live finding: an option rendered a framed print leaning on a wall).
const META_TERMS = /\b(artwork|poster|framed|canvas|display)\b/i;

const JOB = { style: 'frame_break', specKey: 'spectacular_wow1_8', weekOf: '2026-08-10' };

test('buildStillPrompt is deterministic and options differ', () => {
  const a = buildStillPrompt({ ...JOB, option: 1 });
  assert.equal(a, buildStillPrompt({ ...JOB, option: 1 }));
  assert.notEqual(a, buildStillPrompt({ ...JOB, option: 2 }));
});

test('EON connected motion: 3-act choreography, full traversal, color constancy', () => {
  const p1 = buildMotionPrompt({ style: 'eon_connected', specKey: 'eon_master_3pod', option: 1, weekOf: '2026-08-10' });
  // The journey must span all three screens: start in the first third,
  // land at the far edge only in the final frame (the pod-to-pod illusion
  // requires full traversal — a choreography that stalls breaks it).
  assert.match(p1, /starts in the right third of the frame in the very first frame/);
  assert.match(p1, /finishes at the left edge of the frame only in the final frame/);
  assert.match(p1, /never stops or hovers/);
  assert.match(p1, /middle third|center of the frame/); // a distinct middle-screen act
  assert.match(p1, /saturation and lighting remain exactly constant/); // anti-drift
  // ONE camera instruction, FIRST sentence (Seedance 2.0 has no camera_fixed
  // param; position is where the model weights it — 2026-08-07).
  assert.ok(p1.startsWith('Fixed camera, locked-off shot:'), `camera lock must lead: ${p1.slice(0, 60)}`);
  assert.doesNotMatch(p1, /Locked static camera/);
  assert.doesNotMatch(p1, DOMAIN_TERMS);

  const p2 = buildMotionPrompt({ style: 'eon_connected', specKey: 'eon_master_3pod', option: 2, weekOf: '2026-08-10' });
  assert.match(p2, /starts in the left third of the frame/); // option 2 reverses
  assert.match(p2, /finishes at the right edge of the frame/);
});

test('choreography rotates across weeks and stays deterministic', () => {
  const args = { specKey: 'eon_master_3pod', option: 1 };
  // Deterministic: same inputs → same journey.
  assert.equal(
    choreographyFor({ ...args, weekOf: '2026-08-10' }),
    choreographyFor({ ...args, weekOf: '2026-08-10' }),
  );
  // Creative each time: across 8 weeks the journey must actually vary.
  const weeks = ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'];
  const picked = new Set(weeks.map((weekOf) => CHOREOGRAPHIES.indexOf(choreographyFor({ ...args, weekOf }))));
  assert.ok(picked.size >= 3, `expected ≥3 distinct journeys across 8 weeks, got ${picked.size}`);
});

test('standalone motion prompts are dynamic and camera-locked', () => {
  for (const style of ['frame_break', 'eon_single']) {
    const p = buildMotionPrompt({ style, specKey: 'spectacular_wow1_8', option: 1, weekOf: '2026-08-10' });
    assert.ok(p.startsWith('Fixed camera, locked-off shot:'), `camera lock must lead: ${p.slice(0, 60)}`);
    assert.doesNotMatch(p, /Locked static camera/);
    assert.match(p, /never jittery|never chaotic/);
    assert.doesNotMatch(p, DOMAIN_TERMS);
  }
});

test('travelFor cycles the in-frame direction across options', () => {
  assert.equal(travelFor(1).dir, 'rtl');
  assert.equal(travelFor(2).dir, 'ltr');
  assert.equal(travelFor(1).start, 'right');
});

test('every prompt names concrete non-human subjects (themes for EON, casts for spectacular)', () => {
  // Live finding: "a hero subject" alone rendered photoreal people 3/3, which
  // Seedance refuses to animate. Subjects must be NAMED — EON surfaces name
  // their theme subject; the spectacular names its whole ensemble cast.
  const subjects = new Set(THEMES.map((t) => t.subject));
  for (const job of planJobs({ optionsPerSurface: 3 })) {
    const args = { style: job.style, specKey: job.specKey, option: job.option, weekOf: '2026-08-10' };
    if (job.style === 'frame_break') {
      const f = familyFor(args);
      const still = buildStillPrompt(args);
      const closing = buildClosingStillPrompt(args);
      for (const member of castList(f)) {
        assert.ok(still.includes(member), `opening still must name ${member}`);
        assert.ok(closing.includes(member), `closing still must name ${member}`);
      }
      // Motion acts reference the cast through the arc's story beats.
      const act1 = buildSpectacularAct({ ...args, act: 1 });
      assert.ok(castList(f).some((m) => act1.includes(m)), 'act 1 must name the cast');
    } else {
      const t = themeFor(args);
      assert.ok(subjects.has(t.subject));
      assert.ok(buildStillPrompt(args).includes(t.subject), `still must name ${t.subject}`);
      assert.ok(buildMotionPrompt(args).includes(t.subject), `motion must name ${t.subject}`);
    }
  }
});

// ---- Spectacular v2: storyboard, two acts, distinct families (Scott, 2026-08-05)

test('spectacular options draw guaranteed-distinct style families', () => {
  for (const weekOf of ['2026-08-10', '2026-08-17', '2026-08-24']) {
    const fams = [1, 2, 3].map((option) => familyFor({ specKey: 'spectacular_wow1_8', option, weekOf }).key);
    assert.equal(new Set(fams).size, 3, `options collided on a family: ${fams}`);
  }
});

test('spectacular still is an ensemble: multiple named characters, verified frame geometry', () => {
  const still = buildStillPrompt({ ...JOB, option: 1 });
  const f = familyFor({ ...JOB, option: 1 });
  assert.ok(castList(f).length >= 2, 'a cast has at least two characters');
  // The verified geometry formula (live-tested 2026-08-04) must survive edits.
  assert.match(still, /flush with the picture's edges on all sides/);
  assert.match(still, /one-point perspective/);
  assert.match(still, /never shown as an object/);
  assert.match(still, /ensemble of characters/);
  // Story overhaul (2026-08-11): the opening is an ESTABLISHING shot — the
  // arc's opening scene, poised, never the old everyone-mid-explosion text
  // (frozen light-detonations in frame one smear when animated and leave the
  // story nowhere to build).
  assert.match(still, /This is how the story opens/);
  // The opening tableau seeds the video's momentum (Shawn, 2026-08-15):
  // the environment must already be visibly mid-motion, not waiting.
  assert.match(still, /scenery itself\s+flows, sways and churns/);
  assert.match(still, /unmistakable momentum/);
  assert.doesNotMatch(still, /bursting with kinetic energy/);
});

test('closing still: spectacular-only, same geometry + cast, reads as a finale', () => {
  const closing = buildClosingStillPrompt({ ...JOB, option: 1 });
  assert.match(closing, /flush with the picture's edges on all sides/);
  assert.match(closing, /never shown as an object/);
  assert.match(closing, /how the story ends/);
  // The opening still grants creative freedom (Shawn, 2026-08-14: any
  // characters are okay — humans included); the legacy closing keeps its
  // chain-era whitelist untouched.
  assert.match(closing, /ONLY living things/);
  assert.match(buildStillPrompt({ ...JOB, option: 1 }), /full creative freedom/);
  assert.doesNotMatch(buildStillPrompt({ ...JOB, option: 1 }), /ONLY living things/);
  assert.doesNotMatch(closing, /performance|finale|stage/i);
  // The storyboard is a spectacular-only feature.
  assert.equal(buildClosingStillPrompt({ style: 'eon_single', specKey: 'eon_master_pod', option: 1, weekOf: '2026-08-10' }), null);
});

test('two acts differ, act 2 lands the finale, both keep the frame fixed', () => {
  const act1 = buildSpectacularAct({ ...JOB, option: 1, act: 1 });
  const act2 = buildSpectacularAct({ ...JOB, option: 1, act: 2 });
  assert.notEqual(act1, act2);
  assert.match(act1, /act 1 of 2/);
  assert.match(act2, /act 2 of 2/);
  assert.match(act2, /resolves into a majestic final scene/); // segment B settles onto end_image_url
  for (const p of [act1, act2]) {
    assert.match(p, /stays perfectly fixed for the whole clip/);
    assert.ok(p.startsWith('Fixed camera, locked-off shot:'), `camera lock must lead: ${p.slice(0, 60)}`);
    assert.doesNotMatch(p, /Locked static camera/);
    assert.match(p, /never fade, wash out, or drift/); // anti-drift without banning scene change
    assert.doesNotMatch(p, DOMAIN_TERMS);
    assert.doesNotMatch(p, META_TERMS);
    assert.ok(checkPrompt(p).allowed);
  }
});

test('the spectacular motion prompt is MINIMAL + one untimed story — no choreography, no shot list', () => {
  const arc = buildSpectacularArcPrompt({ ...JOB, option: 1 });
  // buildMotionPrompt for frame_break IS this prompt (stored as the still's motion_prompt).
  assert.equal(buildMotionPrompt({ ...JOB, option: 1 }), arc);
  assert.ok(arc.startsWith('Fixed camera, locked-off shot:'), 'camera lock must lead');
  // Every rule exactly once.
  const count = (re) => (arc.match(re) || []).length;
  assert.equal(count(/Fixed camera, locked-off shot/g), 1, 'camera lock stated once');
  assert.equal(count(/stays perfectly fixed for the whole clip/g), 1, 'frame rule stated once');
  assert.equal(count(/never fade, wash out, or drift/g), 1, 'anti-drift stated once');
  // One unbroken take — and NOTHING that reads as a shot list: Seedance 2.5
  // treated timestamped "movements" as cut points and cut on the beat
  // boundaries (live QA 2026-08-10, t=9.67s in Test Art.mp4).
  assert.match(arc, /One single continuous take/);
  assert.match(arc, /no cuts, no shot changes/);
  assert.doesNotMatch(arc, /movement \(|act \d of 2|\d+ seconds/i, 'no timestamps or numbered beats');
  // Frame interaction is ONTO the frame, never out of the picture (Shawn,
  // 2026-08-14: leaving the bounds gets cut off by the aspect ratio and
  // ruins the illusion — the 3D read comes from working the edges).
  assert.match(arc, /freely pass IN FRONT of the frame/);
  assert.match(arc, /never clipped by the image's edge/);
  assert.match(arc, /never filling the whole screen/);
  assert.match(arc, /entire silhouette\s+inside the image/);
  assert.doesNotMatch(arc, /bursting out|past the black border|toward the viewer/);
  assert.doesNotMatch(arc, DOMAIN_TERMS);
  assert.doesNotMatch(arc, META_TERMS);
  assert.ok(checkPrompt(arc).allowed);
  // ONE untimed story sentence naming the design's own cast (Shawn,
  // 2026-08-14: "there's no real story to it") — beginning, journey, payoff,
  // still zero timestamps/beats, so it can't read as a shot list.
  assert.match(arc, /A chase with real stakes plays out across this one take/);
  assert.match(arc, /decisive dramatic payoff/);
  assert.match(arc, /Every character is in motion at every single moment/);
  assert.match(arc, /deep distance up to the frame/);
  // The story names the option's own cast, so options now DIFFER — and each
  // is deterministic for its seed.
  assert.equal(buildMotionPrompt({ ...JOB, option: 1 }), arc);
  assert.notEqual(buildMotionPrompt({ ...JOB, option: 2 }), arc);
});

test('combineSpectacularActs joins the stored acts for a single 30s pass', () => {
  const act1 = buildSpectacularAct({ ...JOB, option: 1, act: 1 });
  const act2 = buildSpectacularAct({ ...JOB, option: 1, act: 2 });
  const combined = combineSpectacularActs(act1, act2);
  // Both stored strings survive verbatim — reviewer edits to either act must
  // reach the render — bridged with an explicit no-cut continuation.
  assert.ok(combined.startsWith(act1));
  assert.ok(combined.endsWith(act2));
  assert.match(combined, /no cut or pause/);
  assert.ok(checkPrompt(combined).allowed);
  // Degenerate inputs (legacy rows without a stored act 2) pass through.
  assert.equal(combineSpectacularActs(act1, null), act1);
  assert.equal(combineSpectacularActs(null, act2), act2);
});

test('closing still + acts rotate deterministically and vary across weeks', () => {
  const args = { specKey: 'spectacular_wow1_8', style: 'frame_break', option: 1 };
  assert.equal(
    buildClosingStillPrompt({ ...args, weekOf: '2026-08-10' }),
    buildClosingStillPrompt({ ...args, weekOf: '2026-08-10' }),
  );
  const weeks = ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'];
  const fams = new Set(weeks.map((weekOf) => familyFor({ ...args, weekOf }).key));
  assert.ok(fams.size >= 3, `expected ≥3 distinct families across 8 weeks, got ${fams.size}`);
  const arcs = new Set(weeks.map((weekOf) => arcFor({ ...args, weekOf }).act1));
  assert.ok(arcs.size >= 2, `expected ≥2 distinct arcs across 8 weeks, got ${arcs.size}`);
});

test('spectacular families: full role-cast, every member concrete and non-human-named', () => {
  assert.ok(SPECTACULAR_FAMILIES.length >= 8, 'at least 8 style variations');
  for (const f of SPECTACULAR_FAMILIES) {
    // Story roles (2026-08-11): keeper (rooted heart), hero (agile
    // protagonist), companion (secondary mover) — every beat needs its lead.
    for (const role of ['keeper', 'hero', 'companion']) {
      assert.ok(f.cast[role]?.length > 8, `${f.key}: missing ${role}`);
      // Named concrete creatures/objects — never a bare "creature"/"figure"
      // (vague subjects render humanoid; Seedance moderation refuses those).
      assert.doesNotMatch(f.cast[role], /\b(figure|person|human|creature)\b/i, `${f.key}: "${f.cast[role]}" too vague`);
    }
  }
});

test('still prompts carry the contrast clause and the text/logo negatives', () => {
  for (const job of planJobs({ optionsPerSurface: 3 })) {
    const still = buildStillPrompt({ style: job.style, specKey: job.specKey, option: job.option, weekOf: '2026-08-10' });
    assert.match(still, /never an all-white or all-black scene/, `missing contrast clause: ${still}`);
    // Humans and any characters are allowed (Shawn, 2026-08-14) — only stray
    // type stays banned on billboard art.
    assert.doesNotMatch(still, /No people, no faces/);
    assert.match(still, /No text, no logos, no watermarks/);
  }
});

test('connected still: subject at start edge, seam-avoidance, room to travel', () => {
  const s = buildStillPrompt({ style: 'eon_connected', specKey: 'eon_master_3pod', option: 1, weekOf: '2026-08-10' });
  assert.match(s, /positioned at the right edge/);
  assert.match(s, /one-third and two-thirds of the frame width/); // seam avoidance
  assert.match(s, /continuous seamless environment/);
});

// Seedance PAINTED white vertical lines at exactly the positions the motion
// prompt named "narrow vertical bands at the one-third and two-thirds lines"
// (Scott's pillar videos, 2026-07-31). Two defenses, both tested:
test('EON prompts never name a drawable seam (band/stripe/line as a noun)', () => {
  for (const style of ['eon_connected', 'eon_single']) {
    for (const option of [1, 2, 3]) {
      const job = { style, specKey: style === 'eon_connected' ? 'eon_master_3pod' : 'eon_master_pod', option, weekOf: '2026-08-10' };
      for (const prompt of [buildStillPrompt(job), buildMotionPrompt(job)]) {
        // "lines" is allowed only in the frame_break border language, never EON.
        assert.doesNotMatch(prompt, /\bbands?\b/i, `${style} names bands: ${prompt}`);
        assert.doesNotMatch(prompt, /\bstripes?\b/i, `${style} names stripes`);
        assert.doesNotMatch(prompt, /vertical lines?\b/i, `${style} names vertical lines`);
      }
    }
  }
});

test('sanitizeMotionPrompt strips the legacy band sentences from stored prompts', () => {
  // A stored 2026-07-25-era connected motion prompt, reconstructed.
  const legacy = 'Choreographed whole-scene motion: things happen. ' +
    'Motion runs continuously through the narrow vertical bands at the left edge and just past the one-third and ' +
    'two-thirds lines — streaks of colour flow through them without pausing — but the subject never parks its head ' +
    'or finest detail inside one of those bands. ' +
    'Locked static camera; no zoom, no pan.';
  const clean = sanitizeMotionPrompt(legacy);
  assert.doesNotMatch(clean, /band/i);
  assert.match(clean, /Choreographed whole-scene motion/);
  // The buried tail camera clause is replaced by the up-front lock, so
  // re-animating an old approved design gets the fix too (2026-08-07).
  assert.doesNotMatch(clean, /Locked static camera/);
  assert.ok(clean.startsWith('Fixed camera, locked-off shot:'), 'stored prompts gain the leading lock');

  // Current prompts pass through untouched, and null is safe.
  const current = buildMotionPrompt({ style: 'eon_connected', specKey: 'eon_master_3pod', option: 1, weekOf: '2026-08-10' });
  assert.equal(sanitizeMotionPrompt(current), current);
  assert.equal(sanitizeMotionPrompt(null), null);
});

test('NO prompt contains placement/hardware or meta-artwork terms, all pass guardrails', () => {
  for (const job of planJobs({ optionsPerSurface: 3 })) {
    const args = { style: job.style, specKey: job.specKey, option: job.option, weekOf: '2026-08-10' };
    for (const p of [buildStillPrompt(args), buildMotionPrompt(args)]) {
      assert.doesNotMatch(p, DOMAIN_TERMS, `placement term leaked: ${p}`);
      assert.doesNotMatch(p, META_TERMS, `meta-artwork term leaked: ${p}`);
      assert.ok(checkPrompt(p).allowed);
    }
  }
});

// ---- Split tracks (Shawn, 2026-08-18, shipping to WOW): option 1 keeps the
// painted border (mastery track); options 2+ are borderless full-bleed built
// for intense motion and story.

test('split tracks: option 1 still keeps the painted frame, options 2+ are borderless full-bleed', () => {
  const framedStill = buildStillPrompt({ ...JOB, option: 1 });
  assert.match(framedStill, /matte-black frame/);
  assert.match(framedStill, /flush with the picture's edges on all sides/);
  for (const option of [2, 3]) {
    const still = buildStillPrompt({ ...JOB, option });
    // Full-bleed: the scene owns every pixel — no frame vocabulary at all.
    assert.match(still, /full-bleed/);
    assert.match(still, /edge to edge and corner to corner/);
    assert.match(still, /no border, no frame, no vignette/);
    assert.doesNotMatch(still, /matte-black/);
    assert.doesNotMatch(still, /trompe-l'oeil/);
    // Still names the whole cast, keeps creative freedom + the shared clauses.
    const f = familyFor({ ...JOB, option });
    for (const member of castList(f)) assert.ok(still.includes(member), `borderless still must name ${member}`);
    assert.match(still, /full creative freedom/);
    assert.match(still, /This is how the story opens/);
    assert.match(still, /never an all-white or all-black scene/);
    assert.match(still, /No text, no logos, no watermarks/);
    assert.doesNotMatch(still, DOMAIN_TERMS);
    assert.doesNotMatch(still, META_TERMS);
    assert.ok(checkPrompt(still).allowed);
    // Deterministic, and distinct from the framed track.
    assert.equal(still, buildStillPrompt({ ...JOB, option }));
    assert.notEqual(still, framedStill);
  }
  // Options 2 and 3 mirror sides so they don't read as clones.
  assert.notEqual(buildStillPrompt({ ...JOB, option: 2 }), buildStillPrompt({ ...JOB, option: 3 }));
});

test('split tracks: borderless motion drops the frame rules, keeps the contract, adds intensity', () => {
  const framed = buildMotionPrompt({ ...JOB, option: 1 });
  assert.match(framed, /freely pass IN FRONT of the frame/);
  assert.match(framed, /stays perfectly fixed for the whole clip/);
  for (const option of [2, 3]) {
    const p = buildMotionPrompt({ ...JOB, option });
    // The shared contract survives: camera lock leads, one take, departure,
    // every-character motion, living environment, letterbox margins, anti-drift.
    assert.ok(p.startsWith('Fixed camera, locked-off shot:'), 'camera lock must lead');
    assert.match(p, /One single continuous take/);
    assert.match(p, /immediately moves AWAY from it/);
    assert.match(p, /Every character is in motion at every single moment/);
    assert.match(p, /The environment is a character too/);
    assert.match(p, /margins are outside\s+the picture entirely/);
    assert.match(p, /never fade, wash out, or drift/);
    // No frame to talk about: every frame rule is gone.
    assert.doesNotMatch(p, /IN FRONT of the frame/);
    assert.doesNotMatch(p, /matte-black/);
    assert.doesNotMatch(p, /stays perfectly fixed for the whole clip/);
    assert.doesNotMatch(p, /frame plane/);
    // Full-bleed edge law: edges are free crossings; only screen-filling is banned.
    assert.match(p, /sweep in and out across the\s+picture's edges freely/);
    assert.match(p, /No single character ever fills the whole screen/);
    // The shipping tracks push intensity and story.
    assert.match(p, /Maximum intensity/);
    assert.doesNotMatch(p, DOMAIN_TERMS);
    assert.doesNotMatch(p, META_TERMS);
    assert.ok(checkPrompt(p).allowed);
    assert.equal(p, buildMotionPrompt({ ...JOB, option }));
  }
});

test('composeSpectacularMotionPrompt wraps ANY story in the fixed contract, rules once', () => {
  const p = composeSpectacularMotionPrompt('The shark hunts the fish through the seaweed');
  assert.ok(p.startsWith('Fixed camera, locked-off shot:'));
  assert.match(p, /The shark hunts the fish through the seaweed\./);
  const count = (re) => (p.match(re) || []).length;
  assert.equal(count(/Fixed camera, locked-off shot/g), 1);
  assert.equal(count(/stays perfectly fixed for the whole clip/g), 1);
  assert.equal(count(/never fade, wash out, or drift/g), 1);
  assert.match(p, /Every character is in motion at every single moment/);
  assert.match(p, /The environment is a character too/);
  assert.match(p, /ONE inviolable boundary is the picture's outer edge/);
  assert.match(p, /margins are outside\s+the picture entirely/);
  assert.match(p, /every pixel is alive/);
  assert.match(p, /deep distance up to the frame plane/);
});
