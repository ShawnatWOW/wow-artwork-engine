// Style Library HTTP surface: the dashboard proxy talks to exactly these.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileP = promisify(execFile);
async function hasFfmpeg() {
  try { await execFileP('ffmpeg', ['-version']); return true; } catch { return false; }
}

// Isolate the process-wide repo + store BEFORE config loads (each test file
// is its own process under node --test).
const base = await mkdtemp(path.join(os.tmpdir(), 'wae-styles-http-'));
process.env.STATE_FILE = path.join(base, 'state.json');
process.env.STORAGE_LOCAL_DIR = path.join(base, 'storage');
process.env.GENERATION_MODE = 'fixture';
process.env.OPENAI_API_KEY = '';
process.env.OPEN_AI_API_KEY = '';
process.env.APIFY_TOKEN = '';

const { createApp } = await import('../src/app.js');
const { STYLE_POOL } = await import('../src/services/generation/prompts.js');

let server;
let url;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  url = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await rm(base, { recursive: true, force: true });
});

const json = async (res) => ({ status: res.status, body: res.status === 204 ? null : await res.json() });
const waitReady = async (id, ms = 20000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const { body } = await json(await fetch(`${url}/styles/${id}`));
    if (body.style.status !== 'analyzing') return body.style;
    if (Date.now() > deadline) throw new Error('style never left analyzing');
    await new Promise((r) => setTimeout(r, 100));
  }
};

test('GET /styles seeds and lists the built-ins with usage + pool counts', async () => {
  const { status, body } = await json(await fetch(`${url}/styles`));
  assert.equal(status, 200);
  assert.equal(body.styles.length, STYLE_POOL.length);
  assert.equal(body.pool.enabled, STYLE_POOL.length);
  assert.equal(body.links.instagram, false, 'no Apify token → the UI knows links are off');
  assert.equal(body.analyst, false);
  const cyber = body.styles.find((s) => s.key === 'cyberpunk');
  assert.deepEqual(cyber.usage, { used: 0, approved: 0 });
  assert.equal(cyber.complete, true);
  assert.equal(cyber.source_type, 'builtin');
});

test('PATCH /styles/:id: favourite, disable, rename; DELETE refuses a built-in', async () => {
  const { body: list } = await json(await fetch(`${url}/styles`));
  const cyber = list.styles.find((s) => s.key === 'cyberpunk');
  const patched = await json(await fetch(`${url}/styles/${cyber.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorite: true, enabled: false, label: 'Neon Rain' }),
  }));
  assert.equal(patched.status, 200);
  assert.equal(patched.body.style.favorite, true);
  assert.equal(patched.body.style.enabled, false);
  assert.equal(patched.body.style.label, 'Neon Rain');
  const empty = await json(await fetch(`${url}/styles/${cyber.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: '  ' }) }));
  assert.equal(empty.status, 400);
  const del = await json(await fetch(`${url}/styles/${cyber.id}`, { method: 'DELETE' }));
  assert.equal(del.status, 409);
  const missing = await json(await fetch(`${url}/styles/999999`));
  assert.equal(missing.status, 404);
  const after1 = await json(await fetch(`${url}/styles`));
  assert.equal(after1.body.pool.enabled, STYLE_POOL.length - 1);
});

test('POST /styles/upload: raw bytes → 202 analyzing → (no analyst) failed-but-editable → hand-written card → preview → delete', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const png = path.join(base, 'ref.png');
  await execFileP('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=s=320x240', '-frames:v', '1', png]);
  const bytes = await readFile(png);

  const bad = await json(await fetch(`${url}/styles/upload?name=Nope&filename=notes.txt`, { method: 'POST', body: bytes }));
  assert.equal(bad.status, 415);
  const empty = await json(await fetch(`${url}/styles/upload?name=Nope&filename=a.png`, { method: 'POST', body: Buffer.alloc(0), headers: { 'Content-Type': 'image/png' } }));
  assert.equal(empty.status, 400);

  const created = await json(await fetch(`${url}/styles/upload?name=Scott%27s%20Pick&filename=ref.png`, {
    method: 'POST', body: bytes, headers: { 'Content-Type': 'image/png', 'x-user-email': 'scott@wow' },
  }));
  assert.equal(created.status, 202);
  assert.equal(created.body.style.status, 'analyzing');
  assert.equal(created.body.style.key, 'scott_s_pick');
  assert.equal(created.body.style.created_by, 'scott@wow');

  const failed = await waitReady(created.body.style.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /OpenAI key/);
  assert.equal(failed.has_thumbnail, true);
  const thumb = await fetch(`${url}/styles/${failed.id}/media/thumbnail`);
  assert.equal(thumb.status, 200);
  assert.match(thumb.headers.get('content-type'), /image\/jpeg/);
  const frame = await fetch(`${url}/styles/${failed.id}/media/frame-1`);
  assert.equal(frame.status, 200);
  const noPreview = await fetch(`${url}/styles/${failed.id}/media/preview`);
  assert.equal(noPreview.status, 404);
  const unknown = await json(await fetch(`${url}/styles/${failed.id}/media/whatever`));
  assert.equal(unknown.status, 400);

  // Preview refuses until the card is complete.
  const early = await json(await fetch(`${url}/styles/${failed.id}/preview`, { method: 'POST' }));
  assert.equal(early.status, 409);

  // Hand-write the card → ready.
  const fixed = await json(await fetch(`${url}/styles/${failed.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      style: 'hand-drawn chalk digital art — dusty pastel strokes on slate',
      cast: { keeper: 'a colossal chalk whale', hero: 'a darting chalk fox', companion: 'a tiny chalk moth' },
    }),
  }));
  assert.equal(fixed.body.style.status, 'ready');
  assert.equal(fixed.body.style.error, null);
  assert.equal(fixed.body.style.complete, true);

  const prev = await json(await fetch(`${url}/styles/${failed.id}/preview`, { method: 'POST' }));
  assert.equal(prev.status, 202);
  const deadline = Date.now() + 20000;
  let withPreview;
  for (;;) {
    withPreview = (await json(await fetch(`${url}/styles/${failed.id}`))).body.style;
    if (withPreview.has_preview || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(withPreview.has_preview, true);
  const previewRes = await fetch(`${url}/styles/${failed.id}/media/preview`);
  assert.equal(previewRes.status, 200);

  // It's in the pool now.
  const list = await json(await fetch(`${url}/styles`));
  assert.ok(list.body.styles.some((s) => s.key === 'scott_s_pick' && s.enabled && s.complete));

  // User-added styles can be deleted.
  const del = await fetch(`${url}/styles/${failed.id}`, { method: 'DELETE' });
  assert.equal(del.status, 204);
  assert.equal((await fetch(`${url}/styles/${failed.id}`)).status, 404);
});

test('POST /styles with a link: refused without the Apify connector, with the screenshot hint', async () => {
  const bad = await json(await fetch(`${url}/styles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'nope', name: 'x' }) }));
  assert.equal(bad.status, 400);
  const created = await json(await fetch(`${url}/styles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://www.instagram.com/reel/AbC/', name: 'From IG' }) }));
  assert.equal(created.status, 202);
  const row = await waitReady(created.body.style.id);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /screenshot/i);
  assert.equal(row.source_type, 'link');
  assert.equal(row.source_url, 'https://www.instagram.com/reel/AbC/');
});

test('POST /runs accepts style picks and the rows record them', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const created = await json(await fetch(`${url}/runs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekOf: '2026-09-14', styles: { eon_single: { 1: 'papercraft' } } }),
  }));
  assert.equal(created.status, 202);
  const deadline = Date.now() + 120000;
  let detail;
  for (;;) {
    detail = (await json(await fetch(`${url}/runs/${created.body.runId}`))).body;
    if (detail.run.status !== 'running' || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(detail.run.status, 'complete');
  const single = detail.artworks.filter((a) => a.style === 'eon_single' && a.stage === 'still');
  assert.ok(single.some((a) => a.style_key === 'papercraft' && a.theme_label === 'Papercraft Storybook'));
  assert.ok(detail.artworks.every((a) => a.style_key));
  const usage = await json(await fetch(`${url}/styles`));
  assert.equal(usage.body.styles.find((s) => s.key === 'papercraft').usage.used, 1);
});

test('POST /styles/:id/reanalyze: 409 for a built-in, 202 for an added style (then it re-runs the analyst)', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg not installed');
  const { body: list } = await json(await fetch(`${url}/styles`));
  const builtin = list.styles.find((s) => s.source_type === 'builtin');
  assert.equal((await fetch(`${url}/styles/${builtin.id}/reanalyze`, { method: 'POST' })).status, 409);

  const png = path.join(base, 'ref2.png');
  await execFileP('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=s=320x240', '-frames:v', '1', png]);
  const created = await json(await fetch(`${url}/styles/upload?name=Again&filename=ref2.png`, { method: 'POST', body: await readFile(png), headers: { 'Content-Type': 'image/png' } }));
  const row = await waitReady(created.body.style.id);
  assert.equal(row.status, 'failed'); // no analyst in this lab
  const re = await json(await fetch(`${url}/styles/${row.id}/reanalyze`, { method: 'POST' }));
  assert.equal(re.status, 202);
  assert.equal(re.body.style.status, 'analyzing');
  const after = await waitReady(row.id);
  assert.equal(after.status, 'failed', 'still no analyst → failed again, frames kept');
  assert.equal(after.frame_keys.length, 1);
  assert.equal(after.has_thumbnail, true);
});

test('PATCH /styles/:id accepts the analyst\'s knobs (scene_mode, material, subject_count) and keeps the rest of the analysis', async () => {
  const { body: list } = await json(await fetch(`${url}/styles`));
  const target = list.styles.find((s) => s.key === 'synthwave');
  const r = await json(await fetch(`${url}/styles/${target.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis: { scene_mode: 'material', material: 'molten chrome', subject_count: '2', signature: ['mirror everything', ''] } }),
  }));
  assert.equal(r.status, 200);
  assert.equal(r.body.style.analysis.scene_mode, 'material');
  assert.equal(r.body.style.analysis.material, 'molten chrome');
  assert.equal(r.body.style.analysis.subject_count, 2);
  assert.deepEqual(r.body.style.analysis.signature, ['mirror everything']);
  const r2 = await json(await fetch(`${url}/styles/${target.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analysis: { subject_count: 'many', scene_mode: 'subject' } }) }));
  assert.equal(r2.body.style.analysis.subject_count, 'many');
  assert.equal(r2.body.style.analysis.scene_mode, 'subject');
  assert.equal(r2.body.style.analysis.material, 'molten chrome', 'untouched fields survive');
  // Reset so the roll tests below are unaffected.
  await fetch(`${url}/styles/${target.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analysis: { signature: [], scene_mode: 'subject', material: '', subject_count: null } }) });
});
