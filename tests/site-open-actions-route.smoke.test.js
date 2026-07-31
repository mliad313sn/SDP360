'use strict';
// GET /api/reports/:id/site-open-actions — the report site's open follow-ups for
// the near-duplicate guard. sqlite; --test-force-exit.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'soa-'));
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';
process.env.MEETINGS_BACKEND = 'sqlite';
process.env.INSPECTION_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'soa-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'soa-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'soa-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, token, rid, dept;

const get = (path, tok) => new Promise((resolve, reject) => {
  const headers = { 'x-dash-key': process.env.DASHBOARD_API_KEY };
  if (tok) headers['x-report-token'] = tok;
  http.get(base + path, { headers }, (res) => {
    let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
  }).on('error', reject);
});

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const site = (await rdb.listSiteModuleCodes('meetings'))[0];
  rid = (await rdb.ensureReport(site.site_id, 2026, 34)).id;
  dept = (await rdb.listDepartments({}))[0].name;
  await rdb.saveActionItems(rid, [
    { task: 'Helix underground surveillance software deployment', department: dept, status: 'on_hold' },
    { task: 'Closed one', department: dept, status: 'closed' },
  ]);
  const me = (rdb.listUsers() || []).find(u => u.username === process.env.DASH_USER);
  rdb.setUserRoles(me.id, ['admin']);
  token = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await new Promise(res => { server = http.createServer(app).listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('returns the site open follow-ups with task + lineage; excludes closed', async () => {
  const r = await get(`/api/reports/${rid}/site-open-actions`, token);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.actions));
  const open = r.body.actions.find(a => a.task.startsWith('Helix'));
  assert.ok(open, 'open action present');
  assert.ok('lineage' in open && 'uid' in open, 'carries lineage + uid');
  assert.ok(!r.body.actions.some(a => a.task === 'Closed one'), 'closed excluded');
});

test('404 for an unknown report', async () => {
  const r = await get(`/api/reports/99999999/site-open-actions`, token);
  assert.equal(r.status, 404);
});

test('gate: no token → not 200', async () => {
  const r = await get(`/api/reports/${rid}/site-open-actions`, null);
  assert.notEqual(r.status, 200);
});
