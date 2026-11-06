'use strict';
// W2-PPM (E-P03..E-P08) over HTTP, fictitious data only: every action is 404 while its PROPOSED switch is '0'
// (= today), then behaves as specified once the switch is '1'. The switches are put back to '0' after each test.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-w2-'));
process.env.DASH_USER = process.env.DASH_USER || 'ppmw2-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ppmw2-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ppmw2-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, A, pid, obj, T = {}, ID = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'portfolio_tasks'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  A = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name)).id;
  const mk = async (u, roles, site) => { const x = await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); ID[u] = x && x.id != null ? Number(x.id) : null; return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('w2_pmo', ['viewer', 'committee-member']);
  T.cio = await mk('w2_cio', ['viewer', 'committee-member']);
  T.fin = await mk('w2_fin', ['viewer', 'finance-viewer']);
  T.viewer = await mk('w2_viewer', ['viewer'], A);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'w2-prog', name: 'W2' })).j.id;
  obj = (await put('objective', T.pmo, { programme_id: prog, key: 'w2-o', name: 'O' })).j.id;
  pid = (await put('project', T.pmo, { objective_id: obj, key: 'W2-1', name: 'Fictitious WAN upgrade', owner: 'w2_pmo', site_id: A, start_date: '2026-11-02', end_date: '2027-03-31', budget: 1000, currency: 'USD' })).j.id;
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j, r }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');

test('E-P03: capacity is 404 while ppm_capacity_view is 0; on: per site × week, no money; reassignment needs a reason', async () => {
  await sw({ ppm_capacity_view: '0' });
  const t1 = (await put('task', T.pmo, { project_id: pid, name: 'Survey', owner: 'Ana', start_date: '2026-11-02', end_date: '2026-11-13', allocation_pct: 70 })).j.id;
  assert.ok(t1);
  assert.equal((await put('task', T.pmo, { project_id: pid, name: 'Design', owner: 'Bob', start_date: '2026-11-02', end_date: '2026-11-13', allocation_pct: 60 })).status, 200);
  assert.equal((await send('GET', '/api/governance/ppm/capacity', T.pmo)).status, 404);
  assert.equal((await send('GET', '/api/governance/ppm/features', T.viewer)).j.capacity, false);
  assert.equal((await put('task', T.pmo, { id: t1, owner: 'Bob' })).status, 200, 'switch off: no reason needed (today)');
  await sw({ ppm_capacity_view: '1' });
  try {
    const c = await send('GET', '/api/governance/ppm/capacity', T.viewer);
    assert.equal(c.status, 200, JSON.stringify(c.j));
    const site = c.j.capacity.sites.find((x) => x.site === String(A));
    assert.ok(site && site.weeks.some((w) => w.people_over === 1));
    assert.equal(c.j.capacity.conflicts[0].owner, 'Bob');
    assert.doesNotMatch(JSON.stringify(c.j), /"budget"|"spent"/);
    assert.equal(c.j.capacity.conflicts[0].excess_pct, 30);
    const no = await put('task', T.pmo, { id: t1, owner: 'Cy' });
    assert.equal(no.status, 400); assert.equal(no.j.code, 'REASON_REQUIRED');
    assert.equal((await put('task', T.pmo, { id: t1, owner: 'Cy', reason: 'Bob on leave (fictitious)' })).status, 200);
    const h = await send('GET', `/api/governance/portfolio/project/${pid}/history`, T.pmo);
    assert.deepEqual(h.j.events.filter((e) => e.action === 'task_reassigned').map((e) => [e.old_value, e.new_value, e.note]), [['Ana', 'Bob', null], ['Bob', 'Cy', 'Bob on leave (fictitious)']]);
  } finally { await sw({ ppm_capacity_view: '0' }); }
});

test('E-P04: budget periods 404 while off; on: committee writes, finance reads, a viewer gets no amounts', async () => {
  const url = `/api/governance/ppm/project/${pid}/budget-periods`;
  await sw({ ppm_budget_periods_enabled: '0' });
  assert.equal((await send('GET', url, T.pmo)).status, 404);
  assert.equal((await send('PUT', url, T.pmo, { period: '2026-11', currency: 'USD', kind: 'baseline', amount: 10 })).status, 404);
  await sw({ ppm_budget_periods_enabled: '1' });
  try {
    assert.equal((await send('PUT', url, T.pmo, { period: '2026-11', currency: 'USD', kind: 'baseline', amount: 500 })).status, 200);
    assert.equal((await send('PUT', url, T.pmo, { period: '2026-11', currency: 'XOF', kind: 'baseline', amount: 300000 })).status, 200);
    const noWhy = await send('PUT', url, T.pmo, { period: '2026-11', currency: 'USD', kind: 'forecast', amount: 650 });
    assert.equal(noWhy.status, 400); assert.equal(noWhy.j.code, 'JUSTIFICATION_REQUIRED');
    assert.equal((await send('PUT', url, T.fin, { period: '2026-11', currency: 'USD', kind: 'actual', amount: 1 })).status, 403, 'finance reads, the committee writes');
    const fin = await send('GET', url, T.fin);
    assert.equal(fin.status, 200); assert.equal(fin.j.view.currencies.length, 2); assert.match(fin.j.certification, /not certified/);
    const vw = await send('GET', url, T.viewer);
    assert.equal(vw.status, 200); assert.equal(vw.j.money_hidden, true); assert.equal(vw.j.view, null);
    assert.doesNotMatch(JSON.stringify(vw.j), /300000|500/);
    assert.equal((await send('GET', '/api/governance/ppm/features', T.viewer)).j.budget_periods, true);
  } finally { await sw({ ppm_budget_periods_enabled: '0' }); }
});
