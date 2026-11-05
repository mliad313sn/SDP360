'use strict';
// SEC-01 — the viewer probe of tools/qa/route-matrix.js shares ONE session across every route.
// Probing POST /api/reports/auth/logout in its natural (registration) order revoked that session,
// so every route registered after it answered 401 and was never really probed as a viewer
// (414 of 643 routes on 2026-11-05). Session-ending routes must be probed last.
const test = require('node:test');
const assert = require('node:assert');
const { probeOrder, SESSION_ENDING } = require('../tools/qa/route-matrix');

test('session-ending routes are probed after every other route, order otherwise kept', () => {
  const routes = [
    { method: 'GET', path: '/api/a' },
    { method: 'POST', path: '/api/reports/auth/logout' },
    { method: 'POST', path: '/api/b' },
    { method: 'DELETE', path: '/api/reports/sessions/:token' },
    { method: 'GET', path: '/api/c' },
  ];
  const out = probeOrder(routes).map((r) => `${r.method} ${r.path}`);
  assert.deepStrictEqual(out, ['GET /api/a', 'POST /api/b', 'GET /api/c', 'POST /api/reports/auth/logout', 'DELETE /api/reports/sessions/:token']);
  assert.ok(SESSION_ENDING.has('POST /api/reports/auth/logout'));
  assert.strictEqual(routes.length, 5, 'input not mutated');
});
