'use strict';
// Infrastructure Health — GET /api/analytics/infra/summary smoke. Mounts routes/opmanager.js
// directly (its factory requires ../reports-db itself), backed by a throwaway sqlite via
// SDP_DATA_DIR — so an empty seed is a valid state: sites:[] + a well-formed coverage object,
// never a 500. Core http (not fetch) — undici's keep-alive pool trips --test-force-exit.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'infrahealth-smoke-'));
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';
process.env.MEETINGS_BACKEND = 'sqlite';
process.env.INSPECTION_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'infra-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'infra-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'infra-smoke-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('node:http');

function makeApp() {
  const requireReportSession = (req, _res, next) => { req.reportUser = { id: 1, username: 'infra-smoke', roles: ['admin'] }; next(); };
  const requireAdmin = (_req, _res, next) => next();
  const app = express();
  app.use(require('../routes/opmanager')({ express, requireReportSession, requireAdmin, requireSuperAdmin: requireAdmin, fetchView: async () => [] }));
  return app;
}
// Core http (not fetch) — mirrors tests/site-awareness-routes.smoke + wan-sla-routes.smoke.
function call(app, path) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      http.get(`http://127.0.0.1:${port}${path}`, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => { server.close(); let body = {}; try { body = JSON.parse(data); } catch (_) {} resolve({ status: res.statusCode, body }); });
      }).on('error', (e) => { server.close(); reject(e); });
    });
  });
}

test('GET /api/analytics/infra/summary → 200 with sites/fleet/coverage shape (empty seed OK)', async () => {
  const app = makeApp();
  const { status, body } = await call(app, '/api/analytics/infra/summary?period=week');
  assert.equal(status, 200, 'must not 500');
  assert.ok(Array.isArray(body.sites), 'sites is an array');
  assert.ok(body.fleet && typeof body.fleet === 'object', 'fleet object present');
  assert.ok(body.coverage && typeof body.coverage === 'object' && 'available' in body.coverage, 'coverage carries available');
  assert.equal(body.period, 'week');
  assert.equal(typeof body.as_of, 'string');
});

test('each returned site (if any) carries the 4 families + overall_rag', async () => {
  const app = makeApp();
  const { body } = await call(app, '/api/analytics/infra/summary?period=month');
  assert.equal(body.period, 'month');
  for (const s of (body.sites || [])) {
    assert.ok(s.families && ['wan1', 'wan2', 'lan', 'wifi', 'servers'].every(f => f in s.families), 'families has wan1/wan2/lan/wifi/servers');
    assert.ok(typeof s.overall_rag === 'string', 'overall_rag present');
  }
});

test('GET /api/analytics/infra/trend → 200 with labels/series shape', async () => {
  const app = makeApp();
  const { status, body } = await call(app, '/api/analytics/infra/trend?site=HGO&months=6');
  assert.equal(status, 200, 'must not 500');
  assert.ok(Array.isArray(body.labels), 'labels is an array');
  assert.ok(body.series && typeof body.series === 'object', 'series object present');
});

test('GET /api/analytics/infra/trend?site=<unknown> → 200 with empty labels (never 500)', async () => {
  const app = makeApp();
  const { status, body } = await call(app, '/api/analytics/infra/trend?site=__nope__');
  assert.equal(status, 200, 'must not 500');
  assert.deepEqual(body.labels, [], 'unknown site → labels:[]');
  assert.ok(body.series && typeof body.series === 'object', 'series object present');
});
