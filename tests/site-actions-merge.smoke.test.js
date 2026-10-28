'use strict';
// SP1b Task 3 — merge/unmerge routes + the durability proof: after a merge, a
// FULL report re-save through PUT /:id/actions (the real hot path) must NOT wipe
// the merge. Backends sqlite; --test-force-exit (cron keeps the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'samerge-'));
process.env.DASH_USER = process.env.DASH_USER || 'samerge-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'samerge-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'samerge-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, token, code, rid, uid, dept;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(base + path, { method, headers: {
      'x-report-token': token, 'x-dash-key': process.env.DASHBOARD_API_KEY,
      ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } },
      (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const reportGroupTitles = (p) => (p.groups.report.items || []).map(i => i.title);

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const codes = await rdb.listSiteModuleCodes('meetings');
  assert.ok(codes.length, 'seed has a meetings site code');
  code = codes[0].code;
  const r = await rdb.ensureReport(codes[0].site_id, 2026, 31);
  rid = r.id;
  dept = (await rdb.listDepartments({}))[0].name;
  await rdb.saveActionItems(rid, [{ task: 'Retyped from a meeting', department: dept, status: 'open' }]);
  uid = (await rdb.getReport(rid)).action_items[0].uid;
  assert.ok(uid, 'action got a uid');

  const me = ((await rdb.listUsers()) || []).find(u => u.username === process.env.DASH_USER);
  (await rdb.setUserRoles(me.id, ['admin']));
  token = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await new Promise(res => { server = http.createServer(app).listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('merge folds the row out; a full report re-save does NOT wipe it; unmerge restores', async () => {
  let hub = (await req('GET', `/api/reports/site-actions?site=${encodeURIComponent(code)}`)).body;
  assert.ok(reportGroupTitles(hub).includes('Retyped from a meeting'), 'present before merge');

  const m = await req('POST', `/api/reports/action/${uid}/merge`, { source: 'meetings', origin_id: 42 });
  assert.equal(m.status, 200);

  hub = (await req('GET', `/api/reports/site-actions?site=${encodeURIComponent(code)}`)).body;
  assert.ok(!reportGroupTitles(hub).includes('Retyped from a meeting'), 'folded out of Report group after merge');

  // DURABILITY: re-save the whole report through the real PUT (round-tripping uid)
  const put = await req('PUT', `/api/reports/${rid}/actions`,
    [{ uid, task: 'Retyped from a meeting', department: dept, status: 'open' }]);
  assert.equal(put.status, 200);
  const rdb = require('../reports-db');
  assert.equal((await rdb.getReport(rid)).action_items[0].source, 'meetings', 'merge SURVIVED the full re-save');

  const u = await req('POST', `/api/reports/action/${uid}/unmerge`);
  assert.equal(u.status, 200);
  hub = (await req('GET', `/api/reports/site-actions?site=${encodeURIComponent(code)}`)).body;
  assert.ok(reportGroupTitles(hub).includes('Retyped from a meeting'), 'back after unmerge');
});

test('bad source → 400', async () => {
  const r = await req('POST', `/api/reports/action/${uid}/merge`, { source: 'nope', origin_id: 1 });
  assert.equal(r.status, 400);
});
