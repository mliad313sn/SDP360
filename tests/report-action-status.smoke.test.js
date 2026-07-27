'use strict';
// Inline status change for a report follow-up from the hub — POST
// /api/reports/action/:uid/status. Backends sqlite; --test-force-exit.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'rastat-'));
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';
process.env.MEETINGS_BACKEND = 'sqlite';
process.env.INSPECTION_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'rastat-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'rastat-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'rastat-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, token, rid, uid, dept;

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const r = http.request(base + path, { method: 'POST', headers: {
      'x-report-token': token, 'x-dash-key': process.env.DASHBOARD_API_KEY,
      'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); });
    r.on('error', reject); r.write(data); r.end();
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const codes = await rdb.listSiteModuleCodes('meetings');
  const site = codes[0];
  rid = (await rdb.ensureReport(site.site_id, 2026, 33)).id;
  dept = (await rdb.listDepartments({}))[0].name;
  await rdb.saveActionItems(rid, [{ task: 'a follow-up', department: dept, status: 'open' }]);
  uid = (await rdb.getReport(rid)).action_items[0].uid;
  const me = (rdb.listUsers() || []).find(u => u.username === process.env.DASH_USER);
  rdb.setUserRoles(me.id, ['admin']);
  token = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await new Promise(res => { server = http.createServer(app).listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('status change persists; invalid rejected', async () => {
  const rdb = require('../reports-db');
  let r = await post(`/api/reports/action/${uid}/status`, { status: 'in_progress' });
  assert.equal(r.status, 200);
  assert.equal((await rdb.getReport(rid)).action_items[0].status, 'in_progress');
  r = await post(`/api/reports/action/${uid}/status`, { status: 'closed' });
  assert.equal(r.status, 200);
  assert.equal((await rdb.getReport(rid)).action_items[0].status, 'closed');
  r = await post(`/api/reports/action/${uid}/status`, { status: 'BOGUS' });
  assert.equal(r.status, 400);
});
