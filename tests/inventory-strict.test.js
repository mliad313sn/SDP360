'use strict';
// F-ARCH-08 — strict coverage signal + criticality class. The strict matcher credits a test only for the
// whole path (parameters filled), the most specific route, and — for a write — the method named next to it.
const test = require('node:test');
const assert = require('node:assert');
const S = require('../tools/agent/inventory-strict');
const inv = require('../tools/agent/inventory');

const R = (method, p) => ({ id: 'RT-' + method + '-' + p, method, path: p, file: 'x.js' });
const run = (routes, src) => S.strictRouteTests(routes, [{ file: 'tests/t.test.js', src }]);
const hit = (m, r) => m.get(r.id + '@x.js').length > 0;

test('a prefix mention is not a strict reference; the full path with a value, a template hole or a concatenation is', () => {
  const r = R('GET', '/api/reports/:id/helpdesk');
  assert.equal(hit(run([r], "fetch('/api/reports')"), r), false);
  assert.equal(hit(run([r], "fetch('/api/reports/12/infra')"), r), false, 'another section');
  assert.equal(hit(run([r], "fetch('/api/reports/12/helpdesk')"), r), true);
  assert.equal(hit(run([r], 'get(`/api/reports/${id}/helpdesk`)'), r), true);
  assert.equal(hit(run([r], "get('/api/reports/' + id + '/helpdesk')"), r), true);
  assert.equal(hit(run([r], "get('/api/reports/12/helpdesk-live')"), r), false, 'ends where the route ends');
});

test('the most specific route wins an occurrence (literal segment beats a parameter)', () => {
  const lit = R('GET', '/api/inspection/aggregate'), par = R('GET', '/api/inspection/:id');
  const m = run([lit, par], "get('/api/inspection/aggregate')");
  assert.equal(hit(m, lit), true); assert.equal(hit(m, par), false);
  assert.equal(hit(run([lit, par], "get('/api/inspection/EM-1')"), par), true);
});

test('a write needs its method named near the path; GET does not', () => {
  const d = R('DELETE', '/api/roadmap/action/:uid');
  assert.equal(hit(run([d], "get('/api/roadmap/action/abc')"), d), false);
  assert.equal(hit(run([d], "send('DELETE', `/api/roadmap/action/${uid}`, tok)"), d), true);
  assert.equal(hit(run([d], "fetch(base + '/api/roadmap/action/' + uid, { method: 'DELETE' })"), d), true);
});

test('page routes match the bare file name; jobs match a whole quoted name only', () => {
  const p = R('GET', '/meetings.html');
  assert.equal(hit(run([p], "const PAGES = ['meetings.html']"), p), true);
  assert.equal(hit(run([p], "'meetings.html.bak'"), p), false);
  assert.deepEqual(S.strictJobTests('reports.weekly', [{ file: 'a', src: "'reports.weekly'" }, { file: 'b', src: "'reports.weekly_x'" }, { file: 'c', src: 'reports.weekly' }]), ['a']);
});

test('criticality classes come from method, path and guards', () => {
  assert.deepEqual(S.classify('DELETE', '/api/roadmap/action/:uid'), ['destructive', 'write']);
  assert.deepEqual(S.classify('GET', '/api/assets/finance/summary'), ['finance', 'read']);
  assert.deepEqual(S.classify('GET', '/api/reports/:id/pptx'), ['export', 'read']);
  assert.deepEqual(S.classify('PUT', '/api/reports/users/emails'), ['access', 'write']);
  assert.deepEqual(S.classify('GET', '/api/reports/system-log/export.csv'), ['audit', 'export', 'read']);
  assert.deepEqual(S.classify('POST', '/api/inspection/reset'), ['destructive', 'write']);
  assert.deepEqual(S.classify('GET', '/api/data/ageing'), ['read']);
  assert.equal(S.isCritical(['read']), false); assert.equal(S.isCritical(['export', 'read']), true);
});

test('the committed INVENTORY-STRICT.md matches the code (routes, jobs, classes) and its figures are coherent', () => {
  const base = inv.build();
  const c = S.check(base);
  assert.ok(c.ok, c.reason);
  const s = c.summary;
  assert.equal(s.routes, base.routes.length);
  assert.ok(s.routes_without_strict_test >= base.summary.routes_without_test_reference - s.routes_not_measurable, 'strict is never more generous than the prefix signal on measurable routes');
  assert.ok(s.critical_routes_without_strict_test <= s.routes_without_strict_test);
  for (const p of ['/api/reports/:id/helpdesk', '/api/reports/departments/:id', '/api/risk-register-config/aliases/:sdp_label', '/api/roadmap/action/:uid', '/api/roadmap/resource/:uid', '/api/meetings/lookups/:table/:code']) {
    const rows = S.buildStrict(base).routes.filter((r) => r.path === p && r.method !== 'GET');
    assert.ok(rows.length, p);
    for (const r of rows) assert.ok(r.strict_tests.length > 0, `${r.method} ${p} has a strict test reference (seed smoke)`);
  }
});
