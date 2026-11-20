'use strict';
const fetch = require('./_http-fetch');
// P06 — characterization of the routes moved out of server.js (assets, digest sends, backup schedule).
// Written BEFORE the move and run against the inline routes; the golden it pins
// (tests/__golden__/p06-extraction.json) must stay identical after the move: same status, same
// content-type / content-disposition, same body SHAPE (keys and types, recursively; array lengths) for
// anonymous, viewer, editor (no money role), finance-viewer and super_admin sessions.
// Writes are only exercised for refusals (anonymous / viewer) — never a real send or snapshot.
// Regenerate deliberately: GOLDEN_UPDATE=1 node --test tests/p06-extraction-characterization.test.js
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'p06-char-'));
process.env.DASH_USER = process.env.DASH_USER || 'p06-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'p06-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'p06-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const GOLDEN = _path.join(__dirname, '__golden__', 'p06-extraction.json');

const GETS = [
  '/api/assets/inventory', '/api/assets/lookups', '/api/assets/summary', '/api/assets/export.xlsx', '/api/assets/sync-status',
  '/api/assets/hygiene/summary', '/api/assets/hygiene/exceptions?kind=discovered', '/api/assets/hygiene/exceptions?kind=nope',
  '/api/assets/hygiene/export.xlsx', '/api/assets/hardware/summary', '/api/assets/hardware/exceptions?kind=low_ram',
  '/api/assets/hardware/exceptions?kind=nope', '/api/assets/hardware/export.xlsx',
  '/api/assets/finance/summary', '/api/assets/finance/export.xlsx', '/api/assets/finance/outliers', '/api/assets/finance/outliers/export.xlsx',
  '/api/assets/licences/summary', '/api/assets/licences/exceptions?kind=expired', '/api/assets/licences/export.xlsx',
  '/api/assets/software/summary', '/api/assets/software/exceptions?kind=under_licensed', '/api/assets/software/export.xlsx',
  '/api/assets/progress/leaderboard', '/api/assets/progress/trend', '/api/assets/reconcile/collector.ps1', '/api/assets/reconcile/defender.kql',
  '/api/assets/reconcile/summary', '/api/assets/reconcile/gaps', '/api/assets/reconcile/history', '/api/assets/reconcile/export.xlsx',
  '/api/assets/depreciation/summary', '/api/assets/depreciation/schedule', '/api/assets/depreciation-config',
  '/api/assets/investment/history', '/api/assets/investment/forecast', '/api/assets/investment/export.xlsx',
];
// Writes: refusals only (no session, viewer). Never executed with a privileged session here.
const WRITES = [
  ['POST', '/api/assets/hygiene/send'], ['POST', '/api/reports/scoreboard/send'], ['POST', '/api/reports/weekly/send'],
  ['POST', '/api/reports/asset-group/send'], ['POST', '/api/reports/asset-reminders/send'], ['POST', '/api/assets/progress/snapshot'],
  ['POST', '/api/assets/reconcile/preview'], ['POST', '/api/assets/reconcile/import'], ['POST', '/api/assets/reconcile/decision'],
  ['POST', '/api/assets/reconcile/snapshot'], ['PUT', '/api/assets/depreciation-config'],
  ['GET', '/api/admin/backup-schedule'], ['POST', '/api/admin/backup-schedule'], ['POST', '/api/admin/backup-now'],
];

function shape(v, depth = 0) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return depth > 3 ? 'array' : { array: v.length, first: v.length ? shape(v[0], depth + 1) : null };
  if (typeof v === 'object') {
    if (depth > 3) return 'object';
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = shape(v[k], depth + 1);
    return o;
  }
  return typeof v;
}

let server, base; const tokens = {};

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const adb = require('../assets-db');
  await adb.replaceTable('assets',
    ['asset_id', 'asset_name', 'site', 'state', 'product_type', 'manufacturer', 'serial_number', 'last_audit_status',
      'last_successful_audit_time', 'days_since_scan', 'user_name', 'department', 'purchase_cost', 'acquisition_date'],
    [
      { asset_id: 'P1', asset_name: 'PC-01', site: 'MANA', state: 'Discovered', product_type: 'Workstation', manufacturer: 'Dell',
        serial_number: 'S1', last_audit_status: null, last_successful_audit_time: null, days_since_scan: null, user_name: null,
        department: null, purchase_cost: '0.00', acquisition_date: null },
      { asset_id: 'P2', asset_name: 'PC-02', site: 'HGO', state: 'In Use', product_type: 'Laptop', manufacturer: 'HP',
        serial_number: 'S2', last_audit_status: 'Success', last_successful_audit_time: '2026-01-01', days_since_scan: '120',
        user_name: 'jdoe', department: 'IT', purchase_cost: '970,000.00', acquisition_date: '2023-02-01' },
    ]);
  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['super_admin']);
  tokens.super_admin = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  for (const [name, roles] of [['viewer', ['viewer']], ['editor', ['editor']], ['finance', ['viewer', 'finance-viewer']]]) {
    await rdb.createUser({ username: 'p06-' + name, full_name: 'P06 ' + name, password: 'p06-' + name + '-pass-0000', roles });
    tokens[name] = (await rdb.login('p06-' + name, 'p06-' + name + '-pass-0000')).token;
  }
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch { /* closed */ } });

async function probe(method, p, who) {
  const headers = who ? { 'x-report-token': tokens[who] } : {};
  if (method !== 'GET') headers['content-type'] = 'application/json';
  const r = await fetch(base + p, { method, headers, body: method === 'GET' ? undefined : '{}' });
  const ct = (r.headers.get('content-type') || '').split(';')[0];
  // Dates in download file names (e.g. reconciliation_2026-11-19.xlsx) depend on the day the test runs — normalise them
  // so the golden pins the route's naming pattern, not the calendar (flake seen in a full run the day after recording).
  const cdRaw = r.headers.get('content-disposition') || null;
  const out = { status: r.status, ct, cd: cdRaw && cdRaw.replace(/\d{4}-\d{2}-\d{2}/g, 'YYYY-MM-DD') };
  if (ct === 'application/json') {
    const j = await r.json();
    out.body = shape(j);
    if (r.status >= 400 && j && typeof j.error === 'string') out.error = j.error.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, '<id>');
  } else { await r.arrayBuffer(); }
  return out;
}

test('moved routes answer exactly as the golden says (status, headers, body shape, refusal text)', async () => {
  const got = {};
  for (const p of GETS) for (const who of [null, 'viewer', 'editor', 'finance', 'super_admin']) got[`GET ${p} as ${who || 'anon'}`] = await probe('GET', p, who);
  for (const [m, p] of WRITES) for (const who of [null, 'viewer']) got[`${m} ${p} as ${who || 'anon'}`] = await probe(m, p, who);
  if (process.env.GOLDEN_UPDATE === '1') { _fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n'); return; }
  const want = JSON.parse(_fs.readFileSync(GOLDEN, 'utf8'));
  for (const k of Object.keys(want)) assert.deepStrictEqual(got[k], want[k], k);
  assert.deepStrictEqual(Object.keys(got).sort(), Object.keys(want).sort());
});
