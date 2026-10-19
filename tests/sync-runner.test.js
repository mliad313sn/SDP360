'use strict';
// Step 1 (SDP-DASH-2.0) — sync runner, health and deletion guard (pure parts, in-memory store).
const { test } = require('node:test');
const assert = require('node:assert');
const { createRunner, isTransient, retryAfterMs, backoffMs, interpretResult } = require('../services/sync/runner');
const { computeHealth, toMs } = require('../services/sync/health');
const { checkDeletion, assertDeletionAllowed, TruncationGuardError, tolerancePct } = require('../services/sync/guard');
const { buildMessage } = require('../services/sync/alerts');

function memStore() {
  const runs = [], states = new Map();
  return {
    runs, states,
    recordRun: async (r) => { runs.push(r); },
    getState: async (k) => (states.has(k) ? { ...states.get(k) } : null),
    listStates: async () => [...states.values()].map(s => ({ ...s })),
    saveState: async (s) => { states.set(s.job_key, { ...s }); },
    purge: async () => 0,
  };
}
function harness(opts = {}) {
  let t = Date.parse('2026-10-19T08:00:00Z');
  const store = memStore(), events = [], alerts = [], sleeps = [];
  const r = createRunner({ store, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; },
    logEvent: (e) => events.push(e), alert: async (a) => { alerts.push(a.kind); return {}; }, ...opts });
  return { r, store, events, alerts, sleeps, advance: (ms) => { t += ms; } };
}

test('error classification: network, 429 and 5xx are transient; 4xx and guard errors are not', () => {
  assert.equal(isTransient({ code: 'ECONNRESET' }), true);
  assert.equal(isTransient({ response: { status: 429 } }), true);
  assert.equal(isTransient({ response: { status: 503 } }), true);
  assert.equal(isTransient({ response: { status: 401 } }), false);
  assert.equal(isTransient({ message: 'timeout of 120000ms exceeded' }), true);
  assert.equal(isTransient(new TruncationGuardError('t', 100, 90, 20)), false);
  assert.equal(retryAfterMs({ response: { headers: { 'retry-after': '7' } } }), 7000);
  assert.equal(backoffMs(3, null, { baseDelayMs: 1000 }), 4000);
  assert.equal(backoffMs(1, { response: { headers: { 'retry-after': '2' } } }, { baseDelayMs: 1000 }), 2000);
  assert.deepEqual(interpretResult({ skipped: 'disarmed' }), { status: 'skipped', detail: 'disarmed' });
  assert.equal(interpretResult({ skipped: true }).detail, 'not configured');
  assert.deepEqual(interpretResult({ error: 'boom' }), { status: 'error', error: 'boom' });
});

test('transient failure is retried with backoff (Retry-After honoured), then succeeds', async () => {
  const h = harness();
  let n = 0;
  h.r.register({ key: 'j', retries: 2, baseDelayMs: 1000, fn: async () => {
    n++; if (n === 1) { const e = new Error('rate limited'); e.response = { status: 429, headers: { 'retry-after': '3' } }; throw e; }
    return { upserted: 4 };
  } });
  const out = await h.r.run('j');
  assert.equal(out.status, 'ok'); assert.equal(out.attempts, 2);
  assert.deepEqual(h.sleeps, [3000]);
  assert.equal(h.store.runs.length, 1, 'one run row, not one per attempt');
  assert.equal((await h.store.getState('j')).consecutive_failures, 0);
});

test('a permanent error is not retried; {error} results count as failures', async () => {
  const h = harness();
  h.r.register({ key: 'p', retries: 3, fn: async () => { const e = new Error('bad request'); e.response = { status: 400 }; throw e; } });
  h.r.register({ key: 'q', retries: 3, fn: async () => ({ error: 'webhook https://secret.example/x refused' }) });
  assert.equal((await h.r.run('p')).attempts, 1);
  const q = await h.r.run('q');
  assert.equal(q.status, 'error');
  assert.ok(!/secret\.example/.test(h.store.runs[1].error), 'URLs are scrubbed from the run log');
  assert.equal(h.events.filter(e => e.action === 'sync_failed').length, 2, 'failures mirrored to the System Log');
});

test('overlap lock: a second run while the first is in flight is recorded as overlap', async () => {
  const h = harness();
  let release; const gate = new Promise(r => { release = r; });
  h.r.register({ key: 'slow', fn: () => gate });
  const first = h.r.run('slow');
  assert.equal(h.r.isRunning('slow'), true);
  assert.equal((await h.r.run('slow')).status, 'overlap');
  release({ ok: true });
  assert.equal((await first).status, 'ok');
  assert.deepEqual(h.store.runs.map(r => r.status), ['overlap', 'ok']);
});

test('alert after 2 consecutive failures, once per streak, then a recovery notice', async () => {
  const h = harness();
  let fail = true;
  h.r.register({ key: 'z', fn: async () => { if (fail) throw new Error('HTTP 400'); return {}; } });
  await h.r.run('z'); assert.deepEqual(h.alerts, []);
  await h.r.run('z'); assert.deepEqual(h.alerts, ['failure']);
  await h.r.run('z'); assert.deepEqual(h.alerts, ['failure'], 'latched: no second alert in the same streak');
  fail = false;
  await h.r.run('z'); assert.deepEqual(h.alerts, ['failure', 'recovery']);
  const s = await h.store.getState('z');
  assert.equal(s.consecutive_failures, 0); assert.equal(s.failure_alerted_at, null);
});

test('the runner never rejects, even when the store and the alert channel throw', async () => {
  const r = createRunner({ store: { recordRun: async () => { throw new Error('db down'); },
    getState: async () => { throw new Error('db down'); }, saveState: async () => {}, listStates: async () => [] },
  alert: async () => { throw new Error('smtp down'); }, logEvent: () => { throw new Error('log down'); } });
  r.register({ key: 'x', fn: async () => { throw new Error('boom'); } });
  const out = await r.run('x');
  assert.equal(out.status, 'error');
  assert.equal((await r.run('nope')).status, 'error');
});

test('health: ok / idle / stale / error / never, legacy sync_metadata merged (sqlite UTC dates)', () => {
  const nowMs = Date.parse('2026-10-19T12:00:00Z');
  const jobs = [
    { key: 'a', label: 'A', freshnessMinutes: 180, metadataKeys: ['requests'] },
    { key: 'b', label: 'B', freshnessMinutes: 60 },
    { key: 'c', label: 'C', freshnessMinutes: 180 },
    { key: 'd', label: 'D', freshnessMinutes: 1800 },
    { key: 'e', label: 'E', freshnessMinutes: 60 },
  ];
  const states = [
    { job_key: 'b', last_status: 'skipped', last_run_at: '2026-10-19T11:55:00.000Z' },
    { job_key: 'c', last_status: 'ok', last_ok_at: '2026-10-19T06:00:00.000Z', last_run_at: '2026-10-19T06:00:00.000Z' },
    { job_key: 'e', last_status: 'error', last_run_at: '2026-10-19T11:55:00.000Z', last_error: 'x', consecutive_failures: 3 },
  ];
  const metadata = [{ job_name: 'requests', last_sync_at: '2026-10-19 11:45:00' }];
  const h = computeHealth({ jobs, states, metadata, nowMs });
  const by = Object.fromEntries(h.jobs.map(j => [j.key, j.status]));
  assert.deepEqual(by, { a: 'ok', b: 'idle', c: 'stale', d: 'never', e: 'error' });
  assert.equal(h.jobs[0].age_minutes, 15, 'sqlite datetime() is read as UTC');
  assert.equal(h.summary.stale, 1);
  assert.equal(toMs('2026-10-19 11:45:00'), Date.parse('2026-10-19T11:45:00Z'));
  assert.equal(toMs(null), null);
});

test('stale sweep alerts once per stale episode', async () => {
  const h = harness();
  h.r.register({ key: 's', freshnessMinutes: 60, fn: async () => ({}) });
  await h.r.run('s');
  h.advance(2 * 3600 * 1000);
  assert.deepEqual((await h.r.sweep()).raised, ['s']);
  assert.deepEqual((await h.r.sweep()).raised, [], 'latched');
  await h.r.run('s');
  h.advance(2 * 3600 * 1000);
  assert.deepEqual((await h.r.sweep()).raised, ['s'], 'a new episode after a success alerts again');
  assert.deepEqual(h.alerts, ['stale', 'stale']);
});

test('deletion guard: refuses more than the tolerance, ignores small numbers', () => {
  assert.equal(checkDeletion({ local: 1000, toDelete: 150, tolerancePct: 20 }), null);
  assert.ok(checkDeletion({ local: 1000, toDelete: 300, tolerancePct: 20 }));
  assert.equal(checkDeletion({ local: 10, toDelete: 5, tolerancePct: 20 }), null, 'up to 5 rows always allowed');
  assert.throws(() => assertDeletionAllowed('request_records', 56000, 40000, { tolerancePct: 20 }), TruncationGuardError);
  assert.equal(tolerancePct({ SYNC_TRUNCATION_TOLERANCE_PCT: '35' }), 35);
  assert.equal(tolerancePct({}), 20);
});

test('alert messages name the job and never carry a URL', () => {
  const m = buildMessage({ kind: 'failure', job: { key: 'zoho.requests', label: 'Tickets' }, state: { consecutive_failures: 2 }, error: 'HTTP 503' });
  assert.match(m.subject, /Sync failing: Tickets/);
  assert.match(m.text, /2 time\(s\) in a row/);
  assert.match(buildMessage({ kind: 'stale', job: { key: 'k', label: 'K', freshnessMinutes: 60 }, ageMinutes: 150 }).text, /2\.5 h/);
});
