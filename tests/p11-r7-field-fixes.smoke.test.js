'use strict';
const fetch = require('./_http-fetch');
// P11 round 7 (UX/field) — F-25: id-less inspection action saves (old local copies, queued offline saves).
//  R7-N1 — the rows a save kept because they could not be matched safely were DELETED by the very next save from the
//          same tab (the tab never received them, so its next payload did not name them). They are now returned to
//          the form (kept_rows), flagged in the stored form state, and only an explicit removal by id deletes them.
//  R7-N4 — equal counts with a reordered / replaced id-less list matched "in order" and attached Bob's history to
//          Carol's action. Id-less rows now match only on an unambiguous key (text + owner + due, then text alone,
//          each unique on both sides); anything else becomes a new row and the stored rows are kept.
process.env.DASH_USER = process.env.DASH_USER || 'r7f-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'r7f-pass-0000-xyz';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'r7f-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, ed, rdb, hounde;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  hounde = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name));
  await rdb.createUser({ username: 'r7f_ed', full_name: 'r7f_ed', password: 'r7f_edpass123456', role: 'editor', roles: ['editor'], site_id: hounde.id });
  ed = (await rdb.login('r7f_ed', 'r7f_edpass123456')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());

const H = (t) => ({ 'x-report-token': t, 'content-type': 'application/json' });
const meta = (id, extra) => ({ f_id: id, f_site: `${hounde.name} (HGO)`, f_date: '2026-11-02', f_time: '11:00', f_area: 'dc', f_inspector: 'Tech', f_type: 'routine', ...(extra || {}) });
const save = async (state) => { const r = await fetch(base + '/api/inspection/save', { method: 'POST', headers: H(ed), body: JSON.stringify({ state }) }); return { status: r.status, body: await r.json() }; };
const rows = (id) => rdb.db.prepare('SELECT id, ord, description, owner, status FROM insp_actions WHERE inspection_id = ? ORDER BY ord, id').all(id);
const comment = (actionId, body) => fetch(base + '/api/inspection/actions/' + actionId + '/update', { method: 'POST', headers: H(ed), body: JSON.stringify({ body }) });
const hist = (ids) => rdb.db.prepare('SELECT action_id, body FROM insp_action_updates WHERE action_id = ANY(?) ORDER BY id').all(ids);
const A = { desc: 'Check UPS', owner: 'Alice', due: '2026-11-30', priority: 'High', status: 'Open' };
const B = { desc: 'Check UPS', owner: 'Bob', due: '2026-12-15', priority: 'Low', status: 'Open' };
const Cc = { desc: 'Check UPS', owner: 'Carol', due: '2026-12-20', priority: 'Medium', status: 'Open' };

test('R7-N1: rows kept as "not matched safely" survive the next save from the same tab (no reload)', async () => {
  const id = 'EM-IT-20261102-R7N1';
  await save({ meta: meta(id), items: {}, actions: [{ ...A }, { ...B }], status: 'draft' });
  const before = await rows(id);
  assert.equal((await comment(before[1].id, 'Bob comment')).status, 200);
  // a tab with an old local copy (no ids): the user removed A, kept B
  const tabActions = [{ ...B }];
  const s1 = await save({ meta: meta(id), items: {}, actions: tabActions, status: 'draft' });
  assert.equal(s1.status, 200);
  assert.ok(Array.isArray(s1.body.kept_rows), 'the save returns the kept rows so the form can show them');
  for (const kid of s1.body.kept_ambiguous) assert.ok(s1.body.kept_rows.some((k) => k.id === kid && k.desc === 'Check UPS'), 'kept row ' + kid + ' is returned with its values');
  // the tab does what forceSyncNow did before this fix: stamp ids from action_states, NO merge, NO reload
  tabActions.forEach((a, i) => { a.id = s1.body.action_ids[i]; });
  tabActions[0].notes = 'edited later';
  const s2 = await save({ meta: meta(id), items: {}, actions: tabActions, status: 'draft' });
  assert.equal(s2.status, 200);
  const now = (await rows(id)).map((r) => r.id);
  for (const kid of s1.body.kept_ambiguous) assert.ok(now.includes(kid), 'kept row ' + kid + ' is not deleted by the next save');
  assert.deepEqual((await hist(before.map((x) => x.id))).map((h) => [h.action_id, h.body]), [[before[1].id, 'Bob comment']], "Bob's history survives, on Bob's row");
});

test('R7-N1: the form that merged the kept rows can remove one of them explicitly (by id)', async () => {
  const id = 'EM-IT-20261102-R7N1B';
  await save({ meta: meta(id), items: {}, actions: [{ ...A }, { ...B }], status: 'draft' });
  const before = await rows(id);
  const s1 = await save({ meta: meta(id), items: {}, actions: [{ ...B }], status: 'draft' });
  const alice = s1.body.kept_rows.find((k) => k.owner === 'Alice');
  assert.ok(alice, 'Alice is kept');
  // the merged form: every row with its id; the user then deletes Alice in the form
  const merged = [{ ...B, id: s1.body.action_ids[0] }, ...s1.body.kept_rows.filter((k) => k.id !== alice.id)];
  const s2 = await save({ meta: meta(id), items: {}, actions: merged, removed_action_ids: [alice.id], status: 'draft' });
  assert.equal(s2.status, 200);
  const now = (await rows(id)).map((r) => r.id);
  assert.ok(!now.includes(alice.id), 'an explicit removal by id deletes the kept row');
  assert.ok(now.includes(before[1].id), "Bob's original row stays");
  const st = await rdb.db.prepare('SELECT state_json FROM insp_inspections WHERE id = ?').get(id);
  assert.ok(!/removed_action_ids/.test(st.state_json), 'the removal list is never stored in the form state');
});

test('R7-N4: equal counts with a reordered / replaced id-less list never cross-attach history', async () => {
  const id = 'EM-IT-20261102-R7N4';
  await save({ meta: meta(id), items: {}, actions: [{ ...A }, { ...B }], status: 'draft' });
  const before = await rows(id);
  await comment(before[1].id, 'Bob comment');
  const s = await save({ meta: meta(id), items: {}, actions: [{ ...B }, { ...Cc }], status: 'draft' });
  assert.equal(s.status, 200);
  const after = await rows(id);
  const carol = after.find((r) => r.owner === 'Carol');
  assert.ok(carol, 'Carol exists');
  assert.ok(!before.some((b) => b.id === carol.id), 'Carol is a NEW row, never a stored row re-purposed');
  const h = await hist(after.map((x) => x.id));
  assert.deepEqual(h.map((x) => [x.action_id, x.body]), [[before[1].id, 'Bob comment']], "Bob's comment stays on Bob's row");
  assert.ok(after.some((r) => r.id === before[1].id && r.owner === 'Bob'), 'Bob keeps his id (unambiguous text + owner + due)');
  assert.ok(after.some((r) => r.id === before[0].id && r.owner === 'Alice'), 'Alice is kept (same text as an id-less row: not deleted)');
  assert.deepEqual(s.body.kept_ambiguous, [before[0].id], 'Alice is reported as kept');
});

test('unambiguous id-less saves still match (same values, or a unique text with an edited owner)', async () => {
  const id = 'EM-IT-20261102-R7N5';
  const s0 = await save({ meta: meta(id), items: {}, actions: [{ ...A }, { ...B }, { desc: 'Swap fan', owner: 'X', due: '2026-12-01', priority: 'Low', status: 'Open' }] });
  const ids = s0.body.action_ids;
  const s1 = await save({ meta: meta(id, { f_obs: 'x' }), items: {}, actions: [{ ...A }, { ...B }, { desc: 'Swap fan', owner: 'Y', due: '2026-12-01', priority: 'Low', status: 'Open' }] });
  assert.deepEqual(s1.body.action_ids, ids, 'same ids in the same order');
  assert.deepEqual(s1.body.kept_ambiguous, []);
  assert.equal((await rows(id))[2].owner, 'Y', 'the unique text matched and took the edit');
});
