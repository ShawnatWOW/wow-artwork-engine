// Style Library (2026-09-14): the pool as a table, the reviewer's picks, and
// the ingest pipeline that turns a reference Scott liked into a style card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createMemoryRepo } from '../src/db/memoryRepo.js';
import { createLocalStore } from '../src/services/storage/local.js';
import { motionProvider, stillProvider } from '../src/services/generation/fixture.js';
import { STYLE_POOL, styleFor, buildStillPrompt, buildMotionPrompt } from '../src/services/generation/prompts.js';
import {
  ensureBuiltins, loadLibrary, parsePicks, resolveLook, excludeFor, toLook, isComplete,
} from '../src/services/styles/library.js';
import { normalizeCard, scrub } from '../src/services/styles/analyze.js';
import { canonicalInstagramUrl, pickInstagramMedia, fetchReference, isInstagramUrl } from '../src/services/styles/links.js';
import { motionSignature, buildSampleArgs, extractReference } from '../src/services/styles/frames.js';
import { ingestStyle, previewStyle, slugify } from '../src/services/styles/ingest.js';
import { runWeek, regenerateStill, addStills, regenerateStills } from '../src/services/orchestrator.js';
import { computeSpend } from '../src/services/spend.js';
import { SURFACES } from '../src/services/generation/catalog.js';
import config from '../src/config/index.js';

const execFileP = promisify(execFile);
async function hasFfmpeg() {
  try { await execFileP('ffmpeg', ['-version']); return true; } catch { return false; }
}
const providers = { mode: 'fixture', motion: motionProvider, still: stillProvider };

const DOMAIN_TERMS = /\b(pod|pods|eon|eons|spectacular|spectaculars|billboard|billboards|sign|signs|panel|panels)\b/i;
const META_TERMS = /\b(artwork|poster|framed|canvas|display)\b/i;

// A complete, guardrail-clean card the way the analyst returns it.
const CARD = {
  label: 'Riso Jungle',
  style: 'risograph-print jungle digital art — grainy two-ink overprints of hot coral and teal, halftone shadows and flat cut-paper foliage',
  medium: 'risograph', era: 'contemporary', palette: ['#ff6b6b', '#1fb4a5', '#ffe66d'],
  lighting: 'flat, high-key', linework: 'chunky cut-paper edges', texture: 'ink grain and misregistration',
  composition: 'dense layered foliage, shallow depth', motion_signature: 'gentle looping sway',
  cast: {
    keeper: 'a colossal halftone jaguar sprawled across a tangle of paper vines',
    hero: 'a swift two-ink toucan trailing coral overprint',
    companion: 'a tiny teal tree frog leaping between leaves',
  },
  avoid: ['photorealism', 'gradients'], confidence: 0.8,
};

async function harness() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wae-styles-'));
  return { base, repo: createMemoryRepo(), store: createLocalStore({ baseDir: base }) };
}
async function makePng(dir, name = 'ref.png', w = 640, h = 480) {
  const out = path.join(dir, name);
  await execFileP('ffmpeg', ['-y', '-f', 'lavfi', '-i', `testsrc=s=${w}x${h}`, '-frames:v', '1', out]);
  return out;
}
async function makeMp4(dir, name = 'ref.mp4', seconds = 4) {
  const out = path.join(dir, name);
  await execFileP('ffmpeg', ['-y', '-f', 'lavfi', '-i', `testsrc=s=320x240:r=12:d=${seconds}`, '-pix_fmt', 'yuv420p', out]);
  return out;
}

// --- library -----------------------------------------------------------------

test('ensureBuiltins seeds every code style once and never overwrites an edit', async () => {
  const repo = createMemoryRepo();
  assert.equal(await ensureBuiltins(repo), STYLE_POOL.length);
  assert.equal(await ensureBuiltins(repo), 0, 'second seed is a no-op');
  const row = await repo.getStyleByKey('cyberpunk');
  await repo.updateStyle(row.id, { label: 'Neon Rain', favorite: true, enabled: false });
  await ensureBuiltins(repo);
  const again = await repo.getStyleByKey('cyberpunk');
  assert.equal(again.label, 'Neon Rain');
  assert.equal(again.favorite, true);
  assert.equal(again.enabled, false);
  assert.equal((await repo.listStyles()).length, STYLE_POOL.length);
});

test('loadLibrary: pool = enabled + complete, byKey = every complete style (disabled included)', async () => {
  const repo = createMemoryRepo();
  await ensureBuiltins(repo);
  const cyber = await repo.getStyleByKey('cyberpunk');
  await repo.updateStyle(cyber.id, { enabled: false });
  // An analyzing row with no card can't roll.
  await repo.insertStyle({ key: 'half', label: 'Half', style: '', cast: {}, sourceType: 'upload', status: 'analyzing' });
  const lib = await loadLibrary(repo);
  assert.equal(lib.pool.length, STYLE_POOL.length - 1);
  assert.ok(!lib.pool.some((l) => l.key === 'cyberpunk'));
  assert.ok(lib.byKey.has('cyberpunk'), 'a disabled style can still be picked by name');
  assert.ok(!lib.byKey.has('half'));
  // Pool order = table order = code order, so the roll is unchanged for a
  // fresh library (the same seed rolls the same world as the code pool).
  const look = resolveLook({ library: lib, specKey: 'eon_face', option: 2, weekOf: 'w' });
  const pure = styleFor({ specKey: 'eon_face', option: 2, weekOf: 'w', pool: lib.pool });
  assert.equal(look.key, pure.key);
});

test('parsePicks normalizes the composer payload and drops junk', () => {
  assert.deepEqual(parsePicks({ spectacular: { 1: 'cyberpunk', '2': 'random', x: 'a', 3: '' }, eon_single: null, junk: 'x' }),
    { spectacular: { 1: 'cyberpunk', 2: 'random' } });
  assert.deepEqual(parsePicks(undefined), {});
  assert.deepEqual(parsePicks('nope'), {});
});

test('resolveLook: explicit key wins (even disabled), favorites roll over favorites, random skips exclusions', async () => {
  const repo = createMemoryRepo();
  await ensureBuiltins(repo);
  const cyber = await repo.getStyleByKey('cyberpunk');
  await repo.updateStyle(cyber.id, { enabled: false });
  const west = await repo.getStyleByKey('wild_west');
  const deco = await repo.getStyleByKey('art_deco');
  await repo.updateStyle(west.id, { favorite: true });
  await repo.updateStyle(deco.id, { favorite: true });
  const lib = await loadLibrary(repo);

  assert.equal(resolveLook({ library: lib, specKey: 's', option: 1, weekOf: 'w', pick: 'cyberpunk' }).key, 'cyberpunk');
  for (let option = 1; option <= 6; option += 1) {
    const fav = resolveLook({ library: lib, specKey: 's', option, weekOf: 'w', pick: 'favorites' });
    assert.ok(['wild_west', 'art_deco'].includes(fav.key), `favorites roll stays inside the favorites (got ${fav.key})`);
  }
  // Unknown key → a normal roll, never a crash.
  assert.ok(resolveLook({ library: lib, specKey: 's', option: 1, weekOf: 'w', pick: 'deleted_since' }));
  // Exclusions: whatever random would give, excluding it gives something else.
  const first = resolveLook({ library: lib, specKey: 's', option: 1, weekOf: 'w' });
  const next = resolveLook({ library: lib, specKey: 's', option: 1, weekOf: 'w', exclude: new Set([first.key]) });
  assert.notEqual(next.key, first.key);
  // Pool weighting: a favourite is in the ring twice, a plain style once.
  const ring = [...lib.pool, ...lib.pool.filter((l) => l.favorite)];
  assert.equal(ring.filter((l) => l.key === 'wild_west').length, 2);
  assert.equal(ring.filter((l) => l.key === 'synthwave').length, 1);
});

test('excludeFor: "not last batch" only when the pool still has room for every slot', () => {
  const taken = ['a'];
  const previous = ['b', 'c'];
  assert.deepEqual([...excludeFor({ poolSize: 6, taken, previous, slots: 3 })].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...excludeFor({ poolSize: 4, taken, previous, slots: 3 })], ['a'], 'too small a pool drops the previous-batch rule');
});

test('styleFor with a custom pool: three consecutive options are three worlds; favourites do not break it', () => {
  const pool = STYLE_POOL.slice(0, 6).map((s, i) => ({ ...s, favorite: i === 1 }));
  const seen = new Set();
  const taken = new Set();
  for (const option of [1, 2, 3]) {
    const s = styleFor({ specKey: 'x', option, weekOf: 'w', pool, exclude: taken });
    taken.add(s.key); seen.add(s.key);
  }
  assert.equal(seen.size, 3);
  assert.equal(styleFor({ specKey: 'x', option: 1, weekOf: 'w', pool: [] }), null);
});

test('toLook / isComplete: a row needs a sentence and a full cast', () => {
  assert.equal(isComplete({ style: 'x', cast: { keeper: 'a', hero: 'b', companion: 'c' } }), true);
  assert.equal(isComplete({ style: 'x', cast: { keeper: 'a', hero: 'b' } }), false);
  assert.equal(isComplete({ style: '', cast: { keeper: 'a', hero: 'b', companion: 'c' } }), false);
  const l = toLook({ id: 3, key: 'k', label: 'L', style: 's', cast: { hero: 'h' }, favorite: 1, weight: '2', source_type: 'upload' });
  assert.deepEqual(l, { id: 3, key: 'k', label: 'L', style: 's', cast: { keeper: '', hero: 'h', companion: '' }, favorite: true, weight: 2, sourceType: 'upload', signature: [], backdrop: '', colorRule: '', palette: [], subjectCount: null });
  // The style lock rides along from the analysis (2026-09-15).
  const locked = toLook({ key: 'k', label: 'L', style: 's', cast: CARD.cast, analysis: { signature: ['coated in paint', ''], backdrop: 'a pale wall', color_rule: 'two colours', palette: ['#ff0000'] } });
  assert.deepEqual(locked.signature, ['coated in paint']);
  assert.equal(locked.backdrop, 'a pale wall');
  assert.equal(locked.colorRule, 'two colours');
  assert.deepEqual(locked.palette, ['#ff0000']);
});

// --- analyst -------------------------------------------------------------------

test('normalizeCard: guarantees "digital art", scrubs placement/meta words, rejects an incomplete cast', () => {
  const card = normalizeCard({
    ...CARD,
    style: 'moody billboard poster art of a framed canvas city',
    cast: { keeper: 'a colossal sign-eating whale', hero: 'a panel-winged moth', companion: 'a pod of tiny lanterns' },
    palette: ['ff0000', '#00ff00', 'nope', '#0000ff'],
    confidence: 7,
  });
  assert.match(card.style, /digital art/);
  assert.doesNotMatch(card.style, DOMAIN_TERMS);
  assert.doesNotMatch(card.style, META_TERMS);
  for (const v of Object.values(card.cast)) { assert.doesNotMatch(v, DOMAIN_TERMS); assert.doesNotMatch(v, META_TERMS); }
  assert.deepEqual(card.analysis.palette, ['#ff0000', '#00ff00', '#0000ff']);
  assert.equal(card.analysis.confidence, 1);
  assert.equal(normalizeCard({ ...CARD, cast: { keeper: 'a', hero: 'b' } }), null);
  assert.equal(normalizeCard({ ...CARD, style: '' }), null);
  assert.equal(normalizeCard(null), null);
  assert.equal(scrub('a poster of a sign  on a billboard'), 'a print of a scene on a scene');
});

// --- links ---------------------------------------------------------------------

test('instagram links: canonical form, media choice, and the honest refusal without a token', async () => {
  assert.equal(canonicalInstagramUrl('https://instagram.com/reels/AbC-12_/?igsh=xyz'), 'https://www.instagram.com/reel/AbC-12_/');
  assert.equal(canonicalInstagramUrl('https://www.instagram.com/p/XYZ/'), 'https://www.instagram.com/p/XYZ/');
  assert.equal(canonicalInstagramUrl('https://example.com/p/XYZ/'), null);
  assert.equal(isInstagramUrl('https://www.instagram.com/tv/abc'), true);

  assert.deepEqual(pickInstagramMedia({ videoUrl: 'v.mp4', displayUrl: 'd.jpg', caption: 'c' }), { url: 'v.mp4', kind: 'video', caption: 'c' });
  assert.deepEqual(pickInstagramMedia({ displayUrl: 'd.jpg' }), { url: 'd.jpg', kind: 'image', caption: '' });
  assert.deepEqual(pickInstagramMedia({ childPosts: [{ displayUrl: 'c1.jpg' }, { videoUrl: 'c2.mp4' }] }), { url: 'c1.jpg', kind: 'image', caption: '' });
  assert.equal(pickInstagramMedia({}), null);

  const prev = config.styles.apifyToken;
  config.styles.apifyToken = '';
  try {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-link-'));
    await assert.rejects(
      fetchReference({ url: 'https://www.instagram.com/reel/AbC/', outDir: dir }),
      (e) => e.code === 'link_unsupported' && /screenshot/i.test(e.message),
    );
    await assert.rejects(fetchReference({ url: 'not a link', outDir: dir }), (e) => e.code === 'bad_link');
    await rm(dir, { recursive: true, force: true });
  } finally { config.styles.apifyToken = prev; }
});

test('instagram links with a token: the scraper is asked for the post and its media is downloaded', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-link-'));
  const png = await readFile(await makePng(dir));
  const prev = config.styles.apifyToken;
  config.styles.apifyToken = 'test-token';
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('api.apify.com')) {
      return new Response(JSON.stringify([{ displayUrl: 'https://cdn.example/x.jpg', caption: 'riso print #risograph' }]), { status: 200 });
    }
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
  };
  try {
    const got = await fetchReference({ url: 'https://instagram.com/p/AbC/', outDir: dir, fetchImpl });
    assert.equal(got.kind, 'image');
    assert.equal(got.caption, 'riso print #risograph');
    assert.equal(got.sourceUrl, 'https://www.instagram.com/p/AbC/');
    assert.match(got.filename, /\.png$/);
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.directUrls, ['https://www.instagram.com/p/AbC/']);
    assert.ok(!calls[0].url.includes('test-token=') && calls[0].url.includes('token=test-token'));
  } finally {
    config.styles.apifyToken = prev;
    await rm(dir, { recursive: true, force: true });
  }
});

test('a plain web page link is refused with the "save the picture" hint', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-link-'));
  const fetchImpl = async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  await assert.rejects(fetchReference({ url: 'https://example.com/page', outDir: dir, fetchImpl }), (e) => e.code === 'link_unsupported');
  await rm(dir, { recursive: true, force: true });
});

// --- frames --------------------------------------------------------------------

test('motionSignature classifies scene-score streams', () => {
  assert.equal(motionSignature([]).energy, 'unknown');
  assert.equal(motionSignature([0.001, 0.002, 0.003]).energy, 'slow');
  assert.equal(motionSignature([0.03, 0.04, 0.05]).energy, 'lively');
  assert.equal(motionSignature([0.2, 0.3, 0.4, 0.5, 0.35]).energy, 'kinetic');
  assert.match(motionSignature([0.2, 0.3, 0.4, 0.5, 0.35]).description, /cut-heavy/);
  const args = buildSampleArgs({ input: 'in.mp4', outPattern: 'f%02d.jpg', count: 6, durationS: 12 });
  assert.ok(args.join(' ').includes('fps=6/12'));
  assert.ok(args.includes('6'));
  const one = buildSampleArgs({ input: 'in.png', outPattern: 'f%02d.jpg', count: 1, durationS: null });
  assert.ok(one.includes('-frames:v') && one.includes('1'));
});

test('extractReference: a still yields one frame; a 4s clip yields 4 frames + a measured motion signature', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-frames-'));
  try {
    const png = await makePng(dir);
    const still = await extractReference({ input: png, outDir: path.join(dir, 'a'), filename: 'ref.png' });
    assert.equal(still.frames.length, 1);
    assert.equal(still.isVideo, false);
    assert.equal(still.motion.energy, 'unknown');
    assert.ok(still.thumbnail.endsWith('thumb.jpg'));

    const mp4 = await makeMp4(dir, 'ref.mp4', 4);
    const clip = await extractReference({ input: mp4, outDir: path.join(dir, 'b'), filename: 'ref.mp4', maxFrames: 12 });
    assert.equal(clip.isVideo, true);
    assert.equal(clip.frames.length, 4);
    assert.ok(['slow', 'lively', 'kinetic'].includes(clip.motion.energy), clip.motion.energy);
    assert.equal(clip.width, 320);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// --- ingest --------------------------------------------------------------------

test('slugify makes a stable key', () => {
  assert.equal(slugify('Riso Jungle!! (Scott)'), 'riso_jungle_scott');
  assert.equal(slugify(''), '');
});

test('ingest from an upload: row is analyzing immediately, then ready with card, frames, thumbnail and a preview', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const { base, repo, store } = await harness();
  try {
    const png = await makePng(base, 'scott.png');
    let hints;
    const analyze = async ({ frames, hints: h }) => { hints = { frames: frames.length, ...h }; return normalizeCard(CARD); };
    const { style, done } = await ingestStyle({
      name: 'Riso Jungle', source: { kind: 'file', path: png, filename: 'scott.png' }, createdBy: 'scott@wow',
      deps: { repo, store, providers, analyze },
    });
    assert.equal(style.status, 'analyzing');
    assert.equal(style.key, 'riso_jungle');
    assert.equal(style.source_type, 'upload');
    assert.equal(style.enabled, true, 'a new style joins the pool automatically');

    const final = await done;
    assert.equal(final.status, 'ready');
    assert.equal(final.label, 'Riso Jungle', "the reviewer's name wins over the analyst's");
    assert.equal(final.style, CARD.style);
    assert.deepEqual(final.cast, CARD.cast);
    assert.equal(final.frame_keys.length, 1);
    assert.ok(final.thumbnail_key && final.source_key && final.preview_key && final.preview_thumb_key);
    assert.equal(final.analysis.stage, 'done');
    assert.equal(final.analysis.medium, 'risograph');
    assert.equal(final.analysis.preview_cost_usd, 0, 'fixture previews are free');
    assert.equal(hints.frames, 1);
    assert.equal(hints.name, 'Riso Jungle');
    // Files really landed in the store.
    assert.ok((await store.getBuffer(final.preview_key)).length > 0);
    assert.ok((await store.getBuffer(final.thumbnail_key)).length > 0);

    // The preview prompt is a real still prompt in this style with this cast.
    assert.match(final.analysis.preview_prompt, /risograph-print jungle/);
    assert.match(final.analysis.preview_prompt, /halftone jaguar/);
    assert.doesNotMatch(final.analysis.preview_prompt, DOMAIN_TERMS);

    // A second style with the same name gets a distinct key.
    const again = await ingestStyle({ name: 'Riso Jungle', source: { kind: 'file', path: png, filename: 'scott.png' }, deps: { repo, store, providers, analyze } });
    assert.equal(again.style.key, 'riso_jungle_2');
    await again.done;

    // It now rolls in the pool alongside the built-ins.
    const lib = await loadLibrary(repo);
    assert.equal(lib.pool.length, STYLE_POOL.length + 2);
    assert.ok(lib.byKey.has('riso_jungle'));
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('ingest without an analyst: a failed row that keeps its frames, completed by hand, then previewable', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const { base, repo, store } = await harness();
  try {
    const mp4 = await makeMp4(base, 'reel.mp4', 3);
    const { done } = await ingestStyle({
      name: 'Mystery Reel', source: { kind: 'file', path: mp4, filename: 'reel.mp4' },
      deps: { repo, store, providers, analyze: async () => null },
    });
    const failed = await done;
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /by hand/);
    assert.equal(failed.frame_keys.length, 3);
    assert.ok(failed.thumbnail_key);
    assert.equal(failed.analysis.source.isVideo, true);
    assert.ok(!(await loadLibrary(repo)).byKey.has('mystery_reel'), 'a failed style never rolls');

    await assert.rejects(previewStyle({ styleId: failed.id, deps: { repo, store, providers } }), /needs a style sentence/);
    await repo.updateStyle(failed.id, { style: CARD.style, cast: CARD.cast, status: 'ready', error: null });
    const previewed = await previewStyle({ styleId: failed.id, deps: { repo, store, providers } });
    assert.ok(previewed.preview_key);
    assert.ok((await loadLibrary(repo)).byKey.has('mystery_reel'));
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('ingest from a link: the fetched reference is analyzed and the canonical URL is stored', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const { base, repo, store } = await harness();
  try {
    const png = await makePng(base, 'ig.png');
    const fetchReferenceStub = async ({ outDir }) => {
      const dest = path.join(outDir, 'source.png');
      await execFileP('cp', [png, dest]);
      return { path: dest, filename: 'source.png', kind: 'image', caption: 'risograph', sourceUrl: 'https://www.instagram.com/p/AbC/' };
    };
    const { style, done } = await ingestStyle({
      name: '', source: { kind: 'link', url: 'https://instagram.com/p/AbC/?igsh=1' },
      deps: { repo, store, providers, analyze: async () => normalizeCard(CARD), fetchReference: fetchReferenceStub },
    });
    assert.equal(style.source_type, 'link');
    const final = await done;
    assert.equal(final.status, 'ready');
    assert.equal(final.label, 'Riso Jungle', "no name given → the analyst's label");
    assert.equal(final.source_url, 'https://www.instagram.com/p/AbC/');
    assert.equal(final.analysis.caption, 'risograph');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('ingest: a bad link or empty source is refused before any row exists', async () => {
  const repo = createMemoryRepo();
  await assert.rejects(ingestStyle({ name: 'x', source: { kind: 'link', url: 'nope' }, deps: { repo } }), (e) => e.code === 'bad_link');
  await assert.rejects(ingestStyle({ name: 'x', source: null, deps: { repo } }), (e) => e.code === 'bad_source');
  assert.equal((await repo.listStyles()).length, 0);
});

// --- generation with picks ----------------------------------------------------

test('runWeek with picks: a named style is worn by its slot, "favorites" stays inside favourites, random fills the rest — all rows carry style_key', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const { base, repo, store } = await harness();
  try {
    await ensureBuiltins(repo);
    const deco = await repo.getStyleByKey('art_deco');
    await repo.updateStyle(deco.id, { favorite: true });
    const spectacularOnly = SURFACES.filter((s) => s.key === 'spectacular');
    const { runId } = await runWeek({
      weekOf: '2026-09-14', triggeredBy: 'test',
      styles: { spectacular: { 1: 'cyberpunk', 2: 'favorites', 3: 'random' } },
      deps: { repo, store, providers, surfaces: spectacularOnly, optionsPerSurface: 3, duration: 1 },
    });
    const stills = await repo.listArtworks(runId);
    assert.equal(stills.length, 3);
    assert.equal(stills.filter((a) => a.style_key).length, 3, 'every design records its style key');
    const framed = stills.find((a) => /matte-black frame/.test(a.prompt));
    assert.equal(framed.style_key, 'cyberpunk');
    assert.equal(framed.theme_label, 'Cyberpunk');
    assert.match(framed.prompt, /cyberpunk digital art/);
    assert.ok(stills.some((a) => a.style_key === 'art_deco'), 'the favourites slot wore the only favourite');
    assert.equal(new Set(stills.map((a) => a.style_key)).size, 3, 'three worlds');
    // Usage stats see it.
    const usage = await repo.styleUsage();
    assert.equal(usage.cyberpunk.used, 1);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a style Scott added from a reference is generated exactly like a built-in: still + motion name its cast', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const { base, repo, store } = await harness();
  try {
    const png = await makePng(base, 'scott.png');
    const { done } = await ingestStyle({ name: 'Riso Jungle', source: { kind: 'file', path: png, filename: 'scott.png' }, deps: { repo, store, providers, analyze: async () => normalizeCard(CARD) } });
    await done;
    const single = SURFACES.filter((s) => s.key === 'eon_single');
    const { runId } = await runWeek({
      weekOf: '2026-09-14', triggeredBy: 'test', styles: { eon_single: { 1: 'riso_jungle' } },
      deps: { repo, store, providers, surfaces: single, optionsPerSurface: 1, duration: 1 },
    });
    const [row] = await repo.listArtworks(runId);
    assert.equal(row.style_key, 'riso_jungle');
    assert.equal(row.theme_label, 'Riso Jungle');
    assert.match(row.prompt, /two-ink toucan/);
    assert.match(row.motion_prompt, /two-ink toucan/);
    assert.doesNotMatch(row.prompt, DOMAIN_TERMS);
    assert.doesNotMatch(row.motion_prompt, META_TERMS);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('replace / add / replace-one honour a picked style and otherwise avoid what the sign already wears', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const { base, repo, store } = await harness();
  try {
    const single = SURFACES.filter((s) => s.key === 'eon_single');
    const deps = { repo, store, providers, surfaces: single, optionsPerSurface: 3, duration: 1 };
    const { runId } = await runWeek({ weekOf: '2026-09-14', triggeredBy: 'test', deps });
    const before = (await repo.listArtworks(runId)).filter((a) => a.stage === 'still');
    const worn = new Set(before.map((a) => a.style_key));
    assert.equal(worn.size, 3);

    // Add one with a pick.
    await addStills({ runId, surfaceKey: 'eon_single', count: 1, styleKey: 'papercraft', deps });
    let rows = (await repo.listArtworks(runId)).filter((a) => a.stage === 'still' && a.status !== 'superseded');
    assert.equal(rows.length, 4);
    assert.equal(rows.at(-1).style_key, 'papercraft');

    // Add one at random: never repeats a sibling.
    await addStills({ runId, surfaceKey: 'eon_single', count: 1, deps });
    rows = (await repo.listArtworks(runId)).filter((a) => a.stage === 'still' && a.status !== 'superseded');
    assert.equal(new Set(rows.map((a) => a.style_key)).size, 5, 'five designs, five worlds');

    // Replace ONE with a pick, then one at random (which must avoid its own old look and siblings).
    const target = rows[0];
    await regenerateStill({ artworkId: target.id, styleKey: 'nordic_myth', deps });
    rows = (await repo.listArtworks(runId)).filter((a) => a.stage === 'still' && a.status !== 'superseded');
    assert.ok(rows.some((a) => a.style_key === 'nordic_myth'));
    const victim = rows.find((a) => a.style_key === 'nordic_myth');
    await regenerateStill({ artworkId: victim.id, deps });
    rows = (await repo.listArtworks(runId)).filter((a) => a.stage === 'still' && a.status !== 'superseded');
    assert.equal(new Set(rows.map((a) => a.style_key)).size, rows.length, 'still all distinct');
    assert.ok(!rows.some((a) => a.style_key === 'nordic_myth'), 'the replaced look is not handed straight back');

    // Replace-unsaved with one key for every slot is allowed (explicit choice).
    await regenerateStills({ runId, surfaceKey: 'eon_single', styleKey: 'solarpunk', deps });
    rows = (await repo.listArtworks(runId)).filter((a) => a.stage === 'still' && a.status !== 'superseded');
    assert.ok(rows.every((a) => a.style_key === 'solarpunk'));
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('next batch avoids last batch\'s looks for the same sign (pool permitting)', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const { base, repo, store } = await harness();
  try {
    const single = SURFACES.filter((s) => s.key === 'eon_single');
    const deps = { repo, store, providers, surfaces: single, optionsPerSurface: 3, duration: 1 };
    const a = await runWeek({ weekOf: '2026-09-14', triggeredBy: 'test', deps });
    const b = await runWeek({ weekOf: '2026-09-14', triggeredBy: 'test', deps });
    const wornA = new Set((await repo.listArtworks(a.runId)).map((r) => r.style_key));
    const wornB = (await repo.listArtworks(b.runId)).map((r) => r.style_key);
    assert.equal(wornB.length, 3);
    for (const k of wornB) assert.ok(!wornA.has(k), `${k} came straight back`);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('spend counts live style previews (and ignores fixture ones)', async () => {
  const repo = createMemoryRepo();
  const now = new Date().toISOString();
  await repo.insertStyle({ key: 'p1', label: 'P1', style: 's', cast: {}, analysis: { preview_costs_usd: [{ at: now, usd: 0.03 }, { at: now, usd: 0 }, { at: '2020-01-01T00:00:00Z', usd: 0.03 }] } });
  const spend = await computeSpend({ repo });
  assert.deepEqual(spend.stylePreviews, { count: 1, usd: 0.03 });
  assert.equal(spend.totalUsd, 0.03);
});

test('buildStillPrompt/buildMotionPrompt accept a resolved look and ignore the roll', () => {
  const look = toLook({ key: 'k', label: 'K', style: 'papercut storybook digital art — layered paper', cast: CARD.cast });
  for (const style of ['frame_break', 'eon_connected', 'eon_single']) {
    for (const option of [1, 2, 3]) {
      const p = buildStillPrompt({ style, specKey: 'x', option, weekOf: 'w', look });
      assert.match(p, /papercut storybook digital art/);
      const m = buildMotionPrompt({ style, specKey: 'x', option, weekOf: 'w', look });
      assert.match(m, /toucan|jaguar|tree frog/);
    }
  }
});

// --- the style lock (2026-09-15) ------------------------------------------------

test('style lock: a card with a signature writes its rules, backdrop and colour count into every still; built-ins are untouched', () => {
  const locked = toLook({
    key: 'clash', label: 'Explosive Color Clash', style: 'high-speed studio photography of liquid paint — digital art',
    cast: { keeper: 'a colossal paint-dipped bison', hero: 'a paint-coated hare mid-leap', companion: 'a tiny paint-dipped beetle' },
    analysis: {
      signature: ['every object is coated in thick drippy paint', 'macro close-up: subjects dominate the frame'],
      backdrop: 'plain pastel lavender studio wall',
      color_rule: 'two saturated colours collide per scene',
      palette: ['#0052A4', '#F2B134', '#F23005', '#84C441', '#F25294'],
    },
  });
  for (const style of ['frame_break', 'eon_connected', 'eon_single']) {
    for (const option of [1, 2, 3]) {
      const p = buildStillPrompt({ style, specKey: 'x', option, weekOf: 'w', look: locked });
      assert.match(p, /These rules define the look and override any other direction here: every object is coated in thick drippy paint; macro close-up/);
      assert.match(p, /the backdrop is plain pastel lavender studio wall/);
      // The colour rule says TWO, so exactly two palette colours are named — and the dark-background demand yields.
      assert.match(p, /this scene uses only [a-z -]+ and [a-z -]+, nothing else/);
      assert.doesNotMatch(p, /deep, dark background/);
      assert.match(p, /readable from far away/);
      // "creatures, people" creative freedom gives way to freedom of subject only.
      assert.doesNotMatch(p, /creatures, people, living objects/);
      assert.doesNotMatch(p, DOMAIN_TERMS);
      assert.doesNotMatch(p, META_TERMS);
    }
  }
  // Siblings get different colour pairs (rotated by option).
  const pair = (o) => /uses only ([a-z -]+) and ([a-z -]+), nothing else/.exec(buildStillPrompt({ style: 'eon_single', specKey: 'x', option: o, weekOf: 'w', look: locked })).slice(1);
  assert.notDeepEqual(pair(1), pair(2));
  // A built-in has no lock: the classic clauses stay exactly as they were.
  const plain = toLook({ key: 'k', label: 'K', style: 'papercut storybook digital art', cast: CARD.cast });
  const p = buildStillPrompt({ style: 'frame_break', specKey: 'x', option: 2, weekOf: 'w', look: plain });
  assert.doesNotMatch(p, /These rules define the look/);
  assert.match(p, /deep, dark background/);
  assert.match(p, /full creative freedom/);
});

test('colorCountOf / paletteFor: the rule\'s count wins, otherwise up to five', async () => {
  const { colorCountOf, paletteFor } = await import('../src/services/generation/prompts.js');
  assert.equal(colorCountOf('two saturated colours per scene'), 2);
  assert.equal(colorCountOf('3 flat inks'), 3);
  assert.equal(colorCountOf('full rainbow spectrum everywhere'), null);
  const pal = ['#1', '#2', '#3', '#4', '#5', '#6'];
  assert.deepEqual(paletteFor({ palette: pal, colorRule: 'two colours' }, 1), ['#1', '#2']);
  assert.deepEqual(paletteFor({ palette: pal, colorRule: 'two colours' }, 2), ['#2', '#3']);
  assert.deepEqual(paletteFor({ palette: pal, colorRule: 'rainbow' }, 1), ['#1', '#2', '#3', '#4', '#5']);
  assert.deepEqual(paletteFor({ palette: [], colorRule: 'two' }, 1), []);
});

test('normalizeCard keeps the signature, backdrop and colour rule (scrubbed)', () => {
  const card = normalizeCard({ ...CARD, signature: ['coated in paint like a poster', '', 'two colours'], backdrop: 'a plain sign wall', color_rule: 'two flat colours on a canvas' });
  assert.deepEqual(card.analysis.signature, ['coated in paint like a print', 'two colours']);
  assert.equal(card.analysis.backdrop, 'a plain scene wall');
  assert.equal(card.analysis.color_rule, 'two flat colours on a surface');
  assert.deepEqual(normalizeCard(CARD).analysis.signature, []);
});

test('reanalyzeStyle: rewrites the card from the stored frames, keeps the name, paints a new preview; refuses built-ins', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const { reanalyzeStyle } = await import('../src/services/styles/ingest.js');
  const { base, repo, store } = await harness();
  try {
    const mp4 = await makeMp4(base, 'reel.mp4', 3);
    const first = normalizeCard(CARD);
    const { done } = await ingestStyle({ name: 'Scott Reel', source: { kind: 'file', path: mp4, filename: 'reel.mp4' }, deps: { repo, store, providers, analyze: async () => first } });
    const v1 = await done;
    assert.equal(v1.status, 'ready');
    const previewBefore = v1.preview_key;

    let seenFrames = 0;
    const second = normalizeCard({ ...CARD, label: 'Analyst Name', style: 'paint-dipped studio digital art — two flat colours', signature: ['coated in thick paint'], backdrop: 'a pale wall', color_rule: 'two colours' });
    const v2 = await reanalyzeStyle({ styleId: v1.id, deps: { repo, store, providers, analyze: async ({ frames, hints }) => { seenFrames = frames.length; assert.equal(hints.name, 'Scott Reel'); assert.equal(hints.isVideo, true); return second; } } });
    assert.equal(seenFrames, 3, 'the stored frames were handed to the analyst');
    assert.equal(v2.status, 'ready');
    assert.equal(v2.label, 'Scott Reel', 'the reviewer\'s name survives');
    assert.match(v2.style, /paint-dipped/);
    assert.deepEqual(v2.analysis.signature, ['coated in thick paint']);
    assert.ok(v2.analysis.reanalyzed_at);
    assert.notEqual(v2.preview_key, previewBefore, 'a fresh preview was painted');
    assert.match(v2.analysis.preview_prompt, /These rules define the look/);
    assert.equal(v2.frame_keys.length, 3, 'frames kept');

    // A failed re-analysis leaves a usable card usable.
    const v3 = await reanalyzeStyle({ styleId: v1.id, deps: { repo, store, providers, analyze: async () => null } });
    assert.equal(v3.status, 'ready');
    assert.match(v3.error, /by hand/);
    assert.match(v3.style, /paint-dipped/);

    await ensureBuiltins(repo);
    const cyber = await repo.getStyleByKey('cyberpunk');
    await assert.rejects(reanalyzeStyle({ styleId: cyber.id, deps: { repo, store, providers } }), (e) => e.code === 'builtin');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('missingFields names exactly what an incomplete analyst answer lacks', async () => {
  const { missingFields } = await import('../src/services/styles/analyze.js');
  assert.deepEqual(missingFields(null), ['everything']);
  assert.deepEqual(missingFields({ style: 'x', cast: { keeper: 'a', hero: 'b', companion: 'c' } }), []);
  assert.deepEqual(missingFields({ style: '', cast: { keeper: 'a', hero: '', companion: 'c' } }), ['style', 'cast.hero']);
  assert.deepEqual(missingFields({}), ['style', 'cast.keeper', 'cast.hero', 'cast.companion']);
});

test('colorName turns palette hex into the plain names the painter obeys', async () => {
  const { colorName } = await import('../src/services/generation/prompts.js');
  assert.equal(colorName('#F2B134'), 'golden yellow');
  assert.equal(colorName('#F23005'), 'vermilion orange-red');
  assert.equal(colorName('#0052A4'), 'cobalt blue');
  assert.equal(colorName('#84C441'), 'lime green');
  assert.equal(colorName('#F25294'), 'crimson pink');
  assert.equal(colorName('#ffffff'), 'white');
  assert.equal(colorName('#101010'), 'black');
  assert.equal(colorName('nope'), 'nope');
});

test('subject count: a one- or two-subject look trims the spectacular ensemble; the crowd clauses are gone', async () => {
  const { subjectsFor, buildSpectacularArcPrompt, buildClosingStillPrompt } = await import('../src/services/generation/prompts.js');
  const base = {
    key: 'clash', label: 'Explosive Color Clash', style: 'liquid paint digital art',
    cast: { keeper: 'a colossal paint-dipped bison', hero: 'a paint-coated hare mid-leap', companion: 'a tiny paint-dipped beetle' },
  };
  const one = toLook({ ...base, analysis: { signature: ['coated in paint'], backdrop: 'a pale wall', subject_count: 1 } });
  const two = toLook({ ...base, analysis: { signature: ['coated in paint'], backdrop: 'a pale wall', subject_count: 2 } });
  const many = toLook({ ...base, analysis: { signature: ['coated in paint'], backdrop: 'a pale wall', subject_count: 'many' } });
  const plain = toLook(base);
  assert.equal(one.subjectCount, 1); assert.equal(two.subjectCount, 2); assert.equal(many.subjectCount, null); assert.equal(plain.subjectCount, null);
  assert.deepEqual(subjectsFor(one), ['a paint-coated hare mid-leap']);
  assert.deepEqual(subjectsFor(two), ['a colossal paint-dipped bison', 'a paint-coated hare mid-leap']);
  assert.equal(subjectsFor(many).length, 3);
  assert.equal(subjectsFor(plain).length, 3);

  for (const option of [1, 2, 3]) {
    const p1 = buildStillPrompt({ style: 'frame_break', specKey: 'x', option, weekOf: 'w', look: one });
    assert.match(p1, /exactly one living subject: a paint-coated hare mid-leap — colossal in frame/);
    assert.match(p1, /exactly one living subject in the frame, never a crowd/);
    assert.doesNotMatch(p1, /bison|beetle/, 'the other two creatures never appear');
    assert.doesNotMatch(p1, /ensemble|creative freedom|every character distinct/);
    assert.doesNotMatch(p1, DOMAIN_TERMS); assert.doesNotMatch(p1, META_TERMS);
    if (option === 1) assert.match(p1, /matte-black frame/, 'the framed track keeps its border');

    const p2 = buildStillPrompt({ style: 'frame_break', specKey: 'x', option, weekOf: 'w', look: two });
    assert.match(p2, /exactly two living subjects: a colossal paint-dipped bison and a paint-coated hare mid-leap/);
    assert.doesNotMatch(p2, /beetle|ensemble|creative freedom/);
    assert.match(p2, /about to collide/);

    // The full ensemble is untouched for a many-subject or unlocked look.
    for (const l of [many, plain]) {
      const p3 = buildStillPrompt({ style: 'frame_break', specKey: 'x', option, weekOf: 'w', look: l });
      assert.match(p3, /ensemble of characters: a colossal paint-dipped bison, a paint-coated hare mid-leap and a tiny paint-dipped beetle/);
    }
  }
  // Template story and closing still follow the count too.
  const s1 = buildSpectacularArcPrompt({ specKey: 'x', option: 2, weekOf: 'w', framed: false, look: one });
  assert.match(s1, /One journey with real stakes/); assert.doesNotMatch(s1, /bison|beetle/);
  const s2 = buildSpectacularArcPrompt({ specKey: 'x', option: 2, weekOf: 'w', framed: false, look: two });
  assert.match(s2, /A collision with real stakes/); assert.doesNotMatch(s2, /beetle/);
  const s3 = buildSpectacularArcPrompt({ specKey: 'x', option: 2, weekOf: 'w', framed: false, look: plain });
  assert.match(s3, /A chase with real stakes/); assert.match(s3, /beetle/);
  const c1 = buildClosingStillPrompt({ style: 'frame_break', specKey: 'x', option: 1, weekOf: 'w', look: one });
  assert.doesNotMatch(c1, /bison|beetle/);
  // The motion prompt for the spectacular reads the same count.
  const m1 = buildMotionPrompt({ style: 'frame_break', specKey: 'x', option: 2, weekOf: 'w', look: one });
  assert.doesNotMatch(m1, /bison|beetle/);
  // normalizeCard accepts 1/2/3/"many".
  assert.equal(normalizeCard({ ...CARD, subject_count: 2 }).analysis.subject_count, 2);
  assert.equal(normalizeCard({ ...CARD, subject_count: 'many' }).analysis.subject_count, 'many');
  assert.equal(normalizeCard(CARD).analysis.subject_count, null);
});
