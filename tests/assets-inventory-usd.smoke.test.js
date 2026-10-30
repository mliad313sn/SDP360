'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Assets UI-polish Task 0 smoke — /api/assets/inventory gains USD money + owner fields.
// Boots the express app IN-PROCESS (start() guarded by require.main → no port bind).
// The reader returns raw XOF strings; the route converts them to USD via the
// configured xof_usd_rate and adds purchase_cost_usd / book_value_usd / tco_usd to
// each row WITHOUT changing the bare-array response shape the page consumes.
// Backends pinned to sqlite. Run with --test-force-exit (top-level cron keeps the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'assets-inv-usd-'));
process.env.DASH_USER = process.env.DASH_USER || 'assets-inv-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'assets-inv-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'assets-inv-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const RATE = 0.00165;

let server, base, adminToken;

before(async () => {
  const { app } = require('../server');        // start() guarded → no port bind
  const rdb = require('../reports-db');
  const adb = require('../assets-db');
  const reportConfig = require('../services/reportConfig');

  (await reportConfig.setConfig(rdb.db, { xof_usd_rate: String(RATE) }, 'smoke'));

  // Raw XOF strings (comma-grouped like the real AP export) + owner fields.
  (await adb.replaceTable('assets',
    ['asset_id', 'asset_name', 'site', 'state', 'product_type',
     'purchase_cost', 'current_book_value', 'total_cost_of_ownership',
     'acquisition_date', 'user_name', 'department'],
    [
      { asset_id: 'INV1', asset_name: 'PC-INV-01', site: 'MANA', state: 'In Use',
        product_type: 'Workstation', purchase_cost: '2,250,000.00',
        current_book_value: '750,000.00', total_cost_of_ownership: '2,250,000.00',
        acquisition_date: '14 May 2025', user_name: 'jdoe', department: 'IT' },
    ]));

  const me = ((await rdb.listUsers()) || []).find(u => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  (await rdb.setUserRoles(me.id, ['admin']));
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin + returned a token');
  adminToken = sess.token;

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(r => { try { server ? server.close(r) : r(); } catch { r(); } });
  await new Promise(r => setTimeout(r, 150));   // let libuv handles fully settle before --test-force-exit
});

const auth = () => ({ 'x-report-token': adminToken });

test('GET /api/assets/inventory → bare array; the row carries CONVERTED USD money + owner fields', async () => {
  const res = await fetch(base + '/api/assets/inventory', { headers: { ...auth(), connection: 'close' } });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body), 'inventory response is a BARE ARRAY (page shape preserved)');
  const row = body.find(r => r.asset_id === 'INV1');
  assert.ok(row, 'the seeded asset is present');

  // Converted USD, NOT the raw XOF string. 2,250,000 × 0.00165 = 3712.5
  assert.equal(typeof row.purchase_cost_usd, 'number', 'purchase_cost_usd is a number, not the raw string');
  assert.ok(Math.abs(row.purchase_cost_usd - 3712.5) < 0.01, `purchase_cost_usd ~3712.5, got ${row.purchase_cost_usd}`);
  // 750,000 × 0.00165 = 1237.5
  assert.ok(Math.abs(row.book_value_usd - 1237.5) < 0.01, `book_value_usd ~1237.5, got ${row.book_value_usd}`);
  // 2,250,000 × 0.00165 = 3712.5
  assert.ok(Math.abs(row.tco_usd - 3712.5) < 0.01, `tco_usd ~3712.5, got ${row.tco_usd}`);

  // Owner + date fields flow straight through.
  assert.equal(row.acquisition_date, '14 May 2025');
  assert.equal(row.user_name, 'jdoe');
  assert.equal(row.department, 'IT');
});
