'use strict';
const fetch = require('./_http-fetch');
// Step 6 — /api/dashboards on sqlite: seeded list, one-call data for the executive home,
// publisher gate, validation 400, publish/version, view log once per day, scope.
const _os = require('os'), _fs = require('fs'), _path = require('path');
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'dash-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'dash-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'dash-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'dash-smoke-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, admin, editor, viewer, siteId, otherSite, rdb;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  // the boot block seeds asynchronously — wait until the store has the executive home
  for (let i = 0; i < 50; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'dashboard_definitions'").get()) && (await rdb.db.prepare("SELECT 1 FROM dashboard_definitions WHERE key='exec-home'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = (await rdb.listSites({ includeInactive: true }));
  siteId = sites.find((s) => /hounde/i.test(s.name)).id; otherSite = sites.find((s) => s.id !== siteId).id;
  try { await rdb.createUser({ username: 'dx_admin', full_name: 'A', password: 'adminpass1234', role: 'admin', roles: ['admin'] }); } catch {}
  try { await rdb.createUser({ username: 'dx_editor', full_name: 'E', password: 'editorpass1234', role: 'editor', roles: ['editor', 'dashboard-publisher'], site_id: siteId }); } catch {}
  try { await rdb.createUser({ username: 'dx_viewer', full_name: 'V', password: 'viewerpass1234', role: 'viewer', roles: ['viewer'], site_id: siteId }); } catch {}
  admin = (await rdb.login('dx_admin', 'adminpass1234')).token;
  editor = (await rdb.login('dx_editor', 'editorpass1234')).token;
  viewer = (await rdb.login('dx_viewer', 'viewerpass1234')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const H = (t, extra) => ({ headers: Object.assign(t ? { 'x-report-token': t } : {}, extra || {}) });
const get = (p, t) => fetch(base + p, H(t));
const send = (m, p, t, body) => fetch(base + p, { method: m, ...H(t, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });

test('list: 401 anonymous; seeded dashboards visible; viewer sees published only, publisher flag false', async () => {
  assert.equal((await get('/api/dashboards')).status, 401);
  const j = await (await get('/api/dashboards', viewer)).json();
  assert.equal(j.publisher, false);
  const keys = j.dashboards.map(d => d.key);
  for (const k of ['exec-home', 'site-weekly', 'assets-hygiene', 'field-site']) assert.ok(keys.includes(k), k);
  assert.ok(j.dashboards.every(d => d.status === 'published' && d.version === 1));
});

test('data: executive home resolves every widget in one call, dated, null ≠ 0, scoped to the viewer site', async () => {
  const r = await get('/api/dashboards/exec-home/data', viewer); assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.site, siteId); assert.deepEqual(j.sites.map(s => s.id), [siteId]);
  assert.match(j.as_of, /^\d{4}-\d{2}-\d{2}T/);
  const w = j.widgets;
  assert.equal(w['k-tracker'].mode, 'single'); assert.equal(w['tr-sla'].mode, 'series'); assert.equal(w['tr-sla'].points.length, 13);
  assert.equal(w['sites'].mode, 'per-site'); assert.equal(w['sites'].rows.length, 1);
  assert.equal(w['acts'].mode, 'actions'); assert.ok(Array.isArray(w['acts'].items));
  assert.ok(Object.values(w).every(x => !('value' in x) || x.value === null || typeof x.value === 'number'));
  // another site is refused to a site-scoped account, open to admin
  assert.equal((await get(`/api/dashboards/exec-home/data?site=${otherSite}`, viewer)).status, 403);
  const a = await (await get(`/api/dashboards/exec-home/data?site=${otherSite}`, admin)).json();
  assert.ok(a.sites.length >= 2); assert.equal(a.site, otherSite);
});

test('publisher gate: viewer cannot save; publisher saves a draft (own site), invalid definition → 400, publish → version 1', async () => {
  const def = { key: 'hgo-test', title: 'HGO test', audience: 'site', grid: { columns: 12 }, widgets: [{ id: 'a', type: 'kpi', metric: 'assets.total', title: 'Assets', layout: { x: 0, y: 0, w: 3, h: 2 } }] };
  assert.equal((await send('PUT', '/api/dashboards/hgo-test', viewer, { definition: def })).status, 403);
  assert.equal((await get('/api/dashboards/catalogue', viewer)).status, 403);
  const cat = await (await get('/api/dashboards/catalogue', editor)).json(); assert.ok(cat.metrics.length >= 40 && cat.widgetTypes.kpi);
  const bad = await send('PUT', '/api/dashboards/hgo-test', editor, { definition: { ...def, widgets: [{ ...def.widgets[0], metric: 'x.y' }] } });
  assert.equal(bad.status, 400); assert.ok((await bad.json()).errors.length);
  const ok = await send('PUT', '/api/dashboards/hgo-test', editor, { definition: def, site_id: otherSite });
  assert.equal(ok.status, 200); const saved = (await ok.json()).dashboard;
  assert.equal(saved.status, 'draft'); assert.equal(saved.site_id, siteId, 'a site-scoped publisher cannot pin a dashboard to another site');
  assert.equal((await get('/api/dashboards/hgo-test', viewer)).status, 404, 'a draft is invisible to viewers');
  // G-24 four-eyes: the owner submits; the owner cannot publish their own submission; the admin tier reviews and publishes
  assert.equal((await send('POST', '/api/dashboards/hgo-test/publish', editor, { note: 'go' })).status, 409, 'not submitted');
  assert.equal((await send('POST', '/api/dashboards/hgo-test/submit', viewer)).status, 403);
  assert.equal((await (await send('POST', '/api/dashboards/hgo-test/submit', editor)).json()).dashboard.review_state, 'submitted');
  const self = await send('POST', '/api/dashboards/hgo-test/publish', editor, { note: 'go' }); assert.equal(self.status, 409); assert.equal((await self.json()).code, 'SOD_PUBLISH_SUBMITTER');
  assert.equal((await send('POST', '/api/dashboards/hgo-test/publish', editor, { note: 'go', override_reason: 'I am sure about this one' })).status, 409, 'override is admin-only');
  const pub = await send('POST', '/api/dashboards/hgo-test/publish', admin, { note: 'go' }); assert.equal(pub.status, 200);
  assert.equal((await pub.json()).dashboard.version, 1);
  assert.equal((await get('/api/dashboards/hgo-test', viewer)).status, 200);
  const vs = await (await get('/api/dashboards/hgo-test/versions', editor)).json(); assert.equal(vs.versions[0].note, 'go');
  assert.equal((await send('DELETE', '/api/dashboards/hgo-test', editor)).status, 409, 'retire before delete');
  assert.equal((await send('POST', '/api/dashboards/hgo-test/retire', editor)).status, 200);
  assert.equal((await send('DELETE', '/api/dashboards/hgo-test', editor)).status, 409, 'ever published → retired, never deleted');
  assert.equal((await get('/api/dashboards/hgo-test/versions', editor)).status, 200, 'its versions survive');
});

test('a field dashboard that is not phone-ready cannot be published', async () => {
  const def = { key: 'field-bad', title: 'Field bad', audience: 'field', grid: { columns: 12 }, widgets: [{ id: 'h', type: 'heatmap', metric: 'assets.total', layout: { x: 0, y: 0, w: 6, h: 3 } }] };
  assert.equal((await send('PUT', '/api/dashboards/field-bad', admin, { definition: def })).status, 200);
  const r = await send('POST', '/api/dashboards/field-bad/publish', admin, { override_reason: 'field readiness check comes first' }); assert.equal(r.status, 400); assert.match((await r.json()).issues.join(' '), /heatmap/);
});

test('view log: one dashboard_viewed event per actor per day', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await send('POST', '/api/dashboards/exec-home/view', viewer)).status, 200);
  await new Promise(r => setTimeout(r, 150));
  const n = (await rdb.db.prepare("SELECT COUNT(*) AS n FROM system_log WHERE action='dashboard_viewed' AND target='exec-home' AND actor='dx_viewer'").get()).n;
  assert.equal(n, 1);
});

test('G-24 rollback: restores an old version as the draft; the live snapshot keeps serving until reviewed and published', async () => {
  const mk = (title) => ({ key: 'rb-test', title, audience: 'site', grid: { columns: 12 }, widgets: [{ id: 'a', type: 'kpi', metric: 'assets.total', title: 'Assets', layout: { x: 0, y: 0, w: 3, h: 2 } }] });
  const pubAs = async (title) => {
    assert.equal((await send('PUT', '/api/dashboards/rb-test', editor, { definition: mk(title) })).status, 200);
    assert.equal((await send('POST', '/api/dashboards/rb-test/submit', editor)).status, 200);
    const r = await send('POST', '/api/dashboards/rb-test/publish', admin, { note: title }); assert.equal(r.status, 200); return (await r.json()).dashboard;
  };
  await pubAs('First'); const v2 = await pubAs('Second'); assert.equal(v2.version, 2);
  assert.equal((await send('POST', '/api/dashboards/rb-test/rollback/9', editor)).status, 404);
  assert.equal((await send('POST', '/api/dashboards/rb-test/rollback/1', viewer)).status, 403);
  const rb = (await (await send('POST', '/api/dashboards/rb-test/rollback/1', editor)).json()).dashboard;
  assert.equal(rb.definition.title, 'First'); assert.equal(rb.review_state, null); assert.equal(rb.updated_by != null, true);
  const live = await (await get('/api/dashboards/rb-test', viewer)).json();
  assert.equal(JSON.stringify(live).includes('Second'), true, 'viewers still see version 2');
  assert.equal((await send('POST', '/api/dashboards/rb-test/publish', admin, {})).status, 409, 'the rolled-back draft goes through review again');
});
