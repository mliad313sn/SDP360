'use strict';
// P5 / goal A3 — GET /api/me/work carries the extra queue sources + my snoozed lines ONLY while ui_home_queue = '1'
// (off = today's answer, byte for byte the same keys); each source keeps its module's scope; snooze is presentation only
// and per user; and the inbox answers within the load budget on this throwaway database (API part of "load < 1 s").
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'hq-extra-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'hqx-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'hqx-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'hqx-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, rc, hounde, mana, T = {}, U = {};

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db'); rc = require('../services/reportConfig');
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /^mana$/i.test(s.name)).id;
  const mk = async (k, roles, site) => {
    const u = 'hqx_' + k;
    await rdb.createUser({ username: u, full_name: 'Person ' + k, password: u + 'pass1234', roles, site_id: site });
    T[k] = (await rdb.login(u, u + 'pass1234')).token; U[k] = (await rdb.listUsers()).find((x) => x.username === u);
  };
  await mk('ed', ['editor'], hounde);
  await mk('other', ['editor'], mana);
  await mk('admin', ['admin']);
  const gs = require('../services/governanceStore').makeGovernanceStore(rdb.pgHandle());
  await gs.submitRfi({ kind: 'ux', title: 'Hounde RFI', problem: 'the hounde page is slow to open', site_id: hounde }, { user: U.other });
  await gs.submitRfi({ kind: 'ux', title: 'Mana RFI', problem: 'the mana page is slow to open', site_id: mana }, { user: U.other });
  // a portfolio task owned by the editor, overdue
  const H = rdb.pgHandle();
  const pg = await H.prepare(`INSERT INTO portfolio_programmes (key, name) VALUES ('HQX-P', 'Prog') RETURNING id`).get();
  const ob = await H.prepare(`INSERT INTO portfolio_objectives (programme_id, key, name) VALUES (?, 'HQX-O', 'Obj') RETURNING id`).get(pg.id);
  const pj = await H.prepare(`INSERT INTO portfolio_projects (objective_id, key, name, owner, stage) VALUES (?, 'HQX-1', 'Proj', 'someone', 'in_progress') RETURNING id`).get(ob.id);
  await H.prepare(`INSERT INTO portfolio_tasks (project_id, name, owner, end_date, status) VALUES (?, 'Late task', 'hqx_ed', '2026-01-01', 'in_progress')`).run(pj.id);
  await H.prepare(`INSERT INTO portfolio_tasks (project_id, name, owner, end_date, status) VALUES (?, 'Someone else', 'hqx_other', '2026-01-01', 'in_progress')`).run(pj.id);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const call = async (t, method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(t ? { 'x-report-token': t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const sw = (o) => rc.setConfig(rdb.db, o, 'test');

test('off (default): no queue_extra, no queue_snoozed, snooze route 404', async () => {
  assert.equal((await rc.getConfig(rdb.db)).ui_home_queue, '0');
  const w = (await call(T.ed, 'GET', '/api/me/work')).body;
  assert.ok(!('queue_extra' in w) && !('queue_snoozed' in w));
  assert.equal((await call(T.ed, 'PUT', '/api/me/work/snooze', { key: 'meetings:1', until: '2026-12-01' })).status, 404);
});

test('on: each extra source scoped to its module — RFIs mine + my sites only, tasks I own, no gate/access for an editor', async () => {
  await sw({ ui_home_queue: '1' });
  try {
    const x = (await call(T.ed, 'GET', '/api/me/work')).body.queue_extra;
    assert.ok(x, 'present while on');
    assert.deepStrictEqual(x.rfis.items.map((i) => i.title).map((t) => t.replace(/^[a-z ]+: /, '')), ['Hounde RFI'], 'my site only');
    assert.deepStrictEqual(x.tasks.items.map((i) => i.title), ['Late task']);
    assert.equal(x.tasks.items[0].overdue, true);
    assert.deepStrictEqual(x.access, { count: 0, items: [] }, 'an editor decides no access request');
    assert.deepStrictEqual(x.gates, { count: 0, items: [] }, 'an editor signs no gate');
    assert.strictEqual(x.change_requests, null, 'change requests switched off → not measured, never 0');
    assert.ok(x.not_measured.includes('change_requests'));
    const o = (await call(T.other, 'GET', '/api/me/work')).body.queue_extra;
    assert.deepStrictEqual(o.rfis.items.map((i) => i.title.replace(/^[a-z ]+: /, '')).sort(), ['Hounde RFI', 'Mana RFI'], 'the requester sees their own RFI on another site');
    const a = (await call(T.admin, 'GET', '/api/me/work')).body.queue_extra;
    assert.ok(a.gates && a.access, 'the admin tier is measured on the committee sources');
  } finally { await sw({ ui_home_queue: '0' }); }
});

test('snooze: validated, per user, presentation only; the item is untouched', async () => {
  await sw({ ui_home_queue: '1' });
  try {
    const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    assert.equal((await call(T.ed, 'PUT', '/api/me/work/snooze', { key: 'not a key', until: d(3) })).status, 400);
    assert.equal((await call(T.ed, 'PUT', '/api/me/work/snooze', { key: 'meetings:1', until: d(45) })).status, 400, 'at most 30 days');
    assert.equal((await call(T.ed, 'PUT', '/api/me/work/snooze', { key: 'meetings:1', until: d(0) })).status, 400, 'must be after today');
    const ok = await call(T.ed, 'PUT', '/api/me/work/snooze', { key: 'meetings:1', until: d(7) });
    assert.equal(ok.status, 200); assert.deepStrictEqual(ok.body.snoozed, { 'meetings:1': d(7) });
    assert.deepStrictEqual((await call(T.ed, 'GET', '/api/me/work')).body.queue_snoozed, { 'meetings:1': d(7) });
    assert.deepStrictEqual((await call(T.other, 'GET', '/api/me/work')).body.queue_snoozed, {}, 'never another person’s');
    assert.equal((await call(T.ed, 'PUT', '/api/me/work/snooze', { key: 'meetings:1', until: null })).status, 200);
    assert.deepStrictEqual((await call(T.ed, 'GET', '/api/me/work')).body.queue_snoozed, {});
    assert.equal((await call(null, 'PUT', '/api/me/work/snooze', { key: 'meetings:1', until: d(3) })).status, 401);
  } finally { await sw({ ui_home_queue: '0' }); }
});

test('load budget (API part): /api/me/work with every queue source answers in < 1 s (median of 5, throwaway DB)', async () => {
  await sw({ ui_home_queue: '1', mywork_awaiting_me_enabled: '1' });
  try {
    const ms = [];
    for (let i = 0; i < 5; i++) { const t0 = Date.now(); assert.equal((await call(T.ed, 'GET', '/api/me/work')).status, 200); ms.push(Date.now() - t0); }
    ms.sort((a, b) => a - b);
    assert.ok(ms[2] < 1000, `median ${ms[2]} ms`);
  } finally { await sw({ ui_home_queue: '0', mywork_awaiting_me_enabled: '0' }); }
});
