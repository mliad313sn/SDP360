'use strict';
// W1-EVM over HTTP, fictitious data only: every EVM action is 404 while ppm_evm_enabled is '0' (= today); once '1',
// the project figures match the hand-computed reference of tests/ppm-evm.test.js, money is hidden from readers
// without the money right, task EVM fields are a committee write (ledger row), and the portfolio never sums currencies.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-evm-'));
process.env.DASH_USER = process.env.DASH_USER || 'ppmevm-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ppmevm-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ppmevm-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, pid, pidX, T = {}, task = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_task_evm'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  const A = sites.find((s) => /hounde/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('evm_pmo', ['viewer', 'committee-member']);
  T.fin = await mk('evm_fin', ['viewer', 'finance-viewer']);
  T.viewer = await mk('evm_viewer', ['viewer'], A);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'evm-prog', name: 'EVM' })).j.id;
  const obj = (await put('objective', T.pmo, { programme_id: prog, key: 'evm-o', name: 'O' })).j.id;
  pid = (await put('project', T.pmo, { objective_id: obj, key: 'EVM-1', name: 'Fictitious reference project', owner: 'evm_pmo', site_id: A, start_date: '2026-03-02', end_date: '2026-04-03' })).j.id;
  pidX = (await put('project', T.pmo, { objective_id: obj, key: 'EVM-2', name: 'Fictitious XOF project', owner: 'evm_pmo', site_id: A, start_date: '2026-03-02', end_date: '2026-03-13' })).j.id;
  const mkTask = async (p, name, o) => { const r = await put('task', T.pmo, { project_id: p, name, ...o }); assert.equal(r.status, 200, JSON.stringify(r.j)); return r.j.id; };
  task.A = await mkTask(pid, 'A', { status: 'done', progress_pct: 100, baseline_start: '2026-03-02', baseline_end: '2026-03-06' });
  task.B = await mkTask(pid, 'B', { status: 'in_progress', progress_pct: 30, baseline_start: '2026-03-09', baseline_end: '2026-03-20' });
  task.C = await mkTask(pid, 'C', { status: 'todo', baseline_start: '2026-03-23', baseline_end: '2026-04-03' });
  task.X = await mkTask(pidX, 'X', { status: 'in_progress', progress_pct: 50, baseline_start: '2026-03-02', baseline_end: '2026-03-13' });
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');

test('W1-EVM: 404 while off; on: committee writes the fields, the reference project reads as hand-computed, money rule, currencies separate', async () => {
  const url = `/api/governance/ppm/project/${pid}/evm?status_date=2026-03-11`;
  await sw({ ppm_evm_enabled: '0' });
  assert.equal((await send('GET', url, T.pmo)).status, 404);
  assert.equal((await send('GET', '/api/governance/ppm/evm/portfolio', T.pmo)).status, 404);
  assert.equal((await send('PUT', `/api/governance/ppm/task/${task.A}/evm`, T.pmo, { baseline_cost: 1 , cost_currency: 'USD' })).status, 404);
  assert.equal((await send('GET', '/api/governance/ppm/features', T.viewer)).j.evm, false);
  await sw({ ppm_evm_enabled: '1', ppm_time_entries_enabled: '1' });
  try {
    assert.equal((await send('PUT', `/api/governance/ppm/task/${task.A}/evm`, T.viewer, { baseline_cost: 1000, cost_currency: 'USD' })).status, 403, 'money write = committee');
    const noCur = await send('PUT', `/api/governance/ppm/task/${task.A}/evm`, T.pmo, { baseline_cost: 1000 });
    assert.equal(noCur.status, 400); assert.equal(noCur.j.code, 'CURRENCY_REQUIRED');
    const badM = await send('PUT', `/api/governance/ppm/task/${task.A}/evm`, T.pmo, { ev_method: 'guess' });
    assert.equal(badM.status, 400); assert.equal(badM.j.code, 'BAD_EV_METHOD');
    for (const [t, b] of [[task.A, { baseline_cost: 1000, cost_currency: 'USD', cost_rate: 22, capex_opex: 'capex' }], [task.B, { baseline_cost: 2000, cost_currency: 'USD', cost_rate: 25, ev_method: '50_50', capex_opex: 'opex' }],
      [task.C, { baseline_cost: 1000, cost_currency: 'USD', ev_method: '0_100', capex_opex: 'capex' }], [task.X, { baseline_cost: 500000, cost_currency: 'XOF', cost_rate: 10000 }]]) {
      const r = await send('PUT', `/api/governance/ppm/task/${t}/evm`, T.pmo, b); assert.equal(r.status, 200, JSON.stringify(r.j));
    }
    for (const [t, day, hours] of [[task.A, '2026-03-02', 24], [task.A, '2026-03-03', 24], [task.A, '2026-03-04', 2], [task.B, '2026-03-10', 20], [task.B, '2026-03-12', 8], [task.X, '2026-03-03', 20], [task.X, '2026-03-04', 20]]) assert.equal((await send('POST', `/api/governance/ppm/task/${t}/time`, T.pmo, { day, hours, person_label: 'Ana' })).status, 200);

    const v = await send('GET', url, T.viewer);
    assert.equal(v.status, 200); assert.equal(v.j.money_hidden, true); assert.equal(v.j.evm, null, 'no amount without the money right');
    const f = await send('GET', url, T.fin);
    assert.equal(f.status, 200); assert.equal(f.j.money_hidden, false); assert.equal(f.j.can_edit, false);
    const u = f.j.evm.currencies[0];
    assert.deepEqual([u.currency, u.bac, u.pv, u.ev, u.ac, u.spi, u.cpi, u.eac, u.etc, u.vac, u.tcpi], ['USD', 4000, 1600, 2000, 1600, 1.25, 1.25, 3200, 1600, 800, 0.8333]);
    assert.match(f.j.certification, /non certifié/);
    assert.equal((await send('GET', `/api/governance/ppm/project/${pid}/evm?status_date=11-03-2026`, T.fin)).j.code, 'BAD_STATUS_DATE');

    const pf = await send('GET', '/api/governance/ppm/evm/portfolio?status_date=2026-03-11', T.pmo);
    assert.equal(pf.status, 200);
    const by = Object.fromEntries(pf.j.portfolio.currencies.map((c) => [c.currency, c]));
    assert.deepEqual([by.USD.bac, by.USD.ev, by.XOF.bac, by.XOF.pv, by.XOF.ev, by.XOF.ac], [4000, 2000, 500000, 400000, 250000, 400000]);
    assert.equal(pf.j.portfolio.converted, null, 'no rate table configured → no converted figure');
    await sw({ ppm_evm_fx_rates: JSON.stringify({ target: 'USD', rates: { XOF: 0.002 }, as_of: '2026-03-01', source: 'fictitious test table' }) });
    const cv = (await send('GET', '/api/governance/ppm/evm/portfolio?status_date=2026-03-11', T.pmo)).j.portfolio.converted;
    assert.deepEqual([cv.converted, cv.bac, cv.ev], [true, 5000, 2500]);
    assert.equal((await send('GET', '/api/governance/ppm/evm/portfolio', T.viewer)).j.money_hidden, true);

    const h = await send('GET', `/api/governance/portfolio/project/${pid}/history`, T.pmo);
    assert.equal(h.j.events.filter((e) => e.action === 'task_evm_edit').length, 3, 'one ledger row per committee edit');
    // the cost never leaks through the portfolio view to a non-money reader (side table, not portfolio_tasks)
    const pv = await send('GET', '/api/governance/portfolio', T.viewer);
    assert.ok(!JSON.stringify(pv.j).includes('baseline_cost'));
  } finally { await sw({ ppm_evm_enabled: '0', ppm_time_entries_enabled: '0', ppm_evm_fx_rates: '' }); }
});
