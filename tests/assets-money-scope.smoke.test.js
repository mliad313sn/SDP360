'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// G-11 (audit 2026-09-24, owner decision: restrict to admin+) — who may read the money.
//
// Every /api/assets/* route was guarded by `requireReportSession` alone, so any
// authenticated account — a `viewer` included — could read the group's asset value,
// book value, TCO and investment forecast.
//
// The decision is NOT to close the module: the engagement loop depends on a site asset
// manager reaching Inventory, Hygiene, Hardware, Progress and Réconciliation. So the
// money-only routes require `admin`, and the routes that merely CARRY money fields keep
// serving everyone — with the money stripped. A worklist without amounts is still a
// worklist; that is already the rule everywhere else in this module.
//
// Honest reserve, recorded here because it decides how much this is worth: with 24 of 29
// accounts holding `admin` (F-03), this bites properly only once G-12 lands.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'money-scope-'));
process.env.DASH_USER = process.env.DASH_USER || 'money-scope-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'money-scope-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'money-scope-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminTok, viewerTok;

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const adb = require('../assets-db');

  (await adb.replaceTable('assets',
    ['asset_id', 'asset_name', 'site', 'state', 'product_type', 'manufacturer', 'serial_number',
     'purchase_cost', 'current_book_value', 'total_cost_of_ownership', 'acquisition_date'],
    [{ asset_id: 'A1', asset_name: 'PC-1', site: 'MANA', state: 'In Use', product_type: 'Laptop',
       manufacturer: 'Dell', serial_number: 'SN1', purchase_cost: '2,250,000.00',
       current_book_value: '1,500,000.00', total_cost_of_ownership: '2,400,000.00',
       acquisition_date: '2024-01-01' }]));

  const me = ((await rdb.listUsers()) || []).find(u => u.username === process.env.DASH_USER);
  (await rdb.setUserRoles(me.id, ['admin']));
  adminTok = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;

  // A plain viewer — the account this goal is actually about.
  (await rdb.createUser({ username: 'money-scope-viewer', password: 'viewer-pass-0000', full_name: 'V', role: 'viewer' }));
  const v = ((await rdb.listUsers()) || []).find(u => u.username === 'money-scope-viewer');
  (await rdb.setUserRoles(v.id, ['viewer']));
  viewerTok = (await rdb.login('money-scope-viewer', 'viewer-pass-0000')).token;

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const get = (p, t) => fetch(base + p, { headers: { 'x-report-token': t } });

const MONEY_ROUTES = [
  '/api/assets/finance/summary',
  '/api/assets/licences/summary',
  '/api/assets/investment/history',
  '/api/assets/investment/forecast',
  '/api/assets/depreciation/summary',
  '/api/assets/depreciation/schedule',
];

test('a viewer is refused every money-only route', async () => {
  for (const r of MONEY_ROUTES) {
    const res = await get(r, viewerTok);
    assert.strictEqual(res.status, 403, `${r} must refuse a viewer, got ${res.status}`);
  }
});

test('an admin still reads them', async () => {
  for (const r of MONEY_ROUTES) {
    const res = await get(r, adminTok);
    assert.strictEqual(res.status, 200, `${r} must serve an admin, got ${res.status}`);
  }
});

test('the engagement surfaces stay open — that loop depends on them', async () => {
  for (const r of ['/api/assets/inventory', '/api/assets/lookups', '/api/assets/summary',
    '/api/assets/hygiene/summary', '/api/assets/hardware/summary', '/api/assets/progress/leaderboard']) {
    const res = await get(r, viewerTok);
    assert.strictEqual(res.status, 200, `${r} must stay open to a viewer, got ${res.status}`);
  }
});

test('inventory serves a viewer WITHOUT any amount, and an admin with them', async () => {
  const forViewer = await (await get('/api/assets/inventory', viewerTok)).json();
  assert.ok(Array.isArray(forViewer) && forViewer.length, 'still a bare array with the asset');
  const row = forViewer[0];
  assert.strictEqual(row.asset_name, 'PC-1', 'identity survives — this is still a worklist');
  for (const k of ['purchase_cost_usd', 'book_value_usd', 'tco_usd',
    'purchase_cost', 'current_book_value', 'total_cost_of_ownership']) {
    assert.ok(!(k in row), `money key ${k} must not reach a viewer`);
  }
  const forAdmin = await (await get('/api/assets/inventory', adminTok)).json();
  assert.ok('purchase_cost_usd' in forAdmin[0], 'an admin still gets the converted amounts');
});

test('the inventory export follows the same rule', async () => {
  assert.strictEqual((await get('/api/assets/export.xlsx', viewerTok)).status, 403,
    'a spreadsheet is the easiest way to walk out with the numbers');
  assert.strictEqual((await get('/api/assets/export.xlsx', adminTok)).status, 200);
});
