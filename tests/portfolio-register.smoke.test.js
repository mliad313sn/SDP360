'use strict';
// PORTFOLIO LOT 3 over HTTP, fictitious data only. ppm_portfolio_dashboard_v2_enabled (PROPOSED, '0' = today).
//   off : every register route 404s, the feature flag reads false
//   on  : rows + 5 KPI cards; each card's drill (its filters as a query) returns exactly `count` rows; the CSV / XLSX
//         export carries the same filtered rows; a money-hidden reader gets no amount / currency / budget status in the
//         JSON, the CSV or the XLSX; the stage move feeds the stage age; currencies never added together.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-reg-'));
process.env.DASH_USER = process.env.DASH_USER || 'reg-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'reg-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'reg-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const XLSX = require('xlsx');
const UrlFilters = require('../public/lib/urlFilters');
const UI = require('../public/lib/portfolioRegister');
let server, base, rdb, cfg, obj, T = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_lookup_values'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const mk = async (u, roles) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('reg_pmo', ['viewer', 'committee-member']);
  T.viewer = await mk('reg_viewer', ['viewer']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  await sw({ ppm_intake_register_enabled: '1', ppm_data_quality_enabled: '1', ppm_portfolio_dashboard_v2_enabled: '0' });
  const prog = (await put('programme', T.pmo, { key: 'reg-prog', name: 'REG' })).j.id;
  obj = (await put('objective', T.pmo, { programme_id: prog, key: 'reg-o', name: 'O' })).j.id;
  const P = (key, o) => ({ objective_id: obj, key, name: 'Project ' + key, owner: 'Site IT', sponsor: 'Plant manager', charter: 'Objective, scope and benefits of the project, long enough.',
    start_date: '2027-03-01', end_date: '2027-09-30', status: 'planned', business_need: { problem: 'p' }, expected_value: 'v', priority: 'medium', decision_required: 'no',
    delivery_effort: 'medium', risk_exposure: 'low', delivery_lead: 'Team', avg_fte: 0.5, value_states: { dependencies: 'none_known' }, ...o });
  for (const [k, o] of [['R1', { priority: 'critical', budget: 1000, currency: 'USD', budget_status: 'approved', decision_required: 'yes' }],
    ['R2', { priority: 'high', budget: 500, currency: 'EUR', budget_status: 'requested', risk_exposure: 'high' }],
    ['R3', { priority: 'low', budget: 200, currency: 'USD', budget_status: 'not_budgeted', owner: null }]]) {
    const r = await put('project', T.pmo, P(k, o)); assert.equal(r.status, 200, r.txt); T[k] = r.j.id;
  }
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); const buf = Buffer.from(await r.arrayBuffer()); const txt = buf.toString('utf8'); let j = null; try { j = JSON.parse(txt); } catch (_) {} return { status: r.status, j, txt, buf, ct: r.headers.get('content-type') }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (o) => cfg.setConfig(rdb.db, o, 'smoke');
const reg = (t, q = '') => send('GET', '/api/governance/portfolio/register' + q, t);

test('switch off (= today): every register route 404s, the feature flag is false', async () => {
  for (const p of ['', '.csv', '.xlsx']) assert.equal((await send('GET', '/api/governance/portfolio/register' + p, T.pmo)).status, 404, p);
  assert.equal((await send('GET', '/api/governance/ppm/features', T.pmo)).j.portfolio_dashboard_v2, false);
});

test('switch on: rows, KPI cards, every drill returns exactly its count; currencies apart', async () => {
  await sw({ ppm_portfolio_dashboard_v2_enabled: '1' });
  assert.equal((await send('GET', '/api/governance/ppm/features', T.pmo)).j.portfolio_dashboard_v2, true);
  const r = await reg(T.pmo);
  assert.equal(r.status, 200, r.txt);
  assert.equal(r.j.money_hidden, false); assert.equal(r.j.rows.length, 3);
  for (const k of r.j.kpis) {
    if (!k.drill) continue;
    const d = await reg(T.pmo, UrlFilters.serialise(k.drill, UI.SCHEMA));
    assert.equal(d.j.rows.length, k.count, k.key + ': drill rows = card count');
  }
  const by = Object.fromEntries(r.j.kpis.map((k) => [k.key, k]));
  assert.equal(by.critical_high.value, 2); assert.equal(by.decisions_required.value, 1);
  assert.deepStrictEqual(by.budget_identified.value, { USD: 1200, EUR: 500 });
  assert.ok(Number.isInteger(by.data_quality.value));
  assert.equal(r.j.reports.find((x) => x.key === 'without_owners').count, 1);
});

test('filters, sort and the stage age; export keeps the filters (CSV + XLSX)', async () => {
  const mv = await send('POST', `/api/governance/portfolio/project/${T.R2}/stage`, T.pmo, { to: 'approval' });
  assert.equal(mv.status, 200, mv.txt);
  const f = await reg(T.pmo, '?priority=critical,high&sort=priority&dir=desc');
  assert.deepStrictEqual(f.j.rows.map((x) => x.key).sort(), ['R1', 'R2']);
  assert.equal(f.j.rows.find((x) => x.key === 'R2').stage_age_days, 0, 'stage entered today');
  assert.equal(f.j.analyses.status.approved_not_started, 1);
  const csv = await send('GET', '/api/governance/portfolio/register.csv?priority=critical,high', T.pmo);
  assert.equal(csv.status, 200, csv.txt); assert.match(csv.ct, /text\/csv/);
  const lines = csv.txt.replace(/^﻿/, '').trim().split(/\r?\n/);
  assert.equal(lines.length - 1, 2, 'same filtered rows'); assert.ok(lines[0].includes('"Budget"'));
  const x = await send('GET', '/api/governance/portfolio/register.xlsx?priority=critical,high', T.pmo);
  assert.equal(x.status, 200);
  const wb = XLSX.read(x.buf, { type: 'buffer' });
  assert.equal(XLSX.utils.sheet_to_json(wb.Sheets.Register).length, 2);
  assert.deepStrictEqual(XLSX.utils.sheet_to_json(wb.Sheets.Filters).map((r) => r.filter), ['priority']);
});

test('money-hidden reader: no amount, currency or budget status in the JSON, the CSV or the XLSX', async () => {
  const r = await reg(T.viewer);
  assert.equal(r.status, 200, r.txt); assert.equal(r.j.money_hidden, true); assert.equal(r.j.rows.length, 3);
  for (const k of ['"budget"', '"budget_status"', '"currency"', 'not_budgeted', '1200']) assert.ok(!r.txt.includes(k), 'leak ' + k);
  assert.equal(r.j.kpis.find((k) => k.key === 'budget_identified').reason, 'MONEY_HIDDEN');
  assert.equal((await reg(T.viewer, '?budget_status=approved')).j.rows.length, 3, 'a budget filter is ignored, never an oracle');
  const csv = await send('GET', '/api/governance/portfolio/register.csv?cols=ref,name,budget,currency,budget_status', T.viewer);
  assert.equal(csv.status, 200);
  assert.ok(!/Budget|Currency/.test(csv.txt.split(/\r?\n/)[0]));
  const x = await send('GET', '/api/governance/portfolio/register.xlsx', T.viewer);
  const rows = XLSX.utils.sheet_to_json(XLSX.read(x.buf, { type: 'buffer' }).Sheets.Register);
  assert.ok(rows.every((row) => !('Budget' in row) && !('Currency' in row) && !('Budget status' in row)));
  await sw({ ppm_portfolio_dashboard_v2_enabled: '0' });
  assert.equal((await reg(T.pmo)).status, 404, 'switched back off');
});
