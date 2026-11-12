'use strict';
// Step 1 — job registry + legacy wrapper + alerting, all against the in-memory store.
const test = require('node:test');
const assert = require('node:assert');
const { createSyncRunner, memoryStore } = require('../services/sync/syncRunner');
const { legacyJob, buildJobs, rowsOf, FRESHNESS_HOURS, OPTIONAL } = require('../services/sync/jobs');
const { createAlerter } = require('../services/sync/alerts');

function runnerWith(store) { return createSyncRunner({ store, sleep: async () => {}, log: () => {} }); }
function storeWithRecent() {
  const s = memoryStore();
  s.recentRuns = async (job, n) => s.runs.filter((r) => r.job === job).slice(-n).reverse();
  return s;
}

test('legacyJob: wraps a do-everything function — lock, run log, row count from its summary', async () => {
  const store = storeWithRecent();
  const r = runnerWith(store);
  const out = await r.run(legacyJob('zoho.requests', async () => ({ job: 'requests', upserted: 42, deleted: 1 })));
  assert.equal(out.status, 'ok');
  assert.equal(out.rows, 42);
  assert.equal(out.deleted, 1);
  assert.equal(store.runs[0].status, 'ok');
  assert.equal(store.runs[0].rows, 42);
});

test('legacyJob: a thrown transient error is retried, a permanent one fails fast', async () => {
  const store = storeWithRecent();
  const r = runnerWith(store);
  let calls = 0;
  const flaky = legacyJob('j', async () => { calls++; if (calls < 2) { const e = new Error('503'); e.status = 503; throw e; } return 3; });
  assert.equal((await r.run(flaky)).status, 'ok');
  assert.equal(calls, 2);
  calls = 0;
  const bad = legacyJob('k', async () => { calls++; throw new Error('bad filter 400'); });
  assert.equal((await r.run(bad)).status, 'error');
  assert.equal(calls, 1);
});

test('legacyJob: a {error} result (poll-sla style) is a failed run; empty guard is OFF for wrappers', async () => {
  const store = storeWithRecent();
  const r = runnerWith(store);
  assert.equal((await r.run(legacyJob('t', async () => ({ error: 'SDP API down' })))).status, 'error');
  await r.run(legacyJob('z', async () => 5));
  const empty = await r.run(legacyJob('z', async () => 0)); // 0 rows after 5 → NOT refused for a wrapper
  assert.equal(empty.status, 'ok');
});

test('rowsOf handles the heterogeneous legacy summaries', () => {
  assert.equal(rowsOf([{ name: 'assets', rows: 10 }, { name: 'memory', error: 'x' }, { name: 'drives', rows: 5 }]), 15);
  assert.equal(rowsOf({ upserted: 7 }), 7);
  assert.equal(rowsOf(12), 12);
  assert.equal(rowsOf(null), 0);
});

test('buildJobs: every declared job has a cron, a freshness window and a runnable job; optional set is consistent', () => {
  const jobs = buildJobs({ sync: {}, assets: {}, fetchView: () => {}, tools: {} });
  assert.ok(jobs.length >= 11);
  for (const j of jobs) {
    assert.match(j.cron, /^(\S+\s+){4}\S+$/);
    assert.equal(FRESHNESS_HOURS[j.name], j.freshnessHours, `freshness declared for ${j.name}`);
    assert.equal(typeof j.job.fetch, 'function');
    assert.equal(!!j.optional, OPTIONAL.has(j.name), `optional flag for ${j.name}`);
  }
  const names = jobs.map((j) => j.name);
  assert.deepEqual(new Set(names).size, names.length, 'unique names');
});

test('buildJobs: assets wrapper fails the run when a view failed (so it is retried + alerted)', async () => {
  const store = storeWithRecent();
  const r = runnerWith(store);
  const jobs = buildJobs({ sync: {}, fetchView: () => {}, tools: {},
    assets: { syncAllAssets: async () => [{ name: 'assets', rows: 10 }, { name: 'memory', error: 'timeout' }], afterAssetsSync: async () => {} } });
  const assets = jobs.find((j) => j.name === 'assets.sync').job;
  assets.opts.maxAttempts = 1;
  const out = await r.run(assets);
  assert.equal(out.status, 'error');
  assert.match(out.error, /memory: timeout/);
});

test('alerter: alerts once per failure streak after 2 consecutive failures, clears on success', async () => {
  const store = storeWithRecent();
  const sent = [];
  let t = 1_000_000;
  const alerter = createAlerter({ store, senders: [async (m) => sent.push(m)], now: () => t });
  const r = createSyncRunner({ store, sleep: async () => {}, log: () => {}, onEvent: (k, p) => alerter.onEvent(k, p) });
  const failing = legacyJob('x', async () => { throw new Error('boom'); }, { maxAttempts: 1 });
  await r.run(failing); await new Promise((res) => setImmediate(res));
  assert.equal(sent.length, 0, 'first failure: no alert yet');
  await r.run(failing); await new Promise((res) => setImmediate(res));
  assert.equal(sent.length, 1); assert.equal(sent[0].kind, 'failure'); assert.equal(sent[0].job, 'x');
  await r.run(failing); await new Promise((res) => setImmediate(res));
  assert.equal(sent.length, 1, 'same streak: no second alert');
  await r.run(legacyJob('x', async () => 1)); await new Promise((res) => setImmediate(res));
  await r.run(failing); await r.run(failing); await new Promise((res) => setImmediate(res));
  assert.equal(sent.length, 2, 'new streak after a success → new alert');
});

test('alerter.checkStale: alerts when last_ok is older than the window, repeats only after 24 h, skips idle optional jobs', async () => {
  const store = storeWithRecent();
  const sent = [];
  let t = Date.parse('2026-10-19T12:00:00Z');
  const alerter = createAlerter({ store, senders: [async (m) => sent.push(m)], now: () => t });
  const rows = [
    { job: 'zoho.requests', last_ok: '2026-10-19T06:00:00Z' },   // 6 h old, window 3 → stale
    { job: 'assets.sync', last_ok: '2026-10-19T11:00:00Z' },     // 1 h old (26 h after the jump), window 30 → fine
    { job: 'meraki.wan', last_ok: null },                        // optional, never ran → idle, no alert
    { job: 'zoho.survey', last_ok: null },                       // mandatory never ran → alert
  ];
  let out = await alerter.checkStale(rows, FRESHNESS_HOURS, OPTIONAL);
  assert.deepEqual(out.map((m) => m.job).sort(), ['zoho.requests', 'zoho.survey']);
  out = await alerter.checkStale(rows, FRESHNESS_HOURS, OPTIONAL);
  assert.equal(out.length, 0, 'no repeat within 24 h');
  t += 25 * 3600 * 1000;
  out = await alerter.checkStale(rows, FRESHNESS_HOURS, OPTIONAL);
  assert.equal(out.length, 2, 'repeats after 24 h');
});

test('G05 failOnZero: a configured source answering nothing is a failed run; an unconfigured one stays a skip', async () => {
  const r1 = runnerWith(storeWithRecent());
  const empty = await r1.run(legacyJob('meraki.wan', async () => ({ ok: true, rows: 0 }), { failOnZero: true, maxAttempts: 1 }));
  assert.notEqual(empty.status, 'ok');
  const r2 = runnerWith(storeWithRecent());
  const skipped = await r2.run(legacyJob('meraki.wan', async () => ({ skipped: true }), { failOnZero: true, maxAttempts: 1 }));
  // F-ARCH-01 — a skip is recorded as skipped (was: an ok run with 0 rows, which read FRESH)
  assert.equal(skipped.status, 'skipped');
  assert.equal(await r2.store.lastSuccessfulRun('meraki.wan'), null);
  assert.equal(await r2.store.getWatermark('meraki.wan'), null);
  const r3 = runnerWith(storeWithRecent());
  const full = await r3.run(legacyJob('opmanager.availability', async () => ({ ok: true, mode: 'rest', devices: 12 }), { failOnZero: true, maxAttempts: 1, rowsOf: (x) => Number(x.rows ?? x.devices) }));
  assert.equal(full.status, 'ok'); assert.equal(full.rows, 12);
});

test('G05: the snapshot syncs that replace a day of figures are armed with failOnZero', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'services', 'sync', 'jobs.js'), 'utf8');
  for (const j of ['meraki.wan', 'opmanager.availability']) assert.match(src, new RegExp(`legacyJob\\('${j.replace('.', '\\.')}'[^\\n]*failOnZero: true`), j);
});

test('A-19 softdelete.purge: registered, optional, freshness declared, self-skips while soft_delete_purge_enabled = 0', async () => {
  const { softDeletePurgeRun } = require('../services/sync/jobs');
  const jobs = buildJobs({ sync: {}, assets: {}, fetchView: () => {}, tools: {} });
  const j = jobs.find((x) => x.name === 'softdelete.purge');
  assert.ok(j, 'registered');
  assert.equal(j.optional, true);
  assert.ok(OPTIONAL.has('softdelete.purge'));
  assert.equal(FRESHNESS_HOURS['softdelete.purge'], 30);
  let called = false;
  const ops = { purge: async () => { called = true; return { modules: {} }; } };
  const off = await softDeletePurgeRun({ cfg: { soft_delete_purge_enabled: '0' }, softDeleteOps: ops, rdb: { logEvent() {} } });
  assert.equal(off.skipped, true);
  assert.equal(called, false, 'purge never runs while disarmed');
  const logged = [];
  const on = await softDeletePurgeRun({ cfg: { soft_delete_purge_enabled: '1' }, rdb: { logEvent: (e) => logged.push(e) },
    softDeleteOps: { purge: async ({ apply }) => { assert.equal(apply, true); return { cutoff: 'c', retention_days: 30, modules: { inspection: { ids: ['a'], purged: 1 } } }; } } });
  assert.equal(on.rows, 1);
  assert.equal(logged[0].action, 'inspection_purged');
});
