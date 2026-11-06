'use strict';
// E-Q04 — the load harness refuses any non-local target unless the exact host is repeated, and its
// aggregation is pure (nearest-rank p50/p95/p99, error rate, 5xx, RSS trend; empty → null, never 0).
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../tools/test/load');

test('target guard: localhost only, unless --target-confirm repeats the exact host', () => {
  for (const ok of ['http://127.0.0.1:3456', 'http://localhost:9999/x', 'http://[::1]:3456']) assert.ok(L.assertTarget(ok));
  for (const bad of ['http://itops-dashboard.edv-ops.com', 'https://10.0.0.5:3456', 'http://127.0.0.1.evil.example', 'ftp://localhost', 'not a url']) assert.throws(() => L.assertTarget(bad), /refused/, bad);
  assert.throws(() => L.assertTarget('https://staging.example.test', 'staging.example'), /refused/, 'a partial host is not a confirmation');
  assert.equal(L.assertTarget('https://staging.example.test', 'staging.example.test').hostname, 'staging.example.test');
});

test('parseArgs: bounded sessions / duration, scenario list', () => {
  const o = L.parseArgs(['--sessions=999', '--duration=0', '--scenarios=reports, export']);
  assert.equal(o.sessions, 50); assert.equal(o.duration, 30, '0 is not a duration: default'); assert.deepEqual(o.scenarios, ['reports', 'export']);
  assert.equal(L.parseArgs([]).target, 'http://127.0.0.1:3456');
});

test('aggregate: per step percentiles, error rate, 5xx, network errors, throughput, RSS trend', () => {
  const s = [];
  for (let i = 1; i <= 100; i++) s.push({ step: 'reports.list', ms: i, status: 200 });
  s.push({ step: 'export', ms: 900, status: 500 }, { step: 'export', ms: 10, status: 200 }, { step: 'export', ms: 5, status: 0 }, { step: 'export', ms: 7, status: 403 });
  const a = L.aggregate(s, { durationSec: 10, rss: [100000, null, 120000, 110000] });
  assert.deepEqual([a.steps['reports.list'].p50, a.steps['reports.list'].p95, a.steps['reports.list'].p99], [50, 95, 99]);
  assert.equal(a.steps.export.errors, 3); assert.equal(a.steps.export.error_rate_pct, 75); assert.equal(a.steps.export.five_xx, 1); assert.equal(a.steps.export.network_errors, 1);
  assert.equal(a.overall.n, 104); assert.equal(a.throughput_rps, 10.4);
  assert.deepEqual(a.rss_kb, { first: 100000, last: 110000, max: 120000 });
  const e = L.aggregate([]);
  assert.equal(e.overall.p50, null); assert.equal(e.overall.error_rate_pct, null); assert.equal(e.rss_kb, null);
});

test('markdown: observation only, RSS UNKNOWN without a pid, no threshold column', () => {
  const md = L.renderMarkdown(L.aggregate([{ step: 'a', ms: 3, status: 200 }], { durationSec: 1 }), { target: 'http://127.0.0.1:1', sessions: 1, duration: 1, scenarios: ['reports'], at: 'X' });
  assert.match(md, /No threshold/); assert.match(md, /Server RSS: UNKNOWN/);
  assert.ok(!/budget|target \(ms\)|SLO:/i.test(md.split('\n').slice(4).join('\n')), 'no threshold rendered');
});
