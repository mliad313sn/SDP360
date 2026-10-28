'use strict';
const fetch = require('./_http-fetch');
// Fiche M7 — external API hardening on sqlite: the key is accepted in a HEADER only (X-Api-Key /
// Authorization: Bearer), `?api_key=` → 400 with a migration message, OData properties outside the
// entity (incl. __proto__) → 400, @odata.context built from public_base_url (never Host), a per-key
// rate limiter (low threshold through EXT_API_RATE_PER_MIN) → 429 + Retry-After, generic error bodies.
const _os = require('os'), _fs = require('fs'), _path = require('path');
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ext-api-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'ext-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ext-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ext-smoke-key';
process.env.EXT_API_RATE_PER_MIN = '12'; // low threshold so the limiter is reachable inside one test
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, admin, rdb, key, key2, key3;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'api_consumers'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  try { await rdb.createUser({ username: 'ext_admin', full_name: 'ext_admin', password: 'ext_adminpass1234', role: 'admin', roles: ['admin'] }); } catch {}
  admin = (await rdb.login('ext_admin', 'ext_adminpass1234')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const mk = async (name) => (await (await fetch(base + '/api/engagement/consumers', { method: 'POST', headers: { 'x-report-token': admin, 'content-type': 'application/json' }, body: JSON.stringify({ name, scopes: ['metrics:read', 'values:read', 'sites:read'], quota_per_day: 5000 }) })).json()).key;
  key = await mk('Power BI'); key2 = await mk('Script'); key3 = await mk('Matrix');
  assert.ok(key && key.startsWith('sdp_'));
});
after(() => server && server.close());
const get = (p, headers) => fetch(base + p, { headers: headers || {} });

test('?api_key= in the query string → 400 with a migration message, never authenticated', async () => {
  const r = await get(`/ext/v1/metrics?api_key=${key}`);
  assert.equal(r.status, 400);
  const b = await r.json(); assert.match(b.error, /X-Api-Key/); assert.match(b.error, /no longer accepted/);
  assert.equal((await get(`/ext/odata/Metrics?api_key=${key}`)).status, 400, 'OData paths refuse it too');
  assert.equal((await get(`/ext/v1/metrics?api_key=${key}`, { 'x-api-key': key })).status, 400, 'even alongside a valid header — the URL form must disappear from clients');
});

test('header forms still work: X-Api-Key and Authorization: Bearer; no key → 401', async () => {
  assert.equal((await get('/ext/v1/metrics')).status, 401);
  assert.equal((await get('/ext/v1/metrics', { authorization: 'Basic abc' })).status, 401, 'only Bearer is a key carrier');
  const a = await get('/ext/v1/metrics', { 'x-api-key': key }); assert.equal(a.status, 200); assert.equal(a.headers.get('x-ratelimit-limit'), '12');
  const b = await get('/ext/v1/sites', { authorization: `Bearer ${key}` }); assert.equal(b.status, 200); assert.ok(Array.isArray((await b.json()).sites));
});

test('OData: unknown $orderby / $select property and __proto__ → 400 with a generic body', async () => {
  const h = { 'x-api-key': key };
  for (const q of ['$orderby=Nope desc', '$orderby=__proto__', '$select=Key,constructor', "$filter=__proto__ eq 'x'", "$filter=prototype eq 'x'"]) {
    const r = await get(`/ext/odata/Metrics?${q}`, h); assert.equal(r.status, 400, q);
    const b = await r.json(); assert.equal(b.error.code, 'INVALID'); assert.equal(b.error.message, 'invalid query option', 'no internal text echoed');
  }
  assert.equal((await get('/ext/odata/Values?$orderby=__proto__', h)).status, 400, 'Values validates before resolving any metric');
  const ok = await get('/ext/odata/Metrics?$orderby=Key asc&$select=Key,Module&$top=2', h); assert.equal(ok.status, 200);
  const ob = await ok.json(); assert.ok(ob.value.length <= 2); if (ob.value.length) assert.deepEqual(Object.keys(ob.value[0]).sort(), ['Key', 'Module']);
});

test('@odata.context uses public_base_url — relative when unset, never the Host header', async () => {
  const h = { 'x-api-key': key, host: 'evil.example.net' };
  const sd = await (await get('/ext/odata/', h)).json();
  assert.equal(sd['@odata.context'], '/ext/odata/$metadata', 'unset → relative base');
  assert.ok(!sd['@odata.context'].includes('evil.example.net'));
  await require('../services/reportConfig').setConfig(rdb.db, { public_base_url: 'https://itops.example.test/' }, 'ext_admin');
  const sd2 = await (await get('/ext/odata/', h)).json(); assert.equal(sd2['@odata.context'], 'https://itops.example.test/ext/odata/$metadata');
  const col = await (await get('/ext/odata/Metrics?$top=1', h)).json(); assert.equal(col['@odata.context'], 'https://itops.example.test/ext/odata/$metadata#Metrics');
  assert.ok(!JSON.stringify(col).includes('evil.example.net') && !JSON.stringify(col).includes('127.0.0.1'));
});

test('per-key rate limiter: 429 + Retry-After once the per-minute threshold is crossed; another key is unaffected', async () => {
  const h = { 'x-api-key': key2 };
  let statuses = [];
  for (let i = 0; i < 14; i++) statuses.push((await get('/ext/v1/metrics', h)).status);
  assert.ok(statuses.slice(0, 12).every(s => s === 200), `first 12 ok: ${statuses}`);
  assert.equal(statuses[12], 429); assert.equal(statuses[13], 429);
  const r = await get('/ext/v1/metrics', h); assert.equal(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) >= 1); assert.equal((await r.json()).error, 'rate limit exceeded');
  assert.equal((await get('/ext/v1/metrics', { 'x-api-key': key3 })).status, 200, 'the limiter is keyed by the API key, not the IP (same client address, fresh key)');
});

test('authz matrix: /ext routes sit behind the key auth (no session) — unknown entity set 404 generic', async () => {
  const r = await get('/ext/odata/Nope', { 'x-api-key': key3 }); assert.equal(r.status, 404);
  const v = await get('/ext/v1/values', { 'x-api-key': key3 }); assert.equal(v.status, 400); assert.equal((await v.json()).error, 'metrics=a,b required');
});

test('QUERY_KEY_MESSAGE is exported for the docs/help to quote', () => {
  const { QUERY_KEY_MESSAGE } = require('../routes/extApi');
  assert.match(QUERY_KEY_MESSAGE, /Authorization: Bearer/);
});
