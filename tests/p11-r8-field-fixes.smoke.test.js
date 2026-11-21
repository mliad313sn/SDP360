'use strict';
const fetch = require('./_http-fetch');
// P11 round 8 (UX/field) — server side.
//  F-29 (R8-N1) — a stale editor's save deleted the actions another editor had added since (and their comment
//         history): the whole inspection was last-write-wins. The read now carries a version (server_version) and
//         the ids the form loaded (known_action_ids); a save based on an older version is refused with 409
//         (reason inspection_changed), and a client that never loaded a row can never delete it (kept_rows).
//  F-30 (b, R8-N5) — with PostgreSQL unreachable the session check answered 401, which the phone read as
//         "Session expired". A database outage now answers 503 database_unavailable (+ Retry-After).
process.env.DASH_USER = process.env.DASH_USER || 'r8f-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'r8f-pass-0000-xyz';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'r8f-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, ed, tech, rdb, hounde;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  hounde = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name));
  await rdb.createUser({ username: 'r8f_ed', full_name: 'r8f_ed', password: 'r8f_edpass123456', role: 'editor', roles: ['editor'], site_id: hounde.id });
  await rdb.createUser({ username: 'r8f_tech', full_name: 'r8f_tech', password: 'r8f_techpass1234', role: 'viewer', roles: ['viewer', 'field-tech'], site_id: hounde.id });
  ed = (await rdb.login('r8f_ed', 'r8f_edpass123456')).token;
  tech = (await rdb.login('r8f_tech', 'r8f_techpass1234')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());

const H = (t) => ({ 'x-report-token': t, 'content-type': 'application/json' });
const meta = (id) => ({ f_id: id, f_site: `${hounde.name} (HGO)`, f_date: '2026-11-03', f_time: '09:00', f_area: 'dc', f_inspector: 'Tech', f_type: 'routine' });
const save = async (state) => { const r = await fetch(base + '/api/inspection/save', { method: 'POST', headers: H(ed), body: JSON.stringify({ state }) }); return { status: r.status, body: await r.json() }; };
const load = async (id) => (await (await fetch(base + '/api/inspection/' + id, { headers: H(ed) })).json()).state;
const rows = (id) => rdb.db.prepare('SELECT id, ord, description, owner, status FROM insp_actions WHERE inspection_id = ? ORDER BY ord, id').all(id);
const comment = (actionId, body) => fetch(base + '/api/inspection/actions/' + actionId + '/update', { method: 'POST', headers: H(ed), body: JSON.stringify({ body }) });
const hist = (ids) => rdb.db.prepare('SELECT action_id, body FROM insp_action_updates WHERE action_id = ANY(?) ORDER BY id').all(ids);

test('F-29 R8-N1: a stale editor save is refused (409) and another editor\'s new actions and their history stay', async () => {
  const id = 'EM-IT-20261103-R8N1';
  await save({ meta: meta(id), items: {}, actions: [{ desc: 'A1', owner: 'Alice', priority: 'High', status: 'Open' }], status: 'draft' });
  const tab1 = await load(id);
  const tab2 = await load(id);
  assert.ok(typeof tab1.server_version === 'string' && tab1.server_version, 'the read carries the version the form loaded');
  assert.deepStrictEqual(tab1.known_action_ids, [tab1.actions[0].id], 'the read carries the ids the form loaded');
  tab2.actions.push({ desc: 'NEW by editor2', owner: 'Bob', priority: 'High', status: 'Open' });
  tab2.actions.push({ desc: 'NEW2 by editor2', owner: 'Bob', priority: 'High', status: 'Open' });
  const s2 = await save(tab2);
  assert.strictEqual(s2.status, 200);
  assert.ok(s2.body.version && s2.body.version !== tab1.server_version, 'a save returns the new version');
  const newId2 = (await rows(id)).find((x) => /NEW2/.test(x.description)).id;
  assert.strictEqual((await comment(newId2, 'comment on NEW2')).status, 200);
  tab1.actions[0].notes = 'editor1 edits notes only';
  const s1 = await save(tab1);
  assert.strictEqual(s1.status, 409, 'the stale save is refused');
  assert.strictEqual(s1.body.reason, 'inspection_changed');
  assert.strictEqual(s1.body.code, 'CONFLICT');
  assert.ok(s1.body.server_version, 'the answer names the current version');
  assert.deepStrictEqual((await rows(id)).map((r) => r.description), ['A1', 'NEW by editor2', 'NEW2 by editor2'], 'nothing deleted');
  assert.deepStrictEqual((await hist([newId2])).map((h) => h.body), ['comment on NEW2'], 'the history stays');
  const st = await rdb.db.prepare('SELECT state_json FROM insp_inspections WHERE id = ?').get(id);
  assert.ok(!/editor1 edits notes only/.test(st.state_json), 'the stale form state was not written');
});

test('F-29: a client that never loaded a row cannot delete it (known_action_ids), even without a version', async () => {
  const id = 'EM-IT-20261103-R8N1B';
  await save({ meta: meta(id), items: {}, actions: [{ desc: 'A1', owner: 'Alice', priority: 'High', status: 'Open' }], status: 'draft' });
  const tab1 = await load(id);
  delete tab1.server_version;                        // e.g. an older local copy: only the known ids travel
  const tab2 = await load(id);
  tab2.actions.push({ desc: 'NEW by editor2', owner: 'Bob', priority: 'High', status: 'Open' });
  await save(tab2);
  const newId = (await rows(id)).find((x) => /NEW/.test(x.description)).id;
  await comment(newId, 'Bob comment');
  tab1.actions[0].notes = 'edit';
  const s1 = await save(tab1);
  assert.strictEqual(s1.status, 200);
  assert.ok((await rows(id)).some((r) => r.id === newId), 'the unknown row is kept');
  assert.ok(s1.body.kept_rows.some((k) => k.id === newId && k.desc === 'NEW by editor2'), 'and returned to the form');
  assert.deepStrictEqual((await hist([newId])).map((h) => h.body), ['Bob comment']);
});

test('F-29: the version moves with each save, a register comment does not make the form stale, removal by id still works', async () => {
  const id = 'EM-IT-20261103-R8N1C';
  await save({ meta: meta(id), items: {}, actions: [{ desc: 'Keep', owner: 'A', priority: 'Low', status: 'Open' }, { desc: 'Drop', owner: 'B', priority: 'Low', status: 'Open' }], status: 'draft' });
  const tab = await load(id);
  const [keep, drop] = tab.actions;
  assert.strictEqual((await comment(keep.id, 'register note')).status, 200);
  tab.removed_action_ids = [drop.id];
  tab.actions = [keep];
  const s1 = await save(tab);
  assert.strictEqual(s1.status, 200, 'a register comment does not move the inspection version');
  assert.deepStrictEqual((await rows(id)).map((r) => r.id), [keep.id], 'removal by id still deletes');
  tab.server_version = s1.body.version;
  tab.known_action_ids = s1.body.action_ids;
  delete tab.removed_action_ids;
  tab.actions[0].notes = 'second save';
  const s2 = await save(tab);
  assert.strictEqual(s2.status, 200, 'the next save with the returned version passes');
  const st = await rdb.db.prepare('SELECT state_json FROM insp_inspections WHERE id = ?').get(id);
  assert.ok(!/server_version|known_action_ids|base_fp/.test(st.state_json), 'the concurrency fields are never stored in the form state');
});

test('F-30 R8-N5: PostgreSQL unreachable during the session check is 503 database_unavailable, never 401', async () => {
  const orig = rdb.validateSession;
  rdb.validateSession = async () => { const e = new Error('connect ECONNREFUSED 127.0.0.1:5432'); e.code = 'ECONNREFUSED'; throw e; };
  try {
    const body = JSON.stringify({ kind: 'action', author: 'r8f_tech', client_ts: new Date().toISOString(), payload: { source: 'inspection', id: 1, status_change: 'Closed', body: 'x' } });
    const p = await fetch(base + '/api/field/outbox/6b2e5d4b-9b7d-4e21-a3f5-0c8d1e2f3b99', { method: 'PUT', headers: H(tech), body });
    assert.strictEqual(p.status, 503);
    const j = await p.json();
    assert.strictEqual(j.error, 'database_unavailable');
    assert.ok(Number(p.headers.get('retry-after')) >= 5, 'Retry-After tells the phone when to try again');
    const me = await fetch(base + '/api/reports/auth/me', { headers: H(tech) });
    assert.strictEqual(me.status, 503, 'the report-session check says the same');
    assert.strictEqual((await me.json()).error, 'database_unavailable');
    rdb.validateSession = async () => { const e = new Error('terminating connection due to administrator command'); e.code = '57P01'; throw e; };
    assert.strictEqual((await fetch(base + '/api/field/bootstrap', { headers: H(tech) })).status, 503, 'a server shutdown too');
  } finally { rdb.validateSession = orig; }
  // an invalid session is still 401 (fail closed)
  const bad = await fetch(base + '/api/field/bootstrap', { headers: H('not-a-real-token') });
  assert.strictEqual(bad.status, 401);
});
