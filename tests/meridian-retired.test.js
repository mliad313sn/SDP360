'use strict';
// A-20 phase 1 — Meridian kill switch (report_config meridian_enabled, PROPOSED D-5 / repo D-07).
// "0" = retired: the inbound API and the on-demand sync answer 404, the job skips with
// "disabled" before any network call. Default (no row / "1") keeps today's behaviour.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'meridian-retired-'));
process.env.DASH_USER = process.env.DASH_USER || 'meridian-ret-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'meridian-ret-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'meridian-ret-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const IN_KEY = 'meridian-inbound-secret';
let server, base, token, rdb, reportConfig;

function req(method, path, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request(base + path, { method, headers: headers || {} }, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => { let body = null; try { body = b ? JSON.parse(b) : null; } catch { body = b; } resolve({ status: res.statusCode, body }); });
    });
    r.on('error', reject); r.end();
  });
}
const setEnabled = (v) => reportConfig.setConfig(rdb.db, { meridian_enabled: v }, 'test');

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  reportConfig = require('../services/reportConfig');
  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['super_admin']);
  token = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('default (no meridian_enabled row) → behaviour unchanged: 401 without key', async () => {
  const c = await reportConfig.getConfig(rdb.db);
  assert.equal(c.meridian_enabled, '1', 'default keeps the connector mounted');
  const r = await req('GET', '/api/actions/open?site=MGO');
  assert.equal(r.status, 401);
});

test('meridian_enabled=0 → GET /api/actions/open is 404 even with the right X-API-Key', async () => {
  await reportConfig.setConfig(rdb.db, { meridian_in_key: IN_KEY }, 'test');
  await setEnabled('0');
  try {
    const r = await req('GET', '/api/actions/open?site=MGO', { 'X-API-Key': IN_KEY });
    assert.equal(r.status, 404);
  } finally { await setEnabled('1'); }
  const back = await req('GET', '/api/actions/open?site=ZZZ_NOPE', { 'X-API-Key': IN_KEY });
  assert.equal(back.status, 200, 'switching back to 1 restores the route without restart');
});

test('meridian_enabled=0 → POST /api/meridian/sync is 404 for a super_admin', async () => {
  await setEnabled('0');
  try {
    const r = await req('POST', '/api/meridian/sync',
      { 'x-report-token': token, 'x-dash-key': process.env.DASHBOARD_API_KEY, 'content-type': 'application/json' });
    assert.equal(r.status, 404);
  } finally { await setEnabled('1'); }
});

test('meridian_enabled=0 → sync-resources.main() resolves {skipped:"disabled"} and never calls the HTTP client', async () => {
  const { main } = require('../tools/meridian/sync-resources');
  let called = false, read = false;
  const r = await main({
    getConfig: async () => ({ meridian_enabled: '0', meridian_base_url: 'https://m', meridian_out_key: 'k' }),
    readSites: async () => { read = true; return []; }, readPeople: async () => { read = true; return []; },
    httpPost: async () => { called = true; return { data: {} }; }, log: () => {},
  });
  assert.deepEqual(r, { skipped: 'disabled' });
  assert.equal(called, false, 'no network call when retired');
  assert.equal(read, false, 'no DB read when retired');
});
