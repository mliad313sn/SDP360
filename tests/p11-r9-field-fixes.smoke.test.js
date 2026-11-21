'use strict';
const fetch = require('./_http-fetch');
// P11 round 9 (UX/field) — server side.
//  F-33 — a save of an EXISTING inspection that carries no server_version (a tab opened before fix 35, an old offline
//         draft) cannot be checked for staleness; it used to delete another editor's actions and their history by
//         omission (R9-N2). Now such a save never deletes a stored action by omission (the rows come back in
//         kept_rows), and an explicit removal deletes only an action with no history written by someone else.
//         Updates and additions keep working; a save WITH a version keeps the full fix-35 behaviour.
process.env.DASH_USER = process.env.DASH_USER || 'r9f-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'r9f-pass-0000-xyz';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'r9f-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, ed1, ed2, rdb, hounde;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  hounde = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name));
  await rdb.createUser({ username: 'r9f_ed1', full_name: 'r9f_ed1', password: 'r9f_ed1pass123456', role: 'editor', roles: ['editor'], site_id: hounde.id });
  await rdb.createUser({ username: 'r9f_ed2', full_name: 'r9f_ed2', password: 'r9f_ed2pass123456', role: 'editor', roles: ['editor'], site_id: hounde.id });
  ed1 = (await rdb.login('r9f_ed1', 'r9f_ed1pass123456')).token;
  ed2 = (await rdb.login('r9f_ed2', 'r9f_ed2pass123456')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());

const H = (t) => ({ 'x-report-token': t, 'content-type': 'application/json' });
const meta = (id) => ({ f_id: id, f_site: `${hounde.name} (HGO)`, f_date: '2026-11-21', f_time: '09:00', f_area: 'dc', f_inspector: 'Tech', f_type: 'routine' });
const save = async (tok, state) => { const r = await fetch(base + '/api/inspection/save', { method: 'POST', headers: H(tok), body: JSON.stringify({ state }) }); return { status: r.status, body: await r.json() }; };
const load = async (tok, id) => (await (await fetch(base + '/api/inspection/' + id, { headers: H(tok) })).json()).state;
const rows = (id) => rdb.db.prepare('SELECT id, description, notes FROM insp_actions WHERE inspection_id = ? ORDER BY ord, id').all(id);
const comment = (tok, actionId, body) => fetch(base + '/api/inspection/actions/' + actionId + '/update', { method: 'POST', headers: H(tok), body: JSON.stringify({ body }) });
const hist = (ids) => rdb.db.prepare('SELECT action_id, body FROM insp_action_updates WHERE action_id = ANY(?) ORDER BY id').all(ids);
const oldClient = (st) => { const c = JSON.parse(JSON.stringify(st)); delete c.server_version; delete c.known_action_ids; delete c.base_fp; return c; };

test('F-33 R9-N2: a tab with no version and no known ids never deletes another editor\'s action or its history', async () => {
  const id = 'EM-IT-20261121-R9N2';
  assert.strictEqual((await save(ed1, { meta: meta(id), items: {}, actions: [{ desc: 'A1', owner: 'Alice', priority: 'High', status: 'Open' }], status: 'draft' })).status, 200);
  const stale = oldClient(await load(ed1, id));       // the tab opened before the deploy
  const tab2 = await load(ed2, id);
  tab2.actions.push({ desc: 'NEW2 by editor2', owner: 'Bob', priority: 'High', status: 'Open' });
  assert.strictEqual((await save(ed2, tab2)).status, 200);
  const newId = (await rows(id)).find((r) => /NEW2/.test(r.description)).id;
  assert.strictEqual((await comment(ed2, newId, 'comment on NEW2')).status, 200);
  stale.actions[0].notes = 'stale edit';
  stale.actions.push({ desc: 'added by the old tab', owner: 'Ann', priority: 'Low', status: 'Open' });
  const s = await save(ed1, stale);
  assert.strictEqual(s.status, 200, 'the old client still saves');
  const after = await rows(id);
  assert.ok(after.some((r) => r.id === newId), 'the other editor\'s action is kept');
  assert.deepStrictEqual((await hist([newId])).map((h) => h.body), ['comment on NEW2'], 'its history is kept');
  assert.ok(s.body.kept_rows.some((k) => k.id === newId), 'and it is returned to the form in kept_rows');
  assert.strictEqual(after.find((r) => r.description === 'A1').notes, 'stale edit', 'updates still apply');
  assert.ok(after.some((r) => r.description === 'added by the old tab'), 'additions still apply');
});

test('F-33: a versionless removal deletes only an action with no history from someone else', async () => {
  const id = 'EM-IT-20261121-R9RM';
  await save(ed1, { meta: meta(id), items: {}, actions: [
    { desc: 'mine, no history', owner: 'A', priority: 'Low', status: 'Open' },
    { desc: 'mine, my comment', owner: 'A', priority: 'Low', status: 'Open' },
    { desc: 'commented by editor2', owner: 'A', priority: 'Low', status: 'Open' },
  ], status: 'draft' });
  const st = await load(ed1, id);
  const [a, b, c] = st.actions;
  assert.strictEqual((await comment(ed1, b.id, 'my own note')).status, 200);
  assert.strictEqual((await comment(ed2, c.id, 'editor2 note')).status, 200);
  const old = oldClient(st);
  old.actions = [];
  old.removed_action_ids = [a.id, b.id, c.id];
  const s = await save(ed1, old);
  assert.strictEqual(s.status, 200);
  const left = (await rows(id)).map((r) => r.id);
  assert.ok(!left.includes(a.id), 'an action nobody else touched is removed');
  assert.ok(!left.includes(b.id), 'an action with only the saver\'s own history is removed');
  assert.ok(left.includes(c.id), 'an action with another editor\'s history is kept');
  assert.deepStrictEqual((await hist([c.id])).map((h) => h.body), ['editor2 note']);
  assert.ok(s.body.kept_rows.some((k) => k.id === c.id));
});

test('F-33: an old offline draft (no version, ids derived) keeps unseen actions; the current form still removes', async () => {
  const id = 'EM-IT-20261121-R9N3';
  await save(ed1, { meta: meta(id), items: {}, actions: [{ desc: 'Keep', owner: 'A', priority: 'Low', status: 'Open' }, { desc: 'Drop', owner: 'B', priority: 'Low', status: 'Open' }], status: 'draft' });
  const st = await load(ed1, id);
  const old = oldClient(st);
  old.known_action_ids = st.actions.map((x) => x.id);   // what inspKnownIds derives on an old local copy
  old.actions = [st.actions[0]];                          // dropped by omission, no removal list (pre-fix-32 client)
  const s = await save(ed1, old);
  assert.strictEqual(s.status, 200);
  assert.strictEqual((await rows(id)).length, 2, 'no deletion by omission without a version');
  // the current form (with the version it loaded) removes the row it names, as before
  const cur = await load(ed1, id);
  cur.removed_action_ids = cur.actions.filter((x) => x.desc === 'Drop').map((x) => x.id);
  cur.actions = cur.actions.filter((x) => x.desc !== 'Drop');
  const s2 = await save(ed1, cur);
  assert.strictEqual(s2.status, 200);
  assert.deepStrictEqual((await rows(id)).map((r) => r.description), ['Keep']);
});
