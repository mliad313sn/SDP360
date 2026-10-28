'use strict';
// SP3 T2 — GET /api/reports/:id/importable-actions lists the report site's open
// Meetings + Inspection actions (to pull into the report as references).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'impact-'));
process.env.DASH_USER = process.env.DASH_USER || 'impact-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'impact-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'impact-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, token, rid;

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(base + path, { headers: { 'x-report-token': token, 'x-dash-key': process.env.DASHBOARD_API_KEY } },
      (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); })
      .on('error', reject);
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const mdb = require('../meetings-db');
  const codes = await rdb.listSiteModuleCodes('meetings');
  assert.ok(codes.length, 'seed has a meetings site code');
  const site = codes[0];
  rid = (await rdb.ensureReport(site.site_id, 2026, 40)).id;

  const db = mdb.getDB();
  const m = (await db.prepare("INSERT INTO md_meetings (reference, site_code, department, meeting_date, status) VALUES ('IMP_Test_2026-07',?,?,?,?)")
    .run(site.code, 'Technical Services', '2026-07-01', 'signed'));
  (await db.prepare("INSERT INTO md_actions (meeting_id, description, owner_it, target_date, status) VALUES (?,?,?,?,?)")
    .run(m.lastID, 'Fix VSAT', 'Ousmane', '2026-07-01', 'open'));
  (await db.prepare("INSERT INTO md_actions (meeting_id, description, status) VALUES (?,?,?)")
    .run(m.lastID, 'Done thing', 'closed')); // excluded

  const me = ((await rdb.listUsers()) || []).find(u => u.username === process.env.DASH_USER);
  (await rdb.setUserRoles(me.id, ['admin']));
  token = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('lists open meetings actions (with origin_id) + an inspection array', async () => {
  const r = await get(`/api/reports/${rid}/importable-actions`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.meetings) && Array.isArray(r.body.inspection));
  const it = r.body.meetings.find(a => a.title === 'Fix VSAT');
  assert.ok(it, 'open meetings action present');
  assert.ok(Number.isInteger(it.origin_id) && it.origin_id > 0, 'carries origin_id for the reference');
  assert.ok(!r.body.meetings.some(a => a.title === 'Done thing'), 'closed excluded');
});
