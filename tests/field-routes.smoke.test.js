'use strict';
const fetch = require('./_http-fetch');
// Step 10 — /api/field on sqlite: role gate, bootstrap scope, idempotent outbox PUT (same hash → duplicate,
// different payload → 409, another user → 403), tracker closed-month blocked, chunk upload → complete → blob ref →
// inspection applied with the photo, action transfer without justification rejected, ticket with write disabled rejected.
const _os = require('os'), _fs = require('fs'), _path = require('path');
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'field-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'field-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'field-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'field-smoke-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, admin, tech, other, viewer, rdb, idb, trkStore, hounde;
const YEAR = new Date().getUTCFullYear();
const DEF = { key: 'fld-1', name: 'Field tracker', version: 1, period: { kind: 'monthly', start: String(YEAR), count: 12 }, units: [{ code: 'HGO', name: 'Houndé' }, { code: 'MGO', name: 'Mana' }], ragPolicy: 'tracker-activity',
  groups: [{ code: 'G1', name: 'A', weight: 1, items: [{ code: 'G1-01', name: 'Visits', kpiType: 'COUNT', weight: 1, target: 12, start: 1, end: 12 }] }] };
const U = (n) => `2f1e4c3a-9b7d-4e21-a3f5-0c8d1e2f3a${String(n).padStart(2, '0')}`;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); idb = require('../inspection-db');
  const tdb = require('../tracker-db');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'field_outbox'").get()) && (await tdb.getDB().prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'tracker_definitions'").get()) && (await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'dashboard_definitions'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = (await rdb.listSites({ includeInactive: true }));
  hounde = sites.find((s) => /hounde/i.test(s.name)); const mana = sites.find((s) => /mana/i.test(s.name));
  const mk = async (u, role, roles, site) => { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', role, roles, site_id: site }); } catch {} return (await rdb.login(u, u + 'pass1234')).token; };
  admin = await mk('fd_admin', 'admin', ['admin']); tech = await mk('fd_tech', 'viewer', ['viewer', 'field-tech'], hounde.id); other = await mk('fd_other', 'editor', ['editor'], mana.id); viewer = await mk('fd_viewer', 'viewer', ['viewer'], hounde.id);
  trkStore = require('../routes/trackers').createStore(tdb);
  await trkStore.saveDraft(DEF, { user: { id: 1 } }); await trkStore.publish('fld-1', { user: { id: 1 } });
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const H = (t, extra) => ({ headers: Object.assign(t ? { 'x-report-token': t } : {}, extra || {}) });
const get = (p, t) => fetch(base + p, H(t));
const send = (m, p, t, body) => fetch(base + p, { method: m, ...H(t, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
const put = (n, t, env) => send('PUT', '/api/field/outbox/' + U(n), t, env);

test('bootstrap: 401 anonymous, 403 plain viewer, field-tech sees own site + lookups + writable tracker units + limits', async () => {
  assert.equal((await get('/api/field/bootstrap')).status, 401);
  assert.equal((await get('/api/field/bootstrap', viewer)).status, 403);
  const b = await (await get('/api/field/bootstrap', tech)).json();
  assert.equal(b.ok, true); assert.deepEqual(b.sites.map(s => s.id), [hounde.id]); assert.equal(b.sites[0].inspection_code, 'HGO');
  assert.ok(b.lookups && b.lookups.categories.length > 10); assert.equal(b.limits.photo_max_bytes, 300 * 1024); assert.equal(b.features.ticket, false);
  const t = b.trackers.find(x => x.key === 'fld-1'); assert.ok(t); assert.deepEqual(t.writable, ['HGO'], 'field-tech writes its own unit only');
  const a = await (await get('/api/field/bootstrap', admin)).json(); assert.ok(a.sites.length > 1); assert.equal(a.trackers.find(x => x.key === 'fld-1').writable, null);
});

test('outbox PUT: bad envelope 400, tracker applied once (replay = duplicate), other payload same uuid 409, other user 403, closed month blocked, other unit rejected', async () => {
  assert.equal((await put(1, tech, { kind: 'tracker' })).status, 400);
  const cur = new Date().getUTCMonth() + 1;
  const env = { kind: 'tracker', payload: { key: 'fld-1', cells: [{ unit: 'HGO', item: 'G1-01', slot: cur, value: 3 }] }, client_ts: new Date().toISOString(), device: 'test' };
  const r1 = await (await put(1, tech, env)).json(); assert.equal(r1.ok, true); assert.equal(r1.duplicate, false); assert.equal(r1.result.saved, 1);
  const r2 = await (await put(1, tech, env)).json(); assert.equal(r2.duplicate, true); assert.equal(r2.status, 'applied'); assert.deepEqual(r2.result, r1.result);
  assert.equal((await put(1, tech, { ...env, payload: { ...env.payload, cells: [{ ...env.payload.cells[0], value: 4 }] } })).status, 409);
  assert.equal((await put(1, other, env)).status, 403);
  assert.equal((await trkStore.entries('fld-1', { unit: 'HGO' })).rows.length, 1);
  if (cur > 2) { const old = await (await put(2, tech, { kind: 'tracker', payload: { key: 'fld-1', cells: [{ unit: 'HGO', item: 'G1-01', slot: 1, value: 9 }] } })).json(); assert.equal(old.result.blocked, 1, 'closed month kept as stored'); }
  const foreign = await (await put(3, tech, { kind: 'tracker', payload: { key: 'fld-1', cells: [{ unit: 'MGO', item: 'G1-01', slot: cur, value: 9 }] } })).json(); assert.equal(foreign.result.rejected, 1);
  const list = await (await get('/api/field/outbox', tech)).json(); assert.ok(list.items.length >= 2); assert.ok(list.items.every(i => i.status !== 'received'), 'no stuck ledger rows');
});

test('photo upload: over cap 400, chunks → complete → blob ref; inspection envelope with the upload is applied and the photo stored', async () => {
  assert.equal((await send('POST', '/api/field/uploads', tech, { owner_id: 'EM-IT-20261019-0001', mime: 'image/jpeg', size: 400 * 1024 })).status, 400);
  const bytes = Buffer.alloc(70 * 1024, 0x41);
  const up = (await (await send('POST', '/api/field/uploads', tech, { owner_id: 'EM-IT-20261019-0001', name: 'rack.jpg', mime: 'image/jpeg', size: bytes.length })).json()).upload;
  assert.equal(up.chunks_total, 2); assert.deepEqual(up.missing, [0, 1]);
  assert.equal((await send('POST', `/api/field/uploads/${up.id}/complete`, tech)).status, 400, 'cannot complete with chunks missing');
  assert.equal((await get(`/api/field/uploads/${up.id}`, other)).status, 404, 'another user cannot see it');
  for (const i of [1, 0]) { const c = await (await send('PUT', `/api/field/uploads/${up.id}/chunks/${i}`, tech, { data: bytes.subarray(i * up.chunk_bytes, (i + 1) * up.chunk_bytes).toString('base64') })).json(); assert.equal(c.ok, true); }
  const done = await (await send('POST', `/api/field/uploads/${up.id}/complete`, tech)).json(); assert.equal(done.upload.status, 'done'); assert.match(done.upload.ref, /^inspection\//);
  assert.equal((await (await send('POST', `/api/field/uploads/${up.id}/complete`, tech)).json()).duplicate, true);
  const meta = { f_id: 'EM-IT-20261019-0001', f_site: `${hounde.name} (HGO)`, f_date: '2026-10-19', f_area: 'dc', f_inspector: 'Tech', f_type: 'routine' };
  const inline = await put(10, tech, { kind: 'inspection', payload: { meta, items: { net__0: { status: 'ok', photos: [{ dataUrl: 'data:image/jpeg;base64,QUJD' }] } } } });
  assert.equal(inline.status, 400, 'inline data URLs are refused on the field path');
  const ok = await (await put(11, tech, { kind: 'inspection', payload: { meta, items: { net__0: { status: 'major', notes: 'hot', photos: [{ upload_id: up.id, caption: 'rack' }] } }, actions: [], status: 'submitted' } })).json();
  assert.equal(ok.ok, true); assert.equal(ok.result.inspection_id, 'EM-IT-20261019-0001');
  const rec = await idb.getInspection('EM-IT-20261019-0001'); assert.equal(rec.header.site_code, 'HGO'); assert.equal(rec.photos.length, 1); assert.equal(rec.photos[0].size_bytes, bytes.length);
  const wrong = await put(12, tech, { kind: 'inspection', payload: { meta: { ...meta, f_id: 'EM-IT-20261019-0002', f_site: 'Mana (MGO)' }, items: {} } }); assert.equal(wrong.status, 403, 'another site is refused');
});

test('actions + tickets: transfer without justification 400, close applied through the module writer, ticket rejected while write disabled (terminal, not a retry)', async () => {
  const a = await idb.saveInspection({ meta: { f_id: 'EM-IT-20261019-0009', f_site: `${hounde.name} (HGO)`, f_date: '2026-10-19', f_area: 'dc', f_inspector: 'T' }, items: {}, actions: [{ description: 'Replace UPS battery', owner: 'Tech', due: '2026-10-30', priority: 'High', status: 'Open' }] }, null, 1);
  const act = (await idb.listActions({ site: 'HGO' })).find(x => /UPS/.test(x.description)); assert.ok(act);
  assert.equal((await put(20, tech, { kind: 'action', payload: { source: 'inspection', id: act.id, status_change: 'cancelled' } })).status, 400);
  assert.equal((await put(21, other, { kind: 'action', payload: { source: 'inspection', id: act.id, status_change: 'Closed' } })).status, 403, 'Mana editor cannot touch a Hounde action');
  const r = await (await put(22, tech, { kind: 'action', payload: { source: 'inspection', id: act.id, status_change: 'Closed', body: 'done on site' } })).json(); assert.equal(r.ok, true);
  assert.equal((await idb.listActions({ site: 'HGO' })).find(x => x.id === act.id).status, 'Closed');
  const tk = await (await put(23, tech, { kind: 'ticket', payload: { subject: 'Printer offline' } })).json();
  assert.equal(tk.ok, false); assert.equal(tk.status, 'rejected'); assert.match(tk.result.error, /disabled/);
  const again = await (await put(23, tech, { kind: 'ticket', payload: { subject: 'Printer offline' } })).json(); assert.equal(again.duplicate, true); assert.equal(again.status, 'rejected');
});
