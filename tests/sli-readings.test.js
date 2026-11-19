'use strict';
// P05 — 30-day SLI readings on /api/health/deps (services/sliReadings.js) and the in-process counters.
// Observation only: every target is UNKNOWN, a reading the server cannot make is null — never 0, never green.
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../services/sliReadings');
const C = require('../services/sliCounters');

const NOW = new Date('2026-11-19T12:00:00Z');
const H = 3600000;

test('freshShare: share of the window covered by a fresh last-ok run', () => {
  const to = NOW.getTime(); const from = to - 10 * H;
  assert.strictEqual(S.freshShare([], 2, from, to), null);
  assert.strictEqual(S.freshShare([new Date(from).toISOString()], 0, from, to), null);
  // ok at from (fresh 2 h) and at from+5h (fresh 2 h) → 4 h of 10
  assert.strictEqual(S.freshShare([new Date(from).toISOString(), new Date(from + 5 * H).toISOString()], 2, from, to), 40);
  // a run before the window still covers its start
  assert.strictEqual(S.freshShare([new Date(from - H).toISOString()], 2, from, to), 10);
  // overlapping runs are not double counted
  assert.strictEqual(S.freshShare([new Date(from).toISOString(), new Date(from + H).toISOString()], 5, from, to), 60);
});

test('compose: nothing measured → every value null and every target UNKNOWN', () => {
  const r = S.compose({}, NOW);
  assert.strictEqual(r.window_days, 30);
  for (const [k, it] of Object.entries(r.items)) {
    assert.strictEqual(it.value, null, k);
    assert.strictEqual(it.target, S.TARGET, k);
    assert.ok(it.basis && it.basis.length > 5, k);
  }
  assert.match(S.TARGET, /^UNKNOWN/);
});

test('compose: readings become shares, pending field entries are not counted', () => {
  const r = S.compose({
    counters: { started_at: '2026-11-19T00:00:00Z', login: { total: 200, five_xx: 2 }, db_latency_ms: [1, 2, 3, 4, 50] },
    auth: { success: 150, failed: 10 },
    sync: [{ job: 'zoho.requests', freshness_hours: 24 * 60, ok_times: ['2026-10-01T00:00:00Z'] }],
    delivery: { ok: 9, fail: 1 },
    field: { total: 10, applied: 6, pending: 2, resolved: 1 },
    backup: { ok: 30, failed: 0, last_ok: '2026-11-19T02:00:00Z' }, drills: { total: 1, failed: 0 },
  }, NOW);
  assert.strictEqual(r.items.sign_in.value, 99);
  assert.strictEqual(r.items.sign_in.window, 'since_server_start');
  assert.strictEqual(r.items.sign_in.login_failed_30d, 10);
  assert.strictEqual(r.items.sync_freshness.value, 100);
  // a job first seen 1 h ago with a 2 h window is fully fresh (history starts at its first ok run)
  const young = S.compose({ sync: [{ job: 'j', freshness_hours: 2, ok_times: [new Date(NOW.getTime() - H).toISOString()] }] }, NOW);
  assert.strictEqual(young.items.sync_freshness.value, 100);
  assert.strictEqual(young.items.sync_freshness.jobs[0].measured_from, new Date(NOW.getTime() - H).toISOString());
  assert.strictEqual(r.items.scheduled_delivery.value, 90);
  assert.strictEqual(r.items.field_apply.value, 75);          // 6 of 8 settled
  assert.strictEqual(r.items.database_latency.value, 50);     // p95 of 5 samples = the largest
  assert.strictEqual(r.items.backups.value, 10);              // 10 h old
  assert.strictEqual(r.items.availability.value, null);       // needs an external probe
  assert.strictEqual(r.items.disk.value, null);
});

test('gather: one unreadable table degrades only its own reading', async () => {
  const pg = { prepare: (sql) => ({
    get: async () => {
      if (/report_sent_log/.test(sql)) throw new Error('no table');
      if (/field_outbox/.test(sql)) return { total: 4, applied: 4, pending: 0 };
      if (/field_outbox_resolved/.test(sql)) return { n: 0 };
      if (/job='db.backup'/.test(sql)) return { ok: 2, failed: 1, last_ok: '2026-11-19T06:00:00Z' };
      if (/restore_drill/.test(sql)) return { total: 0, failed: 0 };
      if (/category='auth'/.test(sql)) return { s: 3, f: 1 };
      return { n: 0 };
    },
    all: async () => [{ job: 'zoho.requests', finished_at: '2026-11-19T11:00:00Z' }, { job: 'unknown.job', finished_at: '2026-11-19T11:00:00Z' }],
  }) };
  const r = await S.gather({ pg, now: NOW, counters: null, freshness: { 'zoho.requests': 2 } });
  assert.strictEqual(r.items.scheduled_delivery.value, null);
  assert.match(r.items.scheduled_delivery.basis, /unreadable/);
  assert.strictEqual(r.items.field_apply.value, 100);
  assert.strictEqual(r.items.backups.failed_runs_30d, 1);
  assert.deepStrictEqual(r.items.sync_freshness.jobs.map((j) => j.job), ['zoho.requests']);
  assert.strictEqual(r.items.sign_in.value, null);
  assert.strictEqual(r.items.sign_in.login_success_30d, 3);
});

test('sliCounters: counts login answers by status and keeps a bounded latency ring', () => {
  C._reset();
  const mk = (method, p, status) => {
    const handlers = {}; const res = { statusCode: status, on: (e, f) => { handlers[e] = f; } };
    let nexted = false; C.loginCounter({ method, path: p }, res, () => { nexted = true; });
    assert.ok(nexted); if (handlers.finish) handlers.finish();
  };
  mk('POST', '/api/reports/auth/login', 200); mk('POST', '/api/reports/auth/login', 503); mk('GET', '/api/reports', 500);
  C.recordDbLatency(3); C.recordDbLatency(-1); C.recordDbLatency('x');
  const s = C.snapshot();
  assert.deepStrictEqual(s.login, { total: 2, five_xx: 1 });
  assert.deepStrictEqual(s.db_latency_ms, [3]);
  for (let i = 0; i < C.MAX + 5; i++) C.recordDbLatency(1);
  assert.strictEqual(C.snapshot().db_latency_ms.length, C.MAX);
  C._reset();
});
