'use strict';
const fetch = require('./_http-fetch');
// P11 UX/field F-1 + F-2 — the field outbox never overwrites a change it did not see:
//  F-1: an inspection envelope whose f_id names an EXISTING inspection (submitted by someone else, or a draft of
//       another author) → 409 conflict, the stored row unchanged; a field-tech never un-submits a record; an
//       identical replay by the same author (lost ledger answer) still applies.
//  F-2: an action status change queued on the phone loses to a later server-side change: 409, status unchanged
//       (base_status sent by the phone; client_ts vs the last server status change for envelopes queued before).
const _os = require('os'), _fs = require('fs'), _path = require('path');
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'field-conflict-'));
process.env.DASH_USER = process.env.DASH_USER || 'field-conflict-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'field-conflict-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'field-conflict-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, tech, techId, rdb, idb, mdb, hounde;
const U = (n) => `3a1e4c3a-9b7d-4e21-a3f5-0c8d1e2f3a${String(n).padStart(2, '0')}`;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); idb = require('../inspection-db'); mdb = require('../meetings-db');
  for (let i = 0; i < 60; i++) { if (await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'field_outbox'").get()) break; await new Promise(r => setTimeout(r, 100)); }
  hounde = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name));
  try { await rdb.createUser({ username: 'fc_tech', full_name: 'fc_tech', password: 'fc_techpass1234', role: 'viewer', roles: ['viewer', 'field-tech'], site_id: hounde.id }); } catch {}
  tech = (await rdb.login('fc_tech', 'fc_techpass1234')).token;
  techId = Number((await rdb.listUsers()).find((x) => x.username === 'fc_tech').id);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const put = (n, env) => fetch(base + '/api/field/outbox/' + U(n), { method: 'PUT', headers: { 'x-report-token': tech, 'content-type': 'application/json' }, body: JSON.stringify(env) });
const fieldId = require('./_field-id');
const meta = (id, extra) => ({ f_id: fieldId(id), f_site: `${hounde.name} (HGO)`, f_date: '2026-10-19', f_time: '09:00', f_area: 'dc', f_inspector: 'Tech', f_type: 'routine', ...extra });
const row = (id) => rdb.db.prepare('SELECT status, key_observations FROM insp_inspections WHERE id = ?').get(id);

test('F-1: a field envelope reusing the id of a SUBMITTED inspection → 409, row unchanged (still submitted)', async () => {
  await idb.saveInspection({ meta: meta('EM-IT-20261019-0202', { f_obs: 'ORIGINAL OBS' }), items: {}, actions: [], status: 'submitted' }, null, 1);
  const before = await row(fieldId('EM-IT-20261019-0202')); assert.equal(before.status, 'submitted');
  const r = await put(1, { kind: 'inspection', author: 'fc_tech', payload: { meta: meta('EM-IT-20261019-0202', { f_obs: 'overwritten' }), items: {} } });
  assert.equal(r.status, 409); const j = await r.json(); assert.equal(j.ok, false); assert.equal(j.status, 'rejected'); assert.equal(j.result.conflict, true);
  assert.deepEqual(await row(fieldId('EM-IT-20261019-0202')), before, 'stored inspection untouched');
  const again = await (await put(1, { kind: 'inspection', author: 'fc_tech', payload: { meta: meta('EM-IT-20261019-0202', { f_obs: 'overwritten' }), items: {} } })).json();
  assert.equal(again.duplicate, true); assert.equal(again.status, 'rejected', 'terminal: never retried into the record');
});

test('F-1: an existing DRAFT of another author (accidental id collision) → 409; an identical replay of its own capture applies', async () => {
  await idb.saveInspection({ meta: meta('EM-IT-20261019-0303', { f_obs: 'web draft' }), items: {}, actions: [] }, null, 1);
  const r = await put(2, { kind: 'inspection', author: 'fc_tech', payload: { meta: meta('EM-IT-20261019-0303', { f_obs: 'field capture' }), items: {}, status: 'submitted' } });
  assert.equal(r.status, 409); assert.equal((await row(fieldId('EM-IT-20261019-0303'))).key_observations, 'web draft');
  // the same capture saved earlier by this user (e.g. the ledger answer was lost) is replayed identically → applied
  const m = meta('EM-IT-20261019-0404', { f_obs: 'mine' });
  await idb.saveInspection({ meta: m, items: {}, actions: [], status: 'submitted' }, ['HGO'], techId);
  const ok = await (await put(3, { kind: 'inspection', author: 'fc_tech', payload: { meta: m, items: {}, actions: [], status: 'submitted' } })).json();
  assert.equal(ok.ok, true); assert.equal(ok.result.inspection_id, fieldId('EM-IT-20261019-0404'));
  // but the same author changing the content of an already-stored id is still a conflict (never a silent rewrite)
  const chg = await put(4, { kind: 'inspection', author: 'fc_tech', payload: { meta: { ...m, f_obs: 'changed' }, items: {}, status: 'submitted' } });
  assert.equal(chg.status, 409); assert.equal((await row(fieldId('EM-IT-20261019-0404'))).key_observations, 'mine');
});

test('F-1: a brand-new id still applies; a soft-deleted id is a 409 conflict, not a retry loop', async () => {
  const ok = await (await put(5, { kind: 'inspection', author: 'fc_tech', payload: { meta: meta('EM-IT-20261019-F0A1B2C3D4E5'), items: {}, status: 'submitted' } })).json();
  assert.equal(ok.ok, true);
  await idb.saveInspection({ meta: meta('EM-IT-20261019-0505'), items: {}, actions: [] }, null, 1);
  await idb.deleteInspection(fieldId('EM-IT-20261019-0505'), { soft: true, by: 'admin', reason: 'test' });
  const del = await put(6, { kind: 'inspection', author: 'fc_tech', payload: { meta: meta('EM-IT-20261019-0505'), items: {} } });
  assert.equal(del.status, 409, 'deleted id: terminal conflict (was a 500 + endless retry)');
  assert.equal((await del.json()).status, 'rejected');
});

async function inspAction(desc) {
  await idb.saveInspection({ meta: meta('EM-IT-20261019-' + desc.length + '777', {}), items: {}, actions: [{ description: desc, owner: 'Tech', due: '2026-10-30', priority: 'High', status: 'Open' }] }, null, 1);
  return (await idb.listActions({ site: 'HGO' })).find(x => x.description === desc);
}

test('F-2: base_status differs from the server (moved to In Progress after queueing) → 409, status unchanged', async () => {
  const act = await inspAction('Cable recert A');
  await idb.addActionUpdate(act.id, { author_id: 1, author_name: 'Coordinator', body: 'Reopened: cable not certified', status_change: 'In Progress' });
  const r = await put(10, { kind: 'action', author: 'fc_tech', client_ts: new Date().toISOString(), payload: { source: 'inspection', id: act.id, base_status: 'Open', status_change: 'Closed', body: 'done' } });
  assert.equal(r.status, 409); const j = await r.json(); assert.equal(j.result.conflict, true); assert.match(j.result.error, /In Progress/);
  assert.equal((await idb.listActions({ site: 'HGO' })).find(x => x.id === act.id).status, 'In Progress');
  // the phone saw the current status → applied
  const ok = await (await put(11, { kind: 'action', author: 'fc_tech', payload: { source: 'inspection', id: act.id, base_status: 'In Progress', status_change: 'Closed', body: 'done' } })).json();
  assert.equal(ok.ok, true); assert.equal((await idb.listActions({ site: 'HGO' })).find(x => x.id === act.id).status, 'Closed');
});

test('F-2: envelope queued before the phone sent base_status: a server status change after client_ts → 409', async () => {
  const act = await inspAction('Cable recert BB');
  const queuedAt = new Date(Date.now() - 3600e3).toISOString();
  await idb.addActionUpdate(act.id, { author_id: 1, author_name: 'Coordinator', body: 'Reopened', status_change: 'In Progress' });
  const r = await put(12, { kind: 'action', author: 'fc_tech', client_ts: queuedAt, payload: { source: 'inspection', id: act.id, status_change: 'Closed', body: 'done' } });
  assert.equal(r.status, 409);
  assert.equal((await idb.listActions({ site: 'HGO' })).find(x => x.id === act.id).status, 'In Progress');
  // a comment only never conflicts (it overwrites nothing)
  const c = await (await put(13, { kind: 'action', author: 'fc_tech', client_ts: queuedAt, payload: { source: 'inspection', id: act.id, body: 'photo taken' } })).json();
  assert.equal(c.ok, true);
});

test('F-2: meetings action — base_status compared on the stored code', async () => {
  const saved = await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'IT', meeting_date: '2026-10-08', status: 'draft' }, actions: [{ description: 'Field conflict meeting', status: 'open' }] }, null, 1);
  const a = (await mdb.getMeeting(saved.id)).actions[0];
  await mdb.addActionUpdate(a.id, { author_id: 1, author_name: 'Coord', body: 'started', status_change: 'in_progress' });
  const r = await put(14, { kind: 'action', author: 'fc_tech', payload: { source: 'meetings', id: a.id, base_status: 'open', status_change: 'resolved', body: 'Closed from the field app' } });
  assert.equal(r.status, 409);
  assert.equal((await mdb.getMeeting(saved.id)).actions[0].status, 'in_progress');
  const ok = await (await put(15, { kind: 'action', author: 'fc_tech', payload: { source: 'meetings', id: a.id, base_status: 'in_progress', status_change: 'resolved', body: 'Closed from the field app' } })).json();
  assert.equal(ok.ok, true);
});
