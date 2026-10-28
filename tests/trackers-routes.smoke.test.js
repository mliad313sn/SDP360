'use strict';
const fetch = require('./_http-fetch');
// Step 7 — /api/trackers on sqlite: templates seeded, builder gate, validation 400, publish/version/rollback,
// entries with unit scope + month lock, exports, legacy compare/import, cut-over switch (super_admin).
const _os = require('os'), _fs = require('fs'), _path = require('path');
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'trk-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'trk-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'trk-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'trk-smoke-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, admin, editor, viewer, superT, rdb;
const YEAR = new Date().getUTCFullYear();
const DEF = { key: 'smoke-1', name: 'Smoke', version: 1, period: { kind: 'monthly', start: String(YEAR), count: 12 }, units: [{ code: 'HGO', name: 'Houndé' }, { code: 'MGO', name: 'Mana' }], ragPolicy: 'tracker-activity',
  groups: [{ code: 'G1', name: 'A', weight: 1, items: [{ code: 'G1-01', name: 'Visits', kpiType: 'COUNT', weight: 1, target: 12, start: 1, end: 12 }] }] };

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  const tdb = require('../tracker-db');
  for (let i = 0; i < 50; i++) { if ((await tdb.getDB().prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'tracker_definitions'").get()) && (await tdb.getDB().prepare("SELECT 1 FROM tracker_definitions WHERE key='tpl-field-dispatch'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = (await rdb.listSites({ includeInactive: true }));
  const hounde = sites.find((s) => /hounde/i.test(s.name)).id;
  try { await rdb.createUser({ username: 'tk_admin', full_name: 'A', password: 'adminpass1234', role: 'admin', roles: ['admin'] }); } catch {}
  try { await rdb.createUser({ username: 'tk_super', full_name: 'S', password: 'superpass1234', role: 'super_admin', roles: ['super_admin'] }); } catch {}
  try { await rdb.createUser({ username: 'tk_editor', full_name: 'E', password: 'editorpass1234', role: 'editor', roles: ['editor', 'tracker-editor'], site_id: hounde }); } catch {}
  try { await rdb.createUser({ username: 'tk_viewer', full_name: 'V', password: 'viewerpass1234', role: 'viewer', roles: ['viewer'], site_id: hounde }); } catch {}
  admin = (await rdb.login('tk_admin', 'adminpass1234')).token; superT = (await rdb.login('tk_super', 'superpass1234')).token;
  editor = (await rdb.login('tk_editor', 'editorpass1234')).token; viewer = (await rdb.login('tk_viewer', 'viewerpass1234')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const H = (t, extra) => ({ headers: Object.assign(t ? { 'x-report-token': t } : {}, extra || {}) });
const get = (p, t) => fetch(base + p, H(t));
const send = (m, p, t, body) => fetch(base + p, { method: m, ...H(t, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });

test('list + catalogue: 401 anonymous, templates visible to builders only, catalogue carries KPI types + metrics', async () => {
  assert.equal((await get('/api/trackers')).status, 401);
  const a = await (await get('/api/trackers', admin)).json(); assert.ok(a.builder); assert.ok(a.trackers.some(t => t.key === 'tpl-field-dispatch' && t.template));
  const v = await (await get('/api/trackers', viewer)).json(); assert.equal(v.builder, false); assert.equal(v.trackers.filter(t => t.template).length, 0);
  const c = await (await get('/api/trackers/catalogue', viewer)).json(); assert.ok(c.kpiTypes.COUNT); assert.ok(c.metrics.some(m => m.key === 'inspection.count')); assert.ok(c.policies['tracker-activity']);
  assert.equal((await (await get('/api/trackers/templates', editor)).json()).templates.length, 4);
});

test('builder gate + validation + publish/version/rollback', async () => {
  assert.equal((await send('PUT', '/api/trackers/smoke-1', editor, { definition: DEF })).status, 403);
  const bad = await send('PUT', '/api/trackers/smoke-1', admin, { definition: { ...DEF, groups: [{ ...DEF.groups[0], weight: 0.4 }] } });
  assert.equal(bad.status, 400); assert.ok((await bad.json()).errors.some(e => /sum to 1/.test(e.msg)));
  assert.equal((await send('PUT', '/api/trackers/smoke-1', admin, { definition: { ...DEF, key: 'other' } })).status, 400);
  const ok = await (await send('PUT', '/api/trackers/smoke-1', admin, { definition: DEF, rfi_ref: 'RFI-2026-010' })).json(); assert.equal(ok.tracker.status, 'draft'); assert.equal(ok.tracker.rfi_ref, 'RFI-2026-010');
  assert.equal((await get('/api/trackers/smoke-1', viewer)).status, 404, 'a draft is invisible to non-builders');
  const dry = await (await send('POST', '/api/trackers/smoke-1/dry-run', admin, { definition: DEF })).json(); assert.ok(dry.result.units.HGO);
  const pub = await (await send('POST', '/api/trackers/smoke-1/publish', admin, { note: 'v1' })).json(); assert.equal(pub.tracker.version, 1);
  const seen = await (await get('/api/trackers/smoke-1', viewer)).json(); assert.equal(seen.published.key, 'smoke-1'); assert.deepEqual(seen.writable, []);
  await send('PUT', '/api/trackers/smoke-1', admin, { definition: { ...DEF, name: 'Smoke v2' } });
  await send('POST', '/api/trackers/smoke-1/publish', admin, {});
  const vs = await (await get('/api/trackers/smoke-1/versions', admin)).json(); assert.equal(vs.versions.length, 2);
  const rb = await (await send('POST', '/api/trackers/smoke-1/rollback/1', admin)).json(); assert.equal(rb.tracker.definition.name, 'Smoke');
  assert.equal((await get('/api/trackers/smoke-1/versions', editor)).status, 403);
});

test('entries: editor writes own unit only, closed months blocked, super_admin unlocked, score + exports', async () => {
  const month = new Date().getUTCMonth() + 1;
  const e = await (await get('/api/trackers/smoke-1/entries', editor)).json(); assert.deepEqual(e.writable, ['HGO']);
  assert.equal((await send('PUT', '/api/trackers/smoke-1/entries', viewer, { cells: [{ unit: 'HGO', item: 'G1-01', slot: month, value: 1 }] })).status, 403);
  const r = await (await send('PUT', '/api/trackers/smoke-1/entries', editor, { cells: [{ unit: 'HGO', item: 'G1-01', slot: month, value: 4 }, { unit: 'MGO', item: 'G1-01', slot: month, value: 9 }] })).json();
  assert.equal(r.saved, 1); assert.equal(r.rejected, 1);
  if (month > 2) {
    const b = await (await send('PUT', '/api/trackers/smoke-1/entries', editor, { cells: [{ unit: 'HGO', item: 'G1-01', slot: 1, value: 7 }] })).json(); assert.equal(b.blocked, 1); assert.equal(b.saved, 0);
    const s = await (await send('PUT', '/api/trackers/smoke-1/entries', superT, { cells: [{ unit: 'HGO', item: 'G1-01', slot: 1, value: 7 }] })).json(); assert.equal(s.saved, 1);
  }
  const t = await (await send('PUT', '/api/trackers/smoke-1/targets', editor, { targets: [{ unit: 'HGO', item: 'G1-01', target: 24 }, { unit: 'MGO', item: 'G1-01', target: 1 }] })).json(); assert.equal(t.saved, 1);
  const sc = await (await get('/api/trackers/smoke-1/score?period=' + month, viewer)).json(); assert.equal(sc.result.units.HGO.items['G1-01'].target, 24); assert.ok(sc.result.units.HGO.score != null);
  const x = await get('/api/trackers/smoke-1/export.xlsx', viewer); assert.equal(x.status, 200); assert.match(x.headers.get('content-type'), /spreadsheetml/);
  const p = await get('/api/trackers/smoke-1/export.pptx', viewer); assert.equal(p.status, 200); assert.ok((await p.arrayBuffer()).byteLength > 10000);
  const sy = await (await send('POST', '/api/trackers/smoke-1/sync', admin, {})).json(); assert.equal(sy.ok, true); assert.equal(sy.saved, 0, 'no bound item');
  const imp = await fetch(base + '/api/trackers/smoke-1/import', { method: 'POST', headers: { 'x-report-token': editor, 'content-type': 'application/octet-stream' }, body: Buffer.from(await x.arrayBuffer()) });
  assert.equal(imp.status, 200); const ij = await imp.json(); assert.equal(ij.rejected, 0);
});

test('legacy: compare passes ±0.1 pt, import creates a draft with entries, cut-over is super_admin only', async () => {
  const cr = await get('/api/trackers/legacy/compare?year=2026', admin); const c = await cr.json(); assert.equal(c.pass, true, 'HTTP ' + cr.status + ' ' + JSON.stringify(c).slice(0, 300)); assert.ok(c.rows.length >= 60);
  const csv = await get('/api/trackers/legacy/compare?year=2026&format=csv', admin); assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(await csv.text(), /^site,month/);
  assert.equal((await get('/api/trackers/legacy/compare?year=2026', editor)).status, 403);
  const imp = await (await send('POST', '/api/trackers/legacy/import?year=2026', admin, {})).json(); assert.equal(imp.key, 'it-activity-2026'); assert.ok(imp.entries.saved > 50); assert.equal(imp.status, 'draft');
  assert.equal((await send('PUT', '/api/trackers/legacy/cutover', admin, { cutover: true })).status, 403);
  const onr = await send('PUT', '/api/trackers/legacy/cutover', superT, { cutover: true }); const on = await onr.json(); assert.equal(on.cutover, true, 'HTTP ' + onr.status + ' ' + JSON.stringify(on));
  assert.equal((await (await get('/api/trackers/legacy/cutover', admin)).json()).cutover, true);
  await send('PUT', '/api/trackers/legacy/cutover', superT, { cutover: false });
  await send('POST', '/api/trackers/it-activity-2026/retire', admin); assert.equal((await send('DELETE', '/api/trackers/it-activity-2026', admin)).status, 200);
});
