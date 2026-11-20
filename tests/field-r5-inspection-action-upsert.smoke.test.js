'use strict';
const fetch = require('./_http-fetch');
// P11 round 5 (UX/field) — F-15: saving the inspection form used to DELETE + re-INSERT every corrective action.
// Each save gave the actions new ids, deleted their comment / status history (insp_action_updates, ON DELETE
// CASCADE) and turned a phone close queued against the old id into a terminal 403 "not in your scope".
// The form now UPSERTS by id (as saveMeeting does since audit F2): same id when the action is still there,
// history kept, updated_at moved only by a real edit, and a status changed in the register / on a phone is not
// reverted by a form that never touched it.
process.env.DASH_USER = process.env.DASH_USER || 'field-r5-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'field-r5-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'field-r5-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, tech, ed, rdb, idb, hounde;
const U = (n) => `7d4f5e6b-9b7d-4e21-a3f5-0c8d1e2f3b${String(n).padStart(2, '0')}`;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); idb = require('../inspection-db');
  for (let i = 0; i < 60; i++) { if (await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'field_outbox'").get()) break; await new Promise(r => setTimeout(r, 100)); }
  hounde = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name));
  await rdb.createUser({ username: 'r5f_tech', full_name: 'r5f_tech', password: 'r5f_techpass1234', role: 'viewer', roles: ['viewer', 'field-tech'], site_id: hounde.id });
  await rdb.createUser({ username: 'r5f_ed', full_name: 'r5f_ed', password: 'r5f_edpass123456', role: 'editor', roles: ['editor'], site_id: hounde.id });
  tech = (await rdb.login('r5f_tech', 'r5f_techpass1234')).token;
  ed = (await rdb.login('r5f_ed', 'r5f_edpass123456')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());

const H = (t) => ({ 'x-report-token': t, 'content-type': 'application/json' });
const meta = (id, extra) => ({ f_id: id, f_site: `${hounde.name} (HGO)`, f_date: '2026-11-01', f_time: '09:00', f_area: 'dc', f_inspector: 'Tech', f_type: 'routine', ...(extra || {}) });
const save = (state) => fetch(base + '/api/inspection/save', { method: 'POST', headers: H(ed), body: JSON.stringify({ state }) });
const updates = async (id) => (await rdb.db.prepare('SELECT count(*)::int AS n FROM insp_action_updates WHERE action_id = ?').get(id)).n;
const actionsOf = async (inspId) => (await idb.getInspection(inspId)).actions;

test('R5-N1: re-saving the form (action unchanged) keeps the id and the history, and the queued phone close applies', async () => {
  const id = 'EM-IT-20261101-R5N1';
  const state = { meta: meta(id), items: {}, actions: [{ desc: 'R5 replace UPS battery', owner: 'Tech', due: '2026-11-30', priority: 'High', status: 'Open' }], status: 'draft' };
  let r = await save(state); assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(Array.isArray(out.action_ids) && out.action_ids.length, 1, 'the save answers the stored action ids, in form order');
  const boot = await (await fetch(base + '/api/field/bootstrap', { headers: H(tech) })).json();
  const a = boot.actions.find((x) => x.description === 'R5 replace UPS battery');
  assert.equal(a.id, out.action_ids[0]);
  r = await fetch(base + '/api/inspection/actions/' + a.id + '/update', { method: 'POST', headers: H(ed), body: JSON.stringify({ body: 'spare ordered' }) });
  assert.equal(r.status, 200);
  assert.equal(await updates(a.id), 1);
  const queuedAt = new Date(Date.now() - 60e3).toISOString();
  const changedBefore = (await idb.getActionParent(a.id)).row_changed_at;
  // the coordinator changes only the observations and saves the whole form again — an OLD form state without ids
  r = await save({ ...state, meta: meta(id, { f_obs: 'added a note' }) }); assert.equal(r.status, 200);
  const now = await actionsOf(id);
  assert.deepEqual(now.map((x) => [x.id, x.status]), [[a.id, 'Open']], 'same id, still Open');
  assert.equal(await updates(a.id), 1, 'comment trail kept');
  assert.equal((await idb.getActionParent(a.id)).row_changed_at, changedBefore, 'a re-save without an action edit does not move updated_at');
  const p = await fetch(base + '/api/field/outbox/' + U(1), { method: 'PUT', headers: H(tech), body: JSON.stringify({ kind: 'action', author: 'r5f_tech', client_ts: queuedAt, payload: { source: 'inspection', id: a.id, base_status: 'Open', status_change: 'Closed', body: 'battery replaced' } }) });
  assert.equal(p.status, 200, 'the queued close applies');
  assert.equal((await actionsOf(id))[0].status, 'Closed');
  assert.equal(await updates(a.id), 2, 'the phone close is appended to the same trail');
});

test('the form round-trips ids: an edited action keeps its id, a removed one goes, a new one is added', async () => {
  const id = 'EM-IT-20261101-R5N2';
  let r = await save({ meta: meta(id), items: {}, actions: [
    { desc: 'R5 first', owner: 'A', due: '2026-11-30', priority: 'High', status: 'Open' },
    { desc: 'R5 second', owner: 'B', due: '2026-11-30', priority: 'Low', status: 'Open' },
  ] });
  const ids = (await r.json()).action_ids;
  await idb.addActionUpdate(ids[1], { author_name: 'x', body: 'note on second' });
  const rec = await idb.getInspection(id);
  assert.deepEqual(rec.state.actions.map((x) => x.id), ids, 'the read inflates the form state with the stored ids');
  // drop the first, edit the second, add a third
  r = await save({ ...rec.state, actions: [{ ...rec.state.actions[1], desc: 'R5 second (edited)', status: 'In Progress' }, { desc: 'R5 third', owner: 'C', due: '2026-12-01', priority: 'Medium', status: 'Open' }] });
  assert.equal(r.status, 200);
  const after = await actionsOf(id);
  assert.equal(after.length, 2);
  assert.equal(after[0].id, ids[1], 'edited action keeps its id');
  assert.equal(after[0].description, 'R5 second (edited)');
  assert.equal(after[0].status, 'In Progress');
  assert.equal(after[0].ord, 0);
  assert.ok(!after.some((x) => x.id === ids[0]), 'removed action deleted');
  assert.equal(await updates(ids[1]), 1, 'history of the kept action survives');
});

test('a status changed in the register is not reverted by a form save that never touched it', async () => {
  const id = 'EM-IT-20261101-R5N3';
  const state = { meta: meta(id), items: {}, actions: [{ desc: 'R5 register close', owner: 'A', due: '2026-11-30', priority: 'High', status: 'Open' }] };
  const ids = (await (await save(state)).json()).action_ids;
  await idb.addActionUpdate(ids[0], { author_name: 'coord', body: 'done', status_change: 'Closed' });
  // the stale form (still Open) is saved again
  await save({ ...state, meta: meta(id, { f_obs: 'stale tab' }) });
  const a = (await actionsOf(id))[0];
  assert.equal(a.id, ids[0]);
  assert.equal(a.status, 'Closed', 'register close kept');
  assert.equal(a.closed_by, 'coord', 'closer kept');
  assert.ok(a.closed_at, 'closed_at kept');
  // reopening it explicitly from the form (the form showed Closed, the user picks Open) still works
  const rec = await idb.getInspection(id);
  assert.equal(rec.state.actions[0].status, 'Closed', 'the read shows the stored status');
  await save({ ...rec.state, actions: [{ ...rec.state.actions[0], status: 'Open' }] });
  const b = (await actionsOf(id))[0];
  assert.equal(b.status, 'Open');
  assert.equal(b.closed_at, null);
  assert.equal(b.closed_by, null);
});

test('an id belonging to another inspection is never touched by this save', async () => {
  const other = (await (await save({ meta: meta('EM-IT-20261101-R5N4'), items: {}, actions: [{ desc: 'R5 other', owner: 'A', due: '2026-11-30', priority: 'High', status: 'Open' }] })).json()).action_ids[0];
  const r = await save({ meta: meta('EM-IT-20261101-R5N5'), items: {}, actions: [{ id: other, desc: 'R5 hijack', owner: 'Z', due: '2026-11-30', priority: 'High', status: 'Closed' }] });
  assert.equal(r.status, 200);
  const o = (await actionsOf('EM-IT-20261101-R5N4'))[0];
  assert.equal(o.id, other); assert.equal(o.description, 'R5 other'); assert.equal(o.status, 'Open');
  const mine = (await actionsOf('EM-IT-20261101-R5N5'))[0];
  assert.notEqual(mine.id, other);
  assert.equal(mine.description, 'R5 hijack');
});
