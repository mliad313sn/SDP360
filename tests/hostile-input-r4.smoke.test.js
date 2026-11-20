'use strict';
// N-R4-4 (P11 round 4, security seat): hostile input answered 500 on four routes. Each now answers 400 (typed,
// field-named message, no correlation-id 500), and GET /api/reports/action-departments never 500s.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'hostile-r4-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'hr4-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'hr4-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'hr4-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb; let tok;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  try { await rdb.createUser({ username: 'hr4_super', full_name: 'hr4', password: 'hr4_superpass1234', roles: ['super_admin'] }); } catch {}
  tok = (await rdb.login('hr4_super', 'hr4_superpass1234')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, body) => fetch(base + p, { method: m, headers: { 'x-report-token': tok, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

test('GET /api/kpi-policies/:id/diff without against, or with a non-numeric id → 400', async () => {
  for (const p of ['/api/kpi-policies/1/diff', '/api/kpi-policies/1/diff?against=', '/api/kpi-policies/abc/diff?against=1', '/api/kpi-policies/1/diff?against=NaN']) {
    const r = await send('GET', p); const j = await r.json();
    assert.strictEqual(r.status, 400, p + ' → ' + JSON.stringify(j));
    assert.ok(!j.correlation_id, p);
  }
});

test('POST /api/trackers/:key/rollback/<non-number> → 400', async () => {
  for (const n of ['ZZZ', '-1', '0', '1.5']) {
    const r = await send('POST', '/api/trackers/any-key/rollback/' + n);
    assert.strictEqual(r.status, 400, n + ' → ' + r.status);
  }
});

test('DELETE /api/governance/portfolio/<unknown kind>/:id → 400', async () => {
  const r = await send('DELETE', '/api/governance/portfolio/ZZZ/1');
  const txt = await r.text(); const j = txt ? JSON.parse(txt) : {};
  assert.strictEqual(r.status, 400, JSON.stringify(j));
  assert.match(j.error, /unknown portfolio entity/);
});

test('PUT /api/reports/schedule without report_type (or with a bad time) → 400', async () => {
  const r = await send('PUT', '/api/reports/schedule', {});
  assert.strictEqual(r.status, 400); assert.match((await r.json()).error, /report_type/);
  const r2 = await send('PUT', '/api/reports/schedule', { report_type: 'coordinator', cadence: 'weekly', enabled: true, day: 'MON', time: '99:99' });
  assert.strictEqual(r2.status, 400); assert.match((await r2.json()).error, /time/);
});

test('GET /api/reports/action-departments never answers 500', async () => {
  for (const q of ['', '?site=abc', '?site=%00', '?report=../../x']) {
    const r = await send('GET', '/api/reports/action-departments' + q);
    assert.ok(r.status < 500, q + ' → ' + r.status);
  }
});
