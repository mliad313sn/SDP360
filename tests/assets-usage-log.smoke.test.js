'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// G-06 (audit 2026-09-24) — the Assets module now leaves a trace in system_log.
//
// Before this, system_log carried auth + report_* only, so nobody could answer "how
// many asset managers opened the module in the last 30 days" — the KPI the audit engine
// asks for by name, and the only way to tell whether the asset-engagement work shipped
// in September is actually used.
//
// Two things are pinned here: the read route writes ONE row per actor per day (a tab
// switch must not spam the journal), and an export is always logged (it is an act, not
// a glance).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'assets-usage-'));
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';
process.env.MEETINGS_BACKEND = 'sqlite';
process.env.INSPECTION_BACKEND = 'sqlite';
process.env.TRACKER_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'usage-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'usage-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'usage-smoke-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, token, rdb;

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const adb = require('../assets-db');
  adb.replaceTable('assets',
    ['asset_id', 'asset_name', 'site', 'state', 'product_type', 'manufacturer', 'serial_number'],
    [{ asset_id: 'A1', asset_name: 'PC-MANA-01', site: 'MANA', state: 'In Use',
       product_type: 'Workstation', manufacturer: 'Dell', serial_number: 'SN-0001' }]);
  // The inventory export is admin+ since G-11, and this suite asserts an export IS
  // logged — so the actor needs the role the route now requires.
  const me = (rdb.listUsers() || []).find(u => u.username === process.env.DASH_USER);
  rdb.setUserRoles(me.id, ['admin']);
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  token = sess.token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const auth = () => ({ 'x-report-token': token });
const count = (action) => rdb.countSystemLog({ action });
// logEvent is deliberately fire-and-forget (a dead log must never break a request),
// so the row lands just after the response — give the microtask queue a turn.
const settle = () => new Promise(r => setTimeout(r, 60));

test('opening the module is logged ONCE per actor per day', async () => {
  const before0 = await count('assets_viewed');
  const r1 = await fetch(base + '/api/assets/summary', { headers: auth() });
  assert.equal(r1.status, 200);
  await settle();
  assert.strictEqual(await count('assets_viewed'), before0 + 1, 'first view logged');

  for (let i = 0; i < 3; i++) await fetch(base + '/api/assets/summary', { headers: auth() });
  await settle();
  assert.strictEqual(await count('assets_viewed'), before0 + 1, 'further views on the same day are not re-logged');
});

test('the logged view carries the assets category and the acting user', async () => {
  const { rows } = await rdb.listSystemLog({ action: 'assets_viewed' }, { limit: 1 });
  assert.ok(rows.length, 'a row exists');
  assert.strictEqual(rows[0].category, 'assets');
  assert.strictEqual(rows[0].actor, process.env.DASH_USER);
});

test('an export is logged every time — it is an act, not a glance', async () => {
  const before0 = await count('asset_export');
  await fetch(base + '/api/assets/export.xlsx', { headers: auth() });
  await settle();
  await fetch(base + '/api/assets/export.xlsx', { headers: auth() });
  await settle();
  assert.strictEqual(await count('asset_export'), before0 + 2);
});

test('a failing log never breaks the request it rides on', async () => {
  const original = rdb.logEvent;
  rdb.logEvent = () => { throw new Error('journal down'); };
  try {
    const res = await fetch(base + '/api/assets/summary', { headers: auth() });
    assert.equal(res.status, 200, 'the read still answers while the journal is broken');
  } finally { rdb.logEvent = original; }
});
