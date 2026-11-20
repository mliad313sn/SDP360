'use strict';
const fetch = require('./_http-fetch');
// P11 round 6 (UX/field).
//  F-22 — an editor who reopened, in the inspection form, an action closed from a phone got a 200 while the action
//         stayed Closed (the merge base was the stored FORM STATE, which a phone close never updates). The form now
//         sends the value it LOADED (base_status / base_owner): a change relative to it always wins; an untouched
//         value keeps the register / phone value, and the save says so (kept_server_value).
//  F-23 — an id-less save (old local copy, queued offline save) with two actions of the same text kept the wrong row
//         and deleted the kept action's history. Ambiguous text never cross-matches: rows are kept, not deleted.
process.env.DASH_USER = process.env.DASH_USER || 'field-r6-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'field-r6-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'field-r6-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, tech, ed, rdb, idb, hounde;
const U = (n) => `8e5a6f7c-9b7d-4e21-a3f5-0c8d1e2f3b${String(n).padStart(2, '0')}`;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); idb = require('../inspection-db');
  for (let i = 0; i < 60; i++) { if (await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'field_outbox'").get()) break; await new Promise(r => setTimeout(r, 100)); }
  hounde = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name));
  await rdb.createUser({ username: 'r6f_tech', full_name: 'r6f_tech', password: 'r6f_techpass1234', role: 'viewer', roles: ['viewer', 'field-tech'], site_id: hounde.id });
  await rdb.createUser({ username: 'r6f_ed', full_name: 'r6f_ed', password: 'r6f_edpass123456', role: 'editor', roles: ['editor'], site_id: hounde.id });
  tech = (await rdb.login('r6f_tech', 'r6f_techpass1234')).token;
  ed = (await rdb.login('r6f_ed', 'r6f_edpass123456')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());

const H = (t) => ({ 'x-report-token': t, 'content-type': 'application/json' });
const meta = (id, extra) => ({ f_id: id, f_site: `${hounde.name} (HGO)`, f_date: '2026-11-02', f_time: '09:00', f_area: 'dc', f_inspector: 'Tech', f_type: 'routine', ...(extra || {}) });
const save = (state) => fetch(base + '/api/inspection/save', { method: 'POST', headers: H(ed), body: JSON.stringify({ state }) });
const read = async (id) => (await fetch(base + '/api/inspection/' + id, { headers: H(ed) })).json();
const rows = async (id) => rdb.db.prepare('SELECT id, ord, description, owner, status FROM insp_actions WHERE inspection_id = ? ORDER BY ord, id').all(id);
const phoneClose = (n, actionId) => fetch(base + '/api/field/outbox/' + U(n), { method: 'PUT', headers: H(tech), body: JSON.stringify({ kind: 'action', author: 'r6f_tech', client_ts: new Date().toISOString(), payload: { source: 'inspection', id: actionId, base_status: 'Open', status_change: 'Closed', body: 'done' } }) });

test('R6-N1 (F-22): a deliberate reopen in the form of a phone-closed action applies on the FIRST save', async () => {
  const id = 'EM-IT-20261102-R6N1';
  let r = await save({ meta: meta(id), items: {}, actions: [{ desc: 'R6 swap switch', owner: 'Tech', due: '2026-11-30', priority: 'High', status: 'Open' }], status: 'draft' });
  assert.equal(r.status, 200);
  const actionId = (await r.json()).action_ids[0];
  assert.equal((await phoneClose(1, actionId)).status, 200);
  const rec = await read(id);
  assert.equal(rec.state.actions[0].status, 'Closed', 'the form shows the phone close');
  assert.equal(rec.state.actions[0].base_status, 'Closed', 'and loads it as its base');
  rec.state.actions[0].status = 'Open';
  r = await save(rec.state);
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.deepEqual(out.kept_server_value, [], 'nothing silently kept');
  assert.equal((await rows(id))[0].status, 'Open', 'the reopen applied');
  assert.equal(out.action_states[0].status, 'Open');
  assert.equal((await read(id)).state.actions[0].status, 'Open');
  const stored = await rdb.db.prepare('SELECT state_json FROM insp_inspections WHERE id = ?').get(id);
  assert.ok(!/base_status|base_owner/.test(stored.state_json), 'the loaded base is never stored in the form state');
});

test('F-22: an owner change in the form wins; an untouched status keeps a later phone close (reported)', async () => {
  const id = 'EM-IT-20261102-R6N3';
  let r = await save({ meta: meta(id), items: {}, actions: [{ desc: 'R6 owner', owner: 'Tech', due: '2026-11-30', priority: 'High', status: 'Open' }] });
  const actionId = (await r.json()).action_ids[0];
  const rec = await read(id);                       // the editor opens the form (Open, Tech)
  assert.equal((await phoneClose(3, actionId)).status, 200);   // then the phone closes it
  rec.state.actions[0].owner = 'Alice';             // editor changes the owner only, status left as loaded
  r = await save(rec.state);
  const out = await r.json();
  const row = (await rows(id))[0];
  assert.equal(row.owner, 'Alice', 'the owner change applied');
  assert.equal(row.status, 'Closed', 'the phone close is kept (the editor did not touch the status)');
  assert.deepEqual(out.kept_server_value, [actionId], 'the save says it kept the server value');
  assert.equal(out.action_states[0].status, 'Closed');
});

test('F-22: an old form copy without a loaded base keeps the previous rule but reports the kept value', async () => {
  const id = 'EM-IT-20261102-R6N4';
  const state = { meta: meta(id), items: {}, actions: [{ desc: 'R6 legacy', owner: 'A', due: '2026-11-30', priority: 'High', status: 'Open' }] };
  const actionId = (await (await save(state)).json()).action_ids[0];
  assert.equal((await phoneClose(4, actionId)).status, 200);
  const out = await (await save({ ...state, meta: meta(id, { f_obs: 'stale' }) })).json();
  assert.equal((await rows(id))[0].status, 'Closed', 'a stale tab never reverts a close');
  assert.deepEqual(out.kept_server_value, [actionId]);
});

test('R6-N2 (F-23): id-less save with repeated action text never cross-matches nor deletes history', async () => {
  const id = 'EM-IT-20261102-R6N2';
  const A = { desc: 'Check UPS', owner: 'Alice', due: '2026-11-30', priority: 'High', status: 'Open' };
  const B = { desc: 'Check UPS', owner: 'Bob', due: '2026-12-15', priority: 'Low', status: 'Open' };
  await save({ meta: meta(id), items: {}, actions: [A, B], status: 'draft' });
  const before = await rows(id);
  assert.equal(before.length, 2);
  await fetch(base + '/api/inspection/actions/' + before[1].id + '/update', { method: 'POST', headers: H(ed), body: JSON.stringify({ body: 'Bob comment' }) });
  // an old queued save without ids: the user removed A and kept B
  const r = await save({ meta: meta(id), items: {}, actions: [B], status: 'draft' });
  assert.equal(r.status, 200);
  const out = await r.json();
  const after = await rows(id);
  assert.ok(after.some((x) => x.id === before[1].id && x.owner === 'Bob'), "Bob's action keeps its id and its values");
  assert.ok(!after.some((x) => x.id === before[0].id && x.owner === 'Bob'), "Alice's row never takes Bob's values");
  const hist = await rdb.db.prepare('SELECT action_id, body FROM insp_action_updates WHERE action_id = ?').all(before[1].id);
  assert.deepEqual(hist.map((h) => h.body), ['Bob comment'], "Bob's history survives");
  assert.deepEqual(out.kept_ambiguous.sort(), before.map((x) => x.id).sort(), 'the ambiguous stored rows are reported as kept');
  const rec = await read(id);
  assert.equal(rec.state.actions.length, after.length, 'every stored action is visible in the form (none orphaned)');
  // equal counts stay unambiguous: two id-less rows for two stored rows match in order
  const id2 = 'EM-IT-20261102-R6N5';
  await save({ meta: meta(id2), items: {}, actions: [A, B] });
  const b2 = await rows(id2);
  const out2 = await (await save({ meta: meta(id2, { f_obs: 'x' }), items: {}, actions: [A, B] })).json();
  assert.deepEqual(out2.action_ids, b2.map((x) => x.id), 'same ids in the same order');
  assert.deepEqual(out2.kept_ambiguous, []);
});
