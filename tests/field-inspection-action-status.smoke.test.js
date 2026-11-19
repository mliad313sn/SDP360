'use strict';
const fetch = require('./_http-fetch');
// P11 round 2 (UX/field) — field + web write paths of INSPECTION corrective actions:
//  F-5: inspection actions take Open / In Progress / Closed / Cancelled only. The transfer statuses (demand,
//       helpdesk_ticket) belong to meetings issues/actions; on an inspection action they are refused (400) on the
//       field outbox AND the web register route, a case variant is stored in its canonical form, and the open /
//       overdue counts compare case-insensitively (a legacy lowercase 'cancelled' row is finished, not overdue).
//  F-6: the same-author replay exemption applies only when the stored inspection is EXACTLY what this payload
//       wrote (same full content, row not changed since) — never an un-submit, never a revert of a later edit.
//  F-2 residual: an envelope without base_status whose client_ts is missing or in the future loses to a
//       server-side status change (409), instead of trusting a clock the server cannot check.
const _os = require('os'), _fs = require('fs'), _path = require('path');
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'field-insp-status-'));
process.env.DASH_USER = process.env.DASH_USER || 'field-insp-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'field-insp-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'field-insp-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, tech, techId, editor, rdb, idb, hounde;
const U = (n) => `5b2e4c3a-9b7d-4e21-a3f5-0c8d1e2f3b${String(n).padStart(2, '0')}`;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); idb = require('../inspection-db');
  for (let i = 0; i < 60; i++) { if (await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'field_outbox'").get()) break; await new Promise(r => setTimeout(r, 100)); }
  hounde = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name));
  try { await rdb.createUser({ username: 'fis_tech', full_name: 'fis_tech', password: 'fis_techpass1234', role: 'viewer', roles: ['viewer', 'field-tech'], site_id: hounde.id }); } catch {}
  try { await rdb.createUser({ username: 'fis_editor', full_name: 'fis_editor', password: 'fis_editorpass1234', role: 'editor', roles: ['editor'], site_id: hounde.id }); } catch {}
  tech = (await rdb.login('fis_tech', 'fis_techpass1234')).token;
  editor = (await rdb.login('fis_editor', 'fis_editorpass1234')).token;
  techId = Number((await rdb.listUsers()).find((x) => x.username === 'fis_tech').id);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const put = (n, env) => fetch(base + '/api/field/outbox/' + U(n), { method: 'PUT', headers: { 'x-report-token': tech, 'content-type': 'application/json' }, body: JSON.stringify(env) });
const meta = (id, extra) => ({ f_id: id, f_site: `${hounde.name} (HGO)`, f_date: '2026-10-19', f_time: '09:00', f_area: 'dc', f_inspector: 'Tech', f_type: 'routine', ...extra });
const rowFull = (id) => rdb.db.prepare('SELECT status, state_json FROM insp_inspections WHERE id = ?').get(id);

let _seq = 0;
async function overdueAction(desc) {
  const id = 'EM-IT-20261001-S' + String(++_seq).padStart(3, '0');
  await idb.saveInspection({ meta: meta(id, {}), items: {}, actions: [{ description: desc, owner: 'Tech', due: '2026-01-10', priority: 'High', status: 'Open' }] }, null, 1);
  return (await idb.listActions({ site: 'HGO' })).find((x) => x.description === desc);
}
const stored = async (id) => (await idb.listActions({ site: 'HGO' })).find((x) => x.id === id);
const isOverdue = async (id) => (await idb.listActions({ site: 'HGO', overdue: true })).some((x) => x.id === id);

test('F-5: field "demand" / "helpdesk_ticket" on an INSPECTION action → 400 refused, status unchanged', async () => {
  for (const [n, st, extra] of [[1, 'demand', {}], [2, 'helpdesk_ticket', { helpdesk_ticket: '123456' }]]) {
    const act = await overdueAction('F5 field ' + st);
    const r = await put(n, { kind: 'action', author: 'fis_tech', payload: { source: 'inspection', id: act.id, base_status: 'Open', status_change: st, body: 'justification', ...extra } });
    assert.equal(r.status, 400, st + ' refused');
    const j = await r.json(); assert.equal(j.status, 'rejected'); assert.equal(j.result.reason, 'inspection_action_status');
    assert.equal((await stored(act.id)).status, 'Open', st + ': stored status unchanged');
  }
});

test('F-5: field "cancelled" (any case) on an inspection action is stored as Cancelled and leaves the overdue list', async () => {
  const act = await overdueAction('F5 field cancel');
  assert.equal(await isOverdue(act.id), true);
  const r = await put(3, { kind: 'action', author: 'fis_tech', payload: { source: 'inspection', id: act.id, base_status: 'Open', status_change: 'cancelled', body: 'not needed any more' } });
  assert.equal(r.status, 200);
  assert.equal((await stored(act.id)).status, 'Cancelled');
  assert.equal(await isOverdue(act.id), false);
});

test('F-5: web register route refuses a transfer status on an inspection action and normalises case', async () => {
  const act = await overdueAction('F5 web route');
  const post = (b) => fetch(base + '/api/inspection/actions/' + act.id + '/update', { method: 'POST', headers: { 'x-report-token': editor, 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const bad = await post({ status_change: 'demand', body: 'x' });
  assert.equal(bad.status, 400);
  assert.equal((await stored(act.id)).status, 'Open');
  const ok = await post({ status_change: 'in progress', body: 'started' });
  assert.equal(ok.status, 200);
  assert.equal((await stored(act.id)).status, 'In Progress');
});

test('F-5: saveInspection refuses an unknown action status and normalises a case variant', async () => {
  await assert.rejects(() => idb.saveInspection({ meta: meta('EM-IT-20261001-SV01', {}), items: {}, actions: [{ description: 'bad', status: 'demand' }] }, null, 1), (e) => e.code === 'VALIDATION');
  await idb.saveInspection({ meta: meta('EM-IT-20261001-SV02', {}), items: {}, actions: [{ description: 'F5 save case', due: '2026-01-10', status: 'closed' }] }, null, 1);
  const a = (await idb.listActions({ site: 'HGO' })).find((x) => x.description === 'F5 save case');
  assert.equal(a.status, 'Closed');
});

test('F-5: open / overdue counts treat a legacy lowercase terminal status as finished', async () => {
  const act = await overdueAction('F5 legacy lowercase');
  const agg0 = await idb.aggregate({ site: 'HGO' });
  await rdb.db.prepare("UPDATE insp_actions SET status = 'cancelled' WHERE id = ?").run(act.id);
  assert.equal(await isOverdue(act.id), false, 'lowercase cancelled is not overdue');
  const agg1 = await idb.aggregate({ site: 'HGO' });
  assert.equal(agg1.overdue_actions, agg0.overdue_actions - 1);
  assert.equal(agg1.open_actions, agg0.open_actions - 1);
});

test('F-6: same author, same meta, different items on its own SUBMITTED inspection → 409, row unchanged', async () => {
  const m = meta('EM-IT-20261019-R604', { f_obs: 'mine' });
  await idb.saveInspection({ meta: m, items: { net__0: { status: 'critical', notes: 'rack on fire' } }, actions: [], status: 'submitted' }, ['HGO'], techId);
  const before = await rowFull(m.f_id);
  const r = await put(10, { kind: 'inspection', author: 'fis_tech', payload: { meta: m, items: { net__0: { status: 'ok', notes: 'all fine' } } } });
  assert.equal(r.status, 409);
  assert.deepEqual(await rowFull(m.f_id), before);
});

test('F-6: identical replay after a coordinator edited the record → 409, the coordinator edit kept', async () => {
  const m = meta('EM-IT-20261019-R605', { f_obs: 'mine2' });
  const orig = { meta: m, items: { net__0: { status: 'minor', notes: 'tech' } }, status: 'submitted' };
  await idb.saveInspection(JSON.parse(JSON.stringify(orig)), ['HGO'], techId);
  await idb.saveInspection({ meta: m, items: { net__0: { status: 'critical', notes: 'COORDINATOR raised severity' } }, status: 'submitted' }, null, 1);
  const before = await rowFull(m.f_id);
  const r = await put(11, { kind: 'inspection', author: 'fis_tech', payload: orig });
  assert.equal(r.status, 409);
  assert.deepEqual(await rowFull(m.f_id), before);
});

test('F-6: an identical replay of the unchanged own capture still applies', async () => {
  const m = meta('EM-IT-20261019-R606', { f_obs: 'mine3' });
  const orig = { meta: m, items: { net__0: { status: 'minor', notes: 'tech' } }, status: 'submitted' };
  await idb.saveInspection(JSON.parse(JSON.stringify(orig)), ['HGO'], techId);
  const r = await put(12, { kind: 'inspection', author: 'fis_tech', payload: orig });
  assert.equal(r.status, 200);
});

test('F-2 residual: no base_status + future or missing client_ts after a server status change → 409', async () => {
  for (const [n, ts] of [[20, '2099-01-01T00:00:00.000Z'], [21, undefined]]) {
    const act = await overdueAction('F2r ' + n);
    await idb.addActionUpdate(act.id, { author_id: 1, author_name: 'Coordinator', body: 'Reopened', status_change: 'In Progress' });
    const env = { kind: 'action', author: 'fis_tech', payload: { source: 'inspection', id: act.id, status_change: 'Closed', body: 'done' } };
    if (ts) env.client_ts = ts;
    const r = await put(n, env);
    assert.equal(r.status, 409, 'client_ts ' + ts);
    assert.equal((await stored(act.id)).status, 'In Progress');
  }
});

test('F-2 residual: no base_status + no client_ts on an action never changed on the server still applies', async () => {
  const act = await overdueAction('F2r untouched');
  const r = await put(22, { kind: 'action', author: 'fis_tech', payload: { source: 'inspection', id: act.id, status_change: 'Closed', body: 'done' } });
  assert.equal(r.status, 200);
  assert.equal((await stored(act.id)).status, 'Closed');
});

test('F-5 repair note: the read-only check lists out-of-vocabulary rows and writes nothing', async () => {
  const act = await overdueAction('F5 repair check');
  await rdb.db.prepare("UPDATE insp_actions SET status = 'demand' WHERE id = ?").run(act.id);
  const tool = require('../tools/field/inspection-action-status-check');
  const out = await tool.run([], { db: idb.pgHandle(), normalize: idb.normalizeActionStatus, log: () => {} });
  const row = out.rows.find((r) => r.id === act.id);
  assert.deepEqual([row.status, row.maps_to, row.needs_decision], ['demand', null, true]);
  assert.ok(out.rows.some((r) => r.status === 'cancelled' && r.maps_to === 'Cancelled'), 'legacy lowercase row maps to Cancelled');
  assert.equal((await stored(act.id)).status, 'demand', 'dry run: nothing written');
});
