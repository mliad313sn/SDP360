'use strict';
// Integration slice-1 — dashboard → 4MyPeople /api/v1 client. Pure unit tests
// with an injected HTTP function (no network, no live API key needed).
const { test } = require('node:test');
const assert = require('node:assert');
const { makeFmpClient } = require('../services/fmpClient');

// axios-shaped mock: resolves { data: <responseBody> } where body = { data:[...], count }
function okHttp(body) { return async (url, cfg) => ({ data: body }); }

test('listEmployees/listReadiness unwrap the {data:[...]} envelope', async () => {
  const emp = makeFmpClient({ httpGet: okHttp({ data: [{ id: 1, firstName: 'A' }], count: 1 }), apiKey: 'k' });
  assert.deepEqual(await emp.listEmployees(), [{ id: 1, firstName: 'A' }]);
  const rdy = makeFmpClient({ httpGet: okHttp({ data: [{ employeeId: 1, readinessPercent: 80 }], count: 1 }), apiKey: 'k' });
  assert.deepEqual(await rdy.listReadiness(), [{ employeeId: 1, readinessPercent: 80 }]);
});

test('sends X-API-Key header + targets the configured base URL', async () => {
  let seenUrl, seenCfg;
  const spy = async (url, cfg) => { seenUrl = url; seenCfg = cfg; return { data: { data: [] } }; };
  const c = makeFmpClient({ httpGet: spy, apiKey: 'secret-key', baseUrl: 'http://host:3000/api/v1' });
  await c.listEmployees();
  assert.equal(seenUrl, 'http://host:3000/api/v1/employees');
  assert.equal(seenCfg.headers['X-API-Key'], 'secret-key');
});

test('graceful degrade: HTTP failure → [] (never throws, never breaks the dashboard)', async () => {
  const boom = async () => { throw new Error('ECONNREFUSED'); };
  const c = makeFmpClient({ httpGet: boom });
  assert.deepEqual(await c.listEmployees(), []);
  assert.deepEqual(await c.listReadiness(), []);
});

test('malformed body (no data array) → []', async () => {
  const c = makeFmpClient({ httpGet: okHttp({ unexpected: true }), apiKey: 'k' });
  assert.deepEqual(await c.listEmployees(), []);
});

// ── route factory (routes/fourmypeople.js) ──────────────────────────────────
function routerHarness() {
  const routes = {};
  const router = { get: (path, ...mws) => { routes[path] = mws; } };
  return { express: { Router: () => router }, routes };
}

test('fmp route: returns {data:[...]} + short-TTL cache (one upstream call)', async () => {
  const { express, routes } = routerHarness();
  let calls = 0;
  const fmpClient = { listEmployees: async () => { calls++; return [{ id: 1 }]; }, listReadiness: async () => [] };
  const passthrough = (req, res, next) => next();
  const requireRole = () => passthrough;                 // role gate → passthrough in the test
  require('../routes/fourmypeople')({ express, requireReportSession: passthrough, requireRole, fmpClient });
  const mws = routes['/api/integration/fmp/employees'];
  assert.ok(Array.isArray(mws) && mws.length >= 3, 'gate + handler registered');
  const handler = mws[mws.length - 1];
  let body; const res = { json: (b) => { body = b; }, status: () => res };
  await handler({}, res);
  assert.deepEqual(body, { data: [{ id: 1 }] });
  await handler({}, res);                                // served from cache
  assert.equal(calls, 1, 'second call hit the cache, not the upstream');
});
