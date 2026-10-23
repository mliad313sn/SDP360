'use strict';
const fetch = require('./_http-fetch');   // core-http shim (see tests/_http-fetch.js)
// Step 7 — /api/trackers/*: builder rights, draft → publish, entry on one's own unit, locks, linked items,
// Excel import (dry run then write), exports, migration of the IT Activity Tracker with its parallel run.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'trackers-routes-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'tk-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'tk-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'tk-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, tok = {}, siteA, siteB;
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const get = (p, t) => fetch(base + p, { headers: H(t) });
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: H(t), body: body ? JSON.stringify(body) : undefined });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const codes = await rdb.listSiteModuleCodes('meetings');
  siteA = codes[0]; siteB = codes[1];
  const mk = async (u, roles, extra = {}) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pass-0000', roles, ...extra });
    tok[u] = (await rdb.login(u, u + '-pass-0000')).token;
  };
  await mk('tk-viewer', ['viewer']);
  await mk('tk-author', ['viewer', 'tracker-author']);
  await mk('tk-pub', ['viewer', 'tracker-publisher']);
  await mk('tk-editA', ['editor'], { site_id: siteA.site_id });
  await mk('tk-sa', ['super_admin']);
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const definition = () => ({
  id: 'field-dispatch', year: 2026, title: { fr: 'Dispatch terrain' },
  units: [{ code: 'UA', name: 'Site A', site_id: siteA.site_id }, { code: 'UB', name: 'Site B', site_id: siteB.site_id }],
  groups: [{ code: 'VOL', name: 'Volume', weight: 0.5 }, { code: 'SAT', name: 'Satisfaction', weight: 0.5 }],
  items: [{ code: 'INT', name: 'Interventions', group: 'VOL', kpi: 'COUNT', weight: 1 }, { code: 'NOTE', name: 'Note', group: 'SAT', kpi: 'RATING', weight: 1 },
    { code: 'PV', name: 'PV tenus', group: 'VOL', kpi: 'COUNT', weight: 0.5, source: { metric: 'meetings.pvs_held' } }],
  targets: { UA: { INT: { target: '120', active: true }, NOTE: { target: '4', active: true }, PV: { target: '12', active: true } }, UB: { INT: { target: '120', active: true }, NOTE: { target: '4', active: true } } },
  audience: { roles: ['any'], site_scope: 'all' }, entry: { roles: ['editor'], own_unit_only: true },
});

test('builder: rights, validation, dry run, draft → publish → rollback', async () => {
  assert.equal((await fetch(base + '/api/trackers')).status, 401);
  assert.equal((await send('POST', '/api/trackers', tok['tk-viewer'], { definition: definition() })).status, 403, 'not an author');
  assert.equal((await send('POST', '/api/trackers', tok['tk-author'], { definition: { ...definition(), items: [] } })).status, 400);
  const pv = await (await send('POST', '/api/trackers/preview', tok['tk-author'], { definition: { ...definition(), groups: [{ code: 'VOL', weight: 0.5 }, { code: 'SAT', weight: 0.2 }] } })).json();
  assert.ok(pv.ok && pv.warnings.some(w => /70 %/.test(w)) && pv.units.length === 2, 'warnings + dry run');
  assert.equal((await send('POST', '/api/trackers', tok['tk-author'], { definition: definition() })).status, 201);
  assert.equal((await get('/api/trackers/field-dispatch', tok['tk-viewer'])).status, 404, 'a draft is not on air');
  assert.equal((await send('POST', '/api/trackers/field-dispatch/publish', tok['tk-author'])).status, 403, 'an author does not publish');
  const p1 = await (await send('POST', '/api/trackers/field-dispatch/publish', tok['tk-pub'], { note: 'v1' })).json();
  assert.equal(p1.version, 1);
  const d2 = definition(); d2.title = { fr: 'Dispatch terrain v2' };
  assert.equal((await send('PUT', '/api/trackers/field-dispatch/draft', tok['tk-author'], { definition: d2 })).status, 200);
  assert.equal((await (await send('POST', '/api/trackers/field-dispatch/publish', tok['tk-pub'])).json()).version, 2);
  const rb = await (await send('POST', '/api/trackers/field-dispatch/rollback', tok['tk-pub'], { version: 1 })).json();
  assert.equal(rb.version, 3);
  const t = await (await get('/api/trackers/field-dispatch', tok['tk-viewer'])).json();
  assert.equal(t.published.version, 3);
  assert.equal(t.published.definition.title.fr, 'Dispatch terrain', 'rollback republished v1');
  assert.equal((await send('DELETE', '/api/trackers/field-dispatch', tok['tk-author'])).status, 409, 'a published tracker is retired, not deleted');
  const tpl = await send('POST', '/api/trackers', tok['tk-author'], { template: 'maintenance-site', id: 'site-maint', year: 2026 });
  assert.equal(tpl.status, 201, 'created from a template');
});

test('entry: own unit only, never a linked item, never a locked month; scores read the same engine', async () => {
  const t = await (await get('/api/trackers/field-dispatch', tok['tk-editA'])).json();
  assert.deepStrictEqual(t.writable_units, ['UA']);
  assert.deepStrictEqual((await get('/api/trackers/field-dispatch', tok['tk-viewer']).then(r => r.json())).writable_units, [], 'a viewer reads only');
  const r = await (await send('POST', '/api/trackers/field-dispatch/entries', tok['tk-editA'], { year: 2026, cells: [
    { unit: 'UA', item: 'INT', month: 1, value: 10 }, { unit: 'UA', item: 'INT', month: 2, value: 12 },
    { unit: 'UB', item: 'INT', month: 1, value: 99 }, { unit: 'UA', item: 'PV', month: 1, value: 5 }, { unit: 'UA', item: 'INT', month: 13, value: 1 },
  ] })).json();
  assert.equal(r.written, 2);
  assert.deepStrictEqual(r.refused.map(x => x.reason), ['not your unit', 'computed from the dictionary', 'month 1-12']);
  assert.equal((await send('POST', '/api/trackers/field-dispatch/locks', tok['tk-editA'], { year: 2026, month: 2 })).status, 403, 'only a publisher locks');
  assert.equal((await send('POST', '/api/trackers/field-dispatch/locks', tok['tk-pub'], { year: 2026, month: 2, locked: true })).status, 200);
  const locked = await send('POST', '/api/trackers/field-dispatch/entries', tok['tk-editA'], { year: 2026, cells: [{ unit: 'UA', item: 'INT', month: 2, value: 50 }] });
  assert.equal(locked.status, 403);
  assert.equal((await locked.json()).refused[0].reason, 'month locked');
  const after = await (await get('/api/trackers/field-dispatch', tok['tk-viewer'])).json();
  assert.deepStrictEqual(after.values.UA.INT.slice(0, 3), [10, 12, 0]);
  assert.deepStrictEqual(after.locks.map(l => l.month), [2]);
  const ref = await (await send('POST', '/api/trackers/field-dispatch/refresh-sources', tok['tk-pub'], {})).json();
  assert.ok(ref.cells >= 0 && Array.isArray(ref.skipped), 'linked items recomputed from the dictionary');
  const log = await rdb.listSystemLog({ action: 'tracker_entries_saved' });
  assert.ok((log.rows || log).some(x => x.actor === 'tk-editA'), 'entries are journalled');
});

test('Excel: dry run then import, refused cells reported; exports carry the engine scores', async () => {
  const x = await get('/api/trackers/field-dispatch/export.xlsx?year=2026&month=3', tok['tk-viewer']);
  assert.equal(x.status, 200);
  const XLSX = require('xlsx');
  const wb = XLSX.read(Buffer.from(await x.arrayBuffer()), { type: 'buffer' });
  assert.deepStrictEqual(wb.SheetNames, ['Synthèse', 'Saisies']);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Saisies']);
  const ua = rows.find(r => r['Unité'] === 'UA' && r['Code élément'] === 'INT');
  assert.equal(ua.M1, 10);
  assert.equal(ua.Cumul, 22, 'year to date from the engine');
  const up = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(up, XLSX.utils.json_to_sheet([{ 'Unité': 'UA', 'Code élément': 'NOTE', M1: 4, M2: 5, M3: 3 }, { 'Unité': 'UB', 'Code élément': 'NOTE', M1: 2 }]), 'Saisies');
  const file = XLSX.write(up, { type: 'base64', bookType: 'xlsx' });
  const dry = await (await send('POST', '/api/trackers/field-dispatch/import', tok['tk-editA'], { year: 2026, file, dry: true })).json();
  assert.equal(dry.written, 0); assert.equal(dry.accepted, 2, 'M1 and M3 (M2 is locked)');
  assert.deepStrictEqual(dry.refused.map(r => r.reason).sort(), ['month locked', 'not your unit']);
  const wet = await (await send('POST', '/api/trackers/field-dispatch/import', tok['tk-editA'], { year: 2026, file })).json();
  assert.equal(wet.written, 2);
  assert.equal((await send('POST', '/api/trackers/field-dispatch/import', tok['tk-editA'], { year: 2026, file: 'bm90IGEgd29ya2Jvb2s=' })).status, 400);
  const deck = await get('/api/trackers/field-dispatch/export.pptx?year=2026&month=3', tok['tk-viewer']);
  assert.equal(deck.status, 200);
  assert.ok(Buffer.from(await deck.arrayBuffer()).length > 10000);
});

test('migration of the IT Activity Tracker: super_admin only, identical engines, parallel run closes typing', async () => {
  assert.equal((await send('POST', '/api/trackers/legacy/import', tok['tk-pub'], { year: 2026 })).status, 403);
  const r = await (await send('POST', '/api/trackers/legacy/import', tok['tk-sa'], { year: 2026 })).json();
  assert.equal(r.id, 'it-activity-2026');
  assert.ok(r.comparison.accepted, JSON.stringify(r.comparison));
  assert.equal(r.comparison.max_gap_points, 0);
  const again = await (await send('POST', '/api/trackers/legacy/import', tok['tk-sa'], { year: 2026 })).json();
  assert.equal(again.version, r.version, 'an unchanged structure is not republished');
  const t = await (await get('/api/trackers/it-activity-2026', tok['tk-sa'])).json();
  assert.ok(t.published.definition.legacy_mirror);
  assert.deepStrictEqual(t.writable_units, [], 'parallel run: typing stays in the IT Activity Tracker');
  const cmp = await (await get('/api/trackers/legacy/compare?year=2026', tok['tk-sa'])).json();
  assert.ok(cmp.accepted);
  const mirror = await require('../services/trackers/service').mirrorAll(rdb);
  assert.deepStrictEqual(mirror.trackers.map(x => x.accepted), [true]);
});
