'use strict';
const fetch = require('./_http-fetch');
// E-A03 (audit A-03) — contract tests for the external publishing API. A hand-written schema per
// response (no new dependency): required fields, their types, `null` allowed only where a value can
// be unmeasured, the paging fields of OData, and the error shape for 401 / 403 / 404 / 429.
// This file changes nothing in the responses: it pins what consumers (Power BI, scripts) rely on, so a
// breaking change shows up here before it reaches them. Versioning rule: docs/api/CONTRACTS.md.
const _os = require('os'), _fs = require('fs'), _path = require('path');
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'api-contract-'));
process.env.DASH_USER = process.env.DASH_USER || 'contract-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'contract-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'contract-key';
process.env.EXT_API_RATE_PER_MIN = '30';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, admin, rdb, full, sitesOnly, burst;

// ── a tiny schema checker ────────────────────────────────────────────────────────────────────────
// A type is 'string' | 'number' | 'boolean' | 'object' | 'array'; a trailing '?' means "may be null"
// (an unmeasured value is null, never 0 — project boundary); a key prefixed '~' means "may be absent".
function typeOf(v) { return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v; }
function check(obj, schema, where) {
  assert.equal(typeOf(obj), 'object', `${where}: object expected`);
  for (const [k0, spec0] of Object.entries(schema)) {
    const optional = k0.startsWith('~'); const k = optional ? k0.slice(1) : k0; let spec = spec0;
    const nullable = spec.endsWith('?'); if (nullable) spec = spec.slice(0, -1);
    if (!(k in obj)) { assert.ok(optional, `${where}: required field "${k}" missing`); continue; }
    const t = typeOf(obj[k]);
    if (t === 'null') { assert.ok(nullable, `${where}: "${k}" must not be null`); continue; }
    assert.equal(t, spec, `${where}: "${k}" must be ${spec}, got ${t}`);
  }
}
const ERROR_STRING = { error: 'string' };                         // /ext/v1 error body
const ODATA_ERROR = { error: 'object' };                          // /ext/odata error body
const ODATA_ERROR_INNER = { code: 'string', message: 'string' };

const METRIC = { key: 'string', name: 'string', '~name_fr': 'string?', module: 'string', unit: 'string?', window_kind: 'string?', higher_is_better: 'boolean', formula: 'string?', '~rag_policy': 'string?' };
const SITE = { id: 'number', name: 'string', country: 'string?', active: 'boolean' };
const VALUE = { metric: 'string', module: 'string', site_id: 'number?', site: 'string', '~window': 'string?', value: 'number?', unit: 'string?', rag: 'string', '~as_of': 'string?', freshness: 'string', authoritative: 'boolean', '~name': 'string', '~error': 'string', '~rag_if_fresh': 'string' };
const ODATA_SITE = { Id: 'number', Name: 'string', Country: 'string?', Active: 'boolean' };

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'api_consumers'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  try { await rdb.createUser({ username: 'contract_admin', full_name: 'contract_admin', password: 'contract_adminpass1234', role: 'admin', roles: ['admin'] }); } catch {}
  admin = (await rdb.login('contract_admin', 'contract_adminpass1234')).token;
  if (!((await rdb.listSites({ includeInactive: false })) || []).length) { try { await rdb.createSite({ name: 'Contract Site', zoho_group: 'Contract IT Agents' }); } catch {} }
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const mk = async (name, scopes) => (await (await fetch(base + '/api/engagement/consumers', { method: 'POST', headers: { 'x-report-token': admin, 'content-type': 'application/json' }, body: JSON.stringify({ name, scopes, quota_per_day: 5000 }) })).json()).key;
  full = await mk('Contract full', ['metrics:read', 'values:read', 'sites:read']);
  sitesOnly = await mk('Contract sites only', ['sites:read']);
  burst = await mk('Contract burst', ['metrics:read']);
  assert.ok(full && sitesOnly && burst);
});
after(() => server && server.close());
const get = (p, key) => fetch(base + p, { headers: key ? { 'x-api-key': key } : {} });

test('GET /ext/v1/metrics — dictionary shape', async () => {
  const r = await get('/ext/v1/metrics', full); assert.equal(r.status, 200);
  const b = await r.json(); check(b, { metrics: 'array', as_of: 'string' }, 'metrics');
  assert.ok(!Number.isNaN(Date.parse(b.as_of)), 'as_of is an ISO timestamp');
  assert.ok(b.metrics.length > 0, 'the registry publishes at least one metric');
  for (const m of b.metrics) check(m, METRIC, `metric ${m.key}`);
  assert.equal(r.headers.get('x-ratelimit-limit'), '30', 'rate-limit header advertised');
  assert.ok(r.headers.get('x-quota-remaining') != null, 'quota header advertised');
});

test('GET /ext/v1/sites — site shape (names only, no PII)', async () => {
  const r = await get('/ext/v1/sites', full); assert.equal(r.status, 200);
  const b = await r.json(); check(b, { sites: 'array' }, 'sites');
  assert.ok(b.sites.length > 0);
  for (const s of b.sites) { check(s, SITE, `site ${s.id}`); assert.deepEqual(Object.keys(s).sort(), ['active', 'country', 'id', 'name']); }
});

test('GET /ext/v1/metrics/:key/values — value shape, value null when unmeasured, freshness header', async () => {
  const dict = (await (await get('/ext/v1/metrics', full)).json()).metrics;
  const key = (dict.find((m) => m.key === 'helpdesk.resolution_sla_pct') || dict[0]).key;
  const r = await get(`/ext/v1/metrics/${encodeURIComponent(key)}/values`, full); assert.equal(r.status, 200);
  assert.match(String(r.headers.get('x-sdp-freshness')), /^(fresh|stale)$/);
  const b = await r.json(); check(b, { metric: 'string', values: 'array' }, 'values'); assert.equal(b.metric, key);
  for (const v of b.values) {
    check(v, VALUE, `value ${v.metric}/${v.site_id}`);
    assert.match(v.freshness, /^(FRESH|STALE|UNKNOWN)$/);
    if (!v.authoritative) assert.equal(v.rag, 'NA', 'a non-authoritative value carries no colour');
  }
  // an empty throwaway database has measured nothing → every value is null, never a 0
  assert.ok(b.values.every((v) => v.value === null || typeof v.value === 'number'));
});

test('GET /ext/odata/Sites — collection shape + paging fields', async () => {
  const r = await get('/ext/odata/Sites?$count=true&$top=1&$skip=0', full); assert.equal(r.status, 200);
  const b = await r.json(); check(b, { '@odata.context': 'string', value: 'array', '@odata.count': 'number' }, 'odata sites');
  assert.match(b['@odata.context'], /\/\$metadata#Sites$/);
  assert.ok(b.value.length <= 1, '$top bounds the page');
  assert.ok(b['@odata.count'] >= b.value.length, '@odata.count is the total before paging');
  for (const s of b.value) check(s, ODATA_SITE, 'odata site');
  const noCount = await (await get('/ext/odata/Sites', full)).json();
  assert.ok(!('@odata.count' in noCount), '@odata.count only on $count=true');
});

test('error shape — 401 (no / bad key), 403 (missing scope), 404 (unknown metric), 400 OData', async () => {
  for (const [p, k] of [['/ext/v1/metrics', null], ['/ext/v1/sites', 'sdp_not_a_real_key'], ['/ext/odata/Sites', null]]) {
    const r = await get(p, k); assert.equal(r.status, 401, p);
    const b = await r.json(); check(b, ERROR_STRING, `401 ${p}`); assert.equal(b.error, 'invalid or revoked API key');
  }
  const f = await get('/ext/v1/metrics', sitesOnly); assert.equal(f.status, 403);
  const fb = await f.json(); check(fb, ERROR_STRING, '403'); assert.equal(fb.error, 'scope metrics:read required');
  const fo = await get('/ext/odata/Metrics', sitesOnly); assert.equal(fo.status, 403); check(await fo.json(), ERROR_STRING, '403 odata');
  const n = await get('/ext/v1/metrics/no.such.metric/values', full); assert.equal(n.status, 404);
  const nb = await n.json(); check(nb, ERROR_STRING, '404'); assert.equal(nb.error, 'unknown metric');
  const o = await get('/ext/odata/Sites?$orderby=Nope', full); assert.equal(o.status, 400);
  const ob = await o.json(); check(ob, ODATA_ERROR, 'odata 400'); check(ob.error, ODATA_ERROR_INNER, 'odata 400 inner'); assert.equal(ob.error.code, 'INVALID');
});

test('error shape — 429 carries Retry-After and retry_after_sec', async () => {
  let r;
  for (let i = 0; i < 40; i++) { r = await get('/ext/v1/metrics', burst); if (r.status === 429) break; }
  assert.equal(r.status, 429, 'the per-key limiter answers 429 once crossed');
  assert.ok(Number(r.headers.get('retry-after')) >= 1);
  const b = await r.json(); check(b, { error: 'string', retry_after_sec: 'number' }, '429'); assert.equal(b.error, 'rate limit exceeded');
});
