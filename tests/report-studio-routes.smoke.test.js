'use strict';
const fetch = require('./_http-fetch');
// Step 9 — /api/report-studio on sqlite: gates (author / site editor / viewer), draft generation from the seeded
// site-weekly-pack, outputs html/csv/xlsx/pptx, human review before publish, commentary edit + frozen once published.
const _os = require('os'), _fs = require('fs'), _path = require('path');
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'rs-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'rs-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'rs-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'rs-smoke-key';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, admin, author, editor, otherEditor, viewer, rdb, hounde, mana;

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  for (let i = 0; i < 60; i++) { if (rdb.db.prepare("SELECT 1 FROM sqlite_master WHERE name='report_templates'").get() && rdb.db.prepare("SELECT 1 FROM report_templates WHERE key='site-weekly-pack'").get() && rdb.db.prepare("SELECT 1 FROM sqlite_master WHERE name='dashboard_definitions'").get() && rdb.db.prepare("SELECT 1 FROM dashboard_definitions WHERE key='site-weekly' AND status='published'").get()) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, role, roles, site) => { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', role, roles, site_id: site }); } catch {} return (await rdb.login(u, u + 'pass1234')).token; };
  admin = await mk('rs_admin', 'admin', ['admin']); author = await mk('rs_author', 'viewer', ['viewer', 'report-author']);
  editor = await mk('rs_editor', 'editor', ['editor'], hounde); otherEditor = await mk('rs_other', 'editor', ['editor'], mana); viewer = await mk('rs_viewer', 'viewer', ['viewer'], hounde);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const H = (t, extra) => ({ headers: Object.assign(t ? { 'x-report-token': t } : {}, extra || {}) });
const get = (p, t) => fetch(base + p, H(t));
const send = (m, p, t, body) => fetch(base + p, { method: m, ...H(t, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
let runId;

test('templates: 401 anonymous; seeded 3 visible; author flag; PUT gated (viewer 403, unknown dashboard 400, bad key 400); delete', async () => {
  assert.equal((await get('/api/report-studio/templates')).status, 401);
  const v = await (await get('/api/report-studio/templates', viewer)).json(); assert.equal(v.author, false); assert.equal(v.provider, 'off'); assert.deepEqual(v.templates.map(t => t.key).sort(), ['council-pack', 'exec-monthly-pack', 'site-weekly-pack']); assert.ok(v.dashboards.some(d => d.key === 'site-weekly'));
  assert.equal((await send('PUT', '/api/report-studio/templates', viewer, { key: 'x', name: 'X', dashboard_key: 'site-weekly' })).status, 403);
  assert.equal((await send('PUT', '/api/report-studio/templates', author, { key: 'x', name: 'X', dashboard_key: 'nope' })).status, 400);
  assert.equal((await send('PUT', '/api/report-studio/templates', author, { key: 'bad key', name: 'X', dashboard_key: 'site-weekly' })).status, 400);
  const t = await (await send('PUT', '/api/report-studio/templates', author, { key: 'tmp-pack', name: 'Tmp', dashboard_key: 'site-weekly', audience: 'site', cadence: 'manual', lang: 'fr' })).json(); assert.equal(t.template.lang, 'fr');
  assert.equal((await send('DELETE', '/api/report-studio/templates/tmp-pack', author)).status, 200);
  assert.equal((await send('DELETE', '/api/report-studio/templates/tmp-pack', editor)).status, 403);
});

test('generate: viewer 403, other-site editor 403 for Hounde, Hounde editor ok (site pack), author ok; figures never fabricated; outputs html/csv/xlsx/pptx', async () => {
  assert.equal((await send('POST', '/api/report-studio/templates/site-weekly-pack/generate', viewer, { site_id: hounde })).status, 403);
  assert.equal((await send('POST', '/api/report-studio/templates/site-weekly-pack/generate', otherEditor, { site_id: hounde })).status, 403);
  assert.equal((await send('POST', '/api/report-studio/templates/exec-monthly-pack/generate', editor, {})).status, 403, 'a site editor cannot generate an executive pack');
  assert.equal((await send('POST', '/api/report-studio/templates/nope/generate', author, {})).status, 404);
  const r = await (await send('POST', '/api/report-studio/templates/site-weekly-pack/generate', editor, { site_id: hounde })).json();
  assert.equal(r.ok, true); runId = r.run.id; assert.equal(r.run.status, 'draft'); assert.equal(r.run.site_id, hounde); assert.equal(r.run.html, undefined); assert.equal(r.run.provider, 'deterministic');
  assert.ok(Array.isArray(r.run.figures) && r.run.figures.length > 0); for (const f of r.run.figures) if ('value' in f) assert.ok(f.value === null || Number.isFinite(f.value), 'null or a real number, never a fabricated 0 string');
  assert.equal(r.run.commentary.source, 'deterministic'); assert.equal(r.run.commentary.verified, true); assert.ok(r.run.analysis.headline.length > 10);
  const a2 = await (await send('POST', '/api/report-studio/templates/exec-monthly-pack/generate', author, {})).json(); assert.equal(a2.ok, true); assert.equal(a2.run.site_id, null, 'executive pack is fleet-wide');
  const html = await get(`/api/report-studio/runs/${runId}.html`, author); assert.equal(html.status, 200); const body = await html.text(); assert.ok(body.includes('<!DOCTYPE html') || body.includes('<html')); assert.ok(body.includes(r.run.analysis.headline.slice(0, 20)));
  const csv = await get(`/api/report-studio/runs/${runId}.csv`, author); assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/); assert.ok((await csv.text()).length > 20);
  const xlsx = await get(`/api/report-studio/runs/${runId}.xlsx`, author); assert.equal(xlsx.status, 200); assert.ok(Buffer.from(await xlsx.arrayBuffer()).slice(0, 2).toString() === 'PK');
  const pptx = await get(`/api/report-studio/runs/${runId}.pptx`, author); assert.equal(pptx.status, 200); assert.ok(Buffer.from(await pptx.arrayBuffer()).slice(0, 2).toString() === 'PK');
});

test('visibility: a draft is author-only (viewer 403); runs list for the viewer shows published runs of their sites only', async () => {
  assert.equal((await get(`/api/report-studio/runs/${runId}`, viewer)).status, 403);
  assert.equal((await get(`/api/report-studio/runs/${runId}`, editor)).status, 403, 'the site editor who generated it still needs the author role to read drafts');
  const l = await (await get('/api/report-studio/runs', viewer)).json(); assert.equal(l.author, false); assert.equal(l.runs.length, 0);
  const la = await (await get('/api/report-studio/runs?template=site-weekly-pack', author)).json(); assert.equal(la.runs.length, 1); assert.equal(la.runs[0].html, undefined); assert.ok(la.runs[0].html_bytes > 100);
});

test('review flow: publish refused before human review (409); review needs author; rating clamps; publish → visible to the site viewer, not to another site; commentary frozen', async () => {
  assert.equal((await send('POST', `/api/report-studio/runs/${runId}/publish`, author)).status, 409);
  assert.equal((await send('POST', `/api/report-studio/runs/${runId}/review`, editor, { status: 'reviewed' })).status, 403);
  assert.equal((await send('POST', `/api/report-studio/runs/${runId}/review`, author, { status: 'maybe' })).status, 400);
  const c = await (await send('PUT', `/api/report-studio/runs/${runId}/commentary`, author, { text: 'Human wording 71.4' })).json(); assert.equal(c.run.commentary.source, 'human'); assert.equal(c.run.commentary.text, 'Human wording 71.4');
  const rg = await (await send('POST', `/api/report-studio/runs/${runId}/commentary/regenerate`, author)).json(); assert.equal(rg.commentary.source, 'deterministic');
  const rv = await (await send('POST', `/api/report-studio/runs/${runId}/review`, author, { status: 'reviewed', note: 'ok', rating: 7 })).json(); assert.equal(rv.run.status, 'reviewed'); assert.equal(rv.run.rating, 5);
  const pb = await (await send('POST', `/api/report-studio/runs/${runId}/publish`, admin)).json(); assert.equal(pb.run.status, 'published'); assert.ok(pb.run.published_at);
  assert.equal((await get(`/api/report-studio/runs/${runId}`, viewer)).status, 200);
  const mv = await mkToken('rs_mana_viewer', ['viewer'], mana); assert.equal((await get(`/api/report-studio/runs/${runId}`, mv)).status, 403, 'another site cannot read a Hounde pack');
  assert.equal((await send('PUT', `/api/report-studio/runs/${runId}/commentary`, author, { text: 'late edit' })).status, 409);
  const html = await (await get(`/api/report-studio/runs/${runId}.html`, viewer)).text(); assert.ok(html.length > 500);
  const st = await (await get('/api/report-studio/stats', author)).json(); assert.equal(st.rated, 1); assert.equal(st.useful_pct, 100);
  assert.equal((await get('/api/report-studio/stats', viewer)).status, 403);
});
async function mkToken(u, roles, site) { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', role: roles[0], roles, site_id: site }); } catch {} return (await rdb.login(u, u + 'pass1234')).token; }
