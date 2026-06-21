'use strict';

// Integration smoke for the extracted inspection router (split-server.js pilot).
// Mounts routes/inspection.js on a real ephemeral express app with stubbed
// deps and fires real HTTP requests — proving the factory wires every route,
// the middleware chain runs, and the critical /actions-before-/:id ordering
// holds (so GET /api/inspection/actions does NOT fall into the /:id handler).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http   = require('http');
const express = require('express');

const makeRouter = require('../routes/inspection');

// Stubs — record calls so we can assert which handler ran.
const calls = [];
const inspectionDb = {
  loadLookups: () => { calls.push('loadLookups'); return { sites: [], areas: [], types: [] }; },
  listActions: () => { calls.push('listActions'); return [{ id: 1, description: 'fix' }]; },
  listInspections: () => { calls.push('listInspections'); return []; },
  aggregate: () => ({ total: 0 }),
  getInspection: (id) => { calls.push('getInspection:' + id); return null; },
  siteNameToCode: () => null,
  listPeople: () => [],
};
const rdb = { userHasRole: () => true, listSites: () => [] };
const passthru = (req, res, next) => { req.reportUser = { id: 1, username: 'tester' }; next(); };

let server, base;

before(async () => {
  const app = express();
  app.use(makeRouter({
    express,
    inspectionDb,
    inspectionPptx: null,
    rdb,
    requireReportSession: passthru,
    requireAdmin: passthru,
    requireExecutiveOrSuperAdmin: passthru,
    requireRole: () => passthru,
    getRawCache: () => null,
  }));
  await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
});

after(() => { if (server) server.close(); });

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(base + path, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('GET /api/inspection/lookups → 200 from the lookups handler', async () => {
  const r = await get('/api/inspection/lookups');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(JSON.parse(r.body), { sites: [], areas: [], types: [] });
  assert.ok(calls.includes('loadLookups'));
});

test('GET /api/inspection/actions resolves to the actions handler, NOT /:id', async () => {
  calls.length = 0;
  const r = await get('/api/inspection/actions');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(JSON.parse(r.body), { rows: [{ id: 1, description: 'fix' }] });
  assert.ok(calls.includes('listActions'), 'listActions must run');
  assert.ok(!calls.some(c => c.startsWith('getInspection')), '/:id handler must NOT run for /actions');
});

test('GET /api/inspection/:id → 404 when not found (the :id handler)', async () => {
  calls.length = 0;
  const r = await get('/api/inspection/EM-IT-NOPE');
  assert.strictEqual(r.status, 404);
  assert.ok(calls.includes('getInspection:EM-IT-NOPE'));
});

test('GET /api/inspection/list → 200 from the list handler', async () => {
  const r = await get('/api/inspection/list');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(JSON.parse(r.body), { rows: [] });
});

test('router exposes the full set of inspection routes', () => {
  const router = makeRouter({
    express, inspectionDb, inspectionPptx: null, rdb,
    requireReportSession: passthru, requireAdmin: passthru,
    requireExecutiveOrSuperAdmin: passthru, requireRole: () => passthru,
    getRawCache: () => null,
  });
  const routes = router.stack.filter(l => l.route).map(l => Object.keys(l.route.methods)[0] + ' ' + l.route.path);
  const expected = [
    'get /api/inspection/lookups', 'get /api/inspection/people', 'get /api/inspection/list',
    'get /api/inspection/aggregate', 'get /api/inspection/actions',
    'post /api/inspection/actions/:id/update', 'get /api/inspection/:id',
    'post /api/inspection/save', 'delete /api/inspection/:id',
    'post /api/inspection/:id/export', 'post /api/inspection/aggregate/export',
    'post /api/inspection/reset',
  ];
  for (const e of expected) assert.ok(routes.includes(e), `missing route: ${e}`);
  // ordering guard: /actions before /:id
  assert.ok(routes.indexOf('get /api/inspection/actions') < routes.indexOf('get /api/inspection/:id'),
    '/actions must be registered before /:id');
});
