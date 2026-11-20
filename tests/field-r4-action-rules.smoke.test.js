'use strict';
const fetch = require('./_http-fetch');
// P11 round 4 (UX/field) — the field outbox action path:
//  F-10: a meetings action is only resolved / cancelled / transferred (demand, helpdesk_ticket) from the field app,
//        as an inspection action is only closed / cancelled (r3 F-9). A reopen or a move is the web register's job.
//  F-11: a missing action id and an action of another site get the SAME refusal (no site code, no existence oracle).
//  F-2 residual: an action re-created or edited through the inspection editor after the phone queued its change
//        is not overwritten by an envelope without base_status (409 action_changed).
//  F-4: every refusal of an action entry carries a reason code the phone translates.
const _os = require('os'), _fs = require('fs'), _path = require('path');
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'field-r4-'));
process.env.DASH_USER = process.env.DASH_USER || 'field-r4-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'field-r4-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'field-r4-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, tech, rdb, idb, mdb, hounde;
const U = (n) => `6c3e4d5a-9b7d-4e21-a3f5-0c8d1e2f3b${String(n).padStart(2, '0')}`;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); idb = require('../inspection-db'); mdb = require('../meetings-db');
  for (let i = 0; i < 60; i++) { if (await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'field_outbox'").get()) break; await new Promise(r => setTimeout(r, 100)); }
  hounde = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name));
  try { await rdb.createUser({ username: 'r4f_tech', full_name: 'r4f_tech', password: 'r4f_techpass1234', role: 'viewer', roles: ['viewer', 'field-tech'], site_id: hounde.id }); } catch {}
  tech = (await rdb.login('r4f_tech', 'r4f_techpass1234')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const put = (n, env) => fetch(base + '/api/field/outbox/' + U(n), { method: 'PUT', headers: { 'x-report-token': tech, 'content-type': 'application/json' }, body: JSON.stringify(env) });
const meta = (id, site) => ({ f_id: id, f_site: site || `${hounde.name} (HGO)`, f_date: '2026-10-19', f_time: '09:00', f_area: 'dc', f_inspector: 'Tech', f_type: 'routine' });
const mtg = async (desc, status, site = 'HGO', date = '2026-10-09') => { const s = await mdb.saveMeeting({ header: { site_code: site, department: 'IT', meeting_date: date, status: 'draft' }, actions: [{ description: desc, status }] }, null, 1); return (await mdb.getMeeting(s.id)).actions[0]; };
const mst = async (id) => (await mdb.getActionParent(id)).action_status;
const inspAct = async (id, desc, site, code) => { await idb.saveInspection({ meta: meta(id, site), items: {}, actions: [{ description: desc, owner: 'x', due: '2026-10-30', priority: 'High', status: 'Open' }] }, null, 1); return (await idb.listActions({ site: code || 'HGO' })).find((x) => x.description === desc); };

test('F-10: a viewer-tier field tech cannot reopen or move a meetings action from the field path', async () => {
  const a = await mtg('R4F resolved', 'resolved', 'HGO', '2026-10-01');
  for (const [n, st] of [[1, 'open'], [2, 'in_progress'], [3, 'blocked'], [4, 'on_hold']]) {
    const r = await put(n, { kind: 'action', author: 'r4f_tech', payload: { source: 'meetings', id: a.id, base_status: 'resolved', status_change: st, body: 'reopen' } });
    assert.equal(r.status, 400, st);
    const j = await r.json(); assert.equal(j.status, 'rejected'); assert.equal(j.result.reason, 'meetings_action_status');
    assert.equal(await mst(a.id), 'resolved', st + ': stays resolved');
  }
});

test('F-10: closing, cancelling and transferring a meetings action from the field still works', async () => {
  const a = await mtg('R4F close', 'open', 'HGO', '2026-09-01');
  let r = await put(5, { kind: 'action', author: 'r4f_tech', payload: { source: 'meetings', id: a.id, base_status: 'open', status_change: 'closed', body: 'done' } });
  assert.equal(r.status, 200); assert.equal(await mst(a.id), 'resolved', 'legacy "closed" = resolved');
  const b = await mtg('R4F demand', 'open', 'HGO', '2026-08-01');
  r = await put(6, { kind: 'action', author: 'r4f_tech', payload: { source: 'meetings', id: b.id, base_status: 'open', status_change: 'demand', body: 'raised as a demand' } });
  assert.equal(r.status, 200); assert.equal(await mst(b.id), 'demand');
  const c = await mtg('R4F comment', 'open', 'HGO', '2026-07-01');
  r = await put(7, { kind: 'action', author: 'r4f_tech', payload: { source: 'meetings', id: c.id, body: 'a comment only' } });
  assert.equal(r.status, 200); assert.equal(await mst(c.id), 'open');
});

test('F-11: a missing action id and another site\'s action get the same refusal, without any site code', async () => {
  const sgoI = await inspAct('EM-IT-20261019-R4F1', 'R4F SGO insp act', 'Sabodala (SGO)', 'SGO');
  const sgoM = await mtg('R4F SGO mtg', 'open', 'SGO', '2026-10-10');
  const answers = [];
  for (const [n, src, id] of [[8, 'inspection', sgoI.id], [9, 'inspection', 987654], [10, 'meetings', sgoM.id], [11, 'meetings', 987654]]) {
    const r = await put(n, { kind: 'action', author: 'r4f_tech', payload: { source: src, id, body: 'look' } });
    const j = await r.json();
    assert.ok(!/SGO|Sabodala/i.test(JSON.stringify(j)), 'no site named: ' + JSON.stringify(j));
    answers.push([r.status, j.result.reason, j.result.error]);
  }
  for (const x of answers) assert.deepEqual(x, answers[0], 'one generic refusal for missing and out-of-scope ids');
  assert.equal(answers[0][0], 403); assert.equal(answers[0][1], 'action_unavailable');
});

test('F-2 residual: an action re-created by the inspection editor after the envelope was queued → 409, editor status kept', async () => {
  const id = 'EM-IT-20261019-R4F2';
  await idb.saveInspection({ meta: meta(id), items: {}, actions: [{ description: 'R4F editor path', owner: 'Tech', due: '2026-10-30', priority: 'High', status: 'Open' }] }, null, 1);
  const queuedAt = new Date(Date.now() - 3600e3).toISOString();
  const rec = await idb.getInspection(id);
  await idb.saveInspection({ ...rec.state, actions: (rec.state.actions || []).map((a) => ({ ...a, status: 'In Progress' })) }, null, 1);
  const a = (await idb.listActions({ site: 'HGO' })).find((x) => x.description === 'R4F editor path');
  const r = await put(12, { kind: 'action', author: 'r4f_tech', client_ts: queuedAt, payload: { source: 'inspection', id: a.id, status_change: 'Closed', body: 'done' } });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).result.reason, 'action_changed');
  assert.equal((await idb.listActions({ site: 'HGO' })).find((x) => x.id === a.id).status, 'In Progress');
});

test('F-4: an action refusal always carries a reason code (invalid payload, transfer justification)', async () => {
  const a = await mtg('R4F justify', 'open', 'HGO', '2026-06-01');
  let r = await put(13, { kind: 'action', author: 'r4f_tech', payload: { source: 'meetings', id: a.id, base_status: 'open', status_change: 'demand', body: '' } });
  assert.equal(r.status, 400); assert.equal((await r.json()).result.reason, 'status_justification');
  r = await put(14, { kind: 'action', author: 'r4f_tech', payload: { source: 'nowhere', id: a.id } });
  assert.equal(r.status, 400); assert.equal((await r.json()).result.reason, 'action_invalid');
  r = await put(15, { kind: 'inspection', author: 'r4f_tech', payload: { meta: meta('EM-IT-20261019-R4F3', 'Mana (MGO)'), items: {} } });
  assert.equal(r.status, 403); assert.equal((await r.json()).result.reason, 'inspection_out_of_scope');
});
