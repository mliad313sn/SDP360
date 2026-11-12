'use strict';
// F-ARCH-02 — GET /api/sample/:viewId was open to any session, called Analytics directly (no PII
// filter), returned raw rows plus a 500-character raw preview. It is now super_admin only, goes
// through the same PII filter as every other view read, and answers a capped sample.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'sample-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'sm-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'sm-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'sm-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const axios = require('axios');

const REQUEST_TABLE = '106803000000002201';
const LONG = 'x'.repeat(900);
const CSV = ['Request ID,Subject,Requester Email,Phone,Site',
  ...Array.from({ length: 40 }, (_, i) => `${1000 + i},${i === 0 ? LONG : 'Printer down'},user${i}@example.org,+22500000${i},Hounde`)].join('\n');

let server, base, rdb, superTok, calls = [];
const realGet = axios.get, realPost = axios.post;
const get = (p, t) => fetch(base + p, { headers: { 'x-report-token': t } });

async function tokenFor(username, roles) {
  await rdb.createUser({ username, full_name: username, password: username + '-pass-0000', roles });
  return (await rdb.login(username, username + '-pass-0000')).token;
}

before(async () => {
  // Stub the two outbound calls: the OAuth refresh and the Analytics view export.
  axios.post = async () => ({ data: { access_token: 'stub-token', expires_in: 3600 } });
  axios.get = async (url, opts) => {
    if (/\/views\/\d+\/data/.test(String(url))) { calls.push(String(url)); return { data: CSV, status: 200 }; }
    return realGet.call(axios, url, opts);
  };
  const { app } = require('../server');
  rdb = require('../reports-db');
  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['super_admin']);
  superTok = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { axios.get = realGet; axios.post = realPost; try { server && server.close(); } catch {} });

test('a viewer, an editor and an admin are refused, and Analytics is not called', async () => {
  for (const [name, roles] of [['sm-viewer', ['viewer']], ['sm-editor', ['editor']], ['sm-admin', ['admin']], ['sm-exec', ['executive']]]) {
    const r = await get(`/api/sample/${REQUEST_TABLE}`, await tokenFor(name, roles));
    assert.equal(r.status, 403, `${name} must be refused`);
  }
  assert.equal(calls.length, 0, 'a refused caller must not trigger a download of the view');
});

test('no session is refused', async () => {
  const r = await fetch(base + `/api/sample/${REQUEST_TABLE}`);
  assert.ok([401, 403].includes(r.status));
});

test('super_admin gets a capped sample with the personal-data columns removed and no raw preview', async () => {
  const r = await get(`/api/sample/${REQUEST_TABLE}`, superTok);
  assert.equal(r.status, 200);
  const text = await r.text();
  const body = JSON.parse(text);
  assert.ok(!('rawPreview' in body), 'rawPreview is gone');
  assert.ok(!/example\.org|\+2250000/.test(text), 'no e-mail or phone value anywhere in the body');
  assert.ok(!body.columns.some((c) => /email|phone/i.test(c)), 'personal-data columns are not listed');
  assert.ok(body.columns.includes('Subject') && body.columns.includes('Site'));
  assert.ok(body.sample.length <= 5, 'at most 5 rows');
  assert.equal(body.totalRows, 40);
  assert.ok(body.sample[0].Subject.length <= 201, 'long cells are cut');
  assert.ok(text.length < 20000, 'the response is bounded');
});

test('a view that is not registered is refused before any outbound call', async () => {
  const n = calls.length;
  const r = await get('/api/sample/999999999999', superTok);
  assert.equal(r.status, 403);
  assert.equal(calls.length, n);
});

test('a second call inside the cool-down window is refused (the export downloads the whole view)', async () => {
  const r = await get(`/api/sample/${REQUEST_TABLE}`, superTok);
  assert.equal(r.status, 429);
});
