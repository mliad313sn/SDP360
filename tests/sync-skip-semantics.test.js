'use strict';
// F-ARCH-01 / F-DATA-01 (E04) — a skipped or unconfigured sync is not a collection.
// Before the fix legacyJob turned { skipped: true } into "0 rows + a new watermark" and the runner recorded
// status 'ok', so /api/sync/health, the publication gate, drift and the stale alerter all read the source as
// FRESH. In-memory store only: no database, no network.
const test = require('node:test');
const assert = require('node:assert');
const { createSyncRunner, memoryStore } = require('../services/sync/syncRunner');
const { legacyJob, skipReason, FRESHNESS_HOURS, OPTIONAL } = require('../services/sync/jobs');
const { createAlerter } = require('../services/sync/alerts');
const PG = require('../services/publishGate');
const D = require('../services/sync/drift');

function rig() {
  const store = memoryStore();
  store.recentRuns = async (job, n) => store.runs.filter((r) => r.job === job).slice(-n).reverse();
  store.recentOkRuns = async (job, n) => store.runs.filter((r) => r.job === job && r.status === 'ok').slice(-n).reverse();
  let t = Date.parse('2026-11-10T06:00:00Z');
  const events = [];
  const clock = { now: () => t, add: (h) => { t += h * 3600 * 1000; } };
  const r = createSyncRunner({ store, sleep: async () => {}, log: () => {}, now: () => clock.now(), onEvent: (k, p) => events.push([k, p]) });
  return { store, r, clock, events };
}
const lastOk = async (store, job) => { const x = await store.lastSuccessfulRun(job); return x ? new Date(x.finished_at).toISOString() : null; };

test('skipReason: true / a reason string is a skip; a count of skipped items or a normal summary is not', () => {
  assert.equal(skipReason({ skipped: true }), 'not configured');
  assert.equal(skipReason({ skipped: true, reason: 'no PG_URL' }), 'no PG_URL');
  assert.equal(skipReason({ skipped: 'disarmed' }), 'disarmed');
  assert.equal(skipReason({ users: 3, sent: 1, skipped: 1, rows: 1 }), null, 'a number counts skipped items');
  assert.equal(skipReason({ excel: 0, skipped: 3, rows: 0 }), null);
  assert.equal(skipReason({ rows: 0 }), null);
  assert.equal(skipReason(null), null);
  assert.equal(skipReason([{ name: 'assets', rows: 3 }]), null);
});

test('a skipped job is recorded as skipped: no rows, watermark untouched, the previous collection keeps its date', async () => {
  const { store, r, clock, events } = rig();
  let configured = true;
  const job = legacyJob('meraki.wan', async () => (configured ? { rows: 14 } : { skipped: true }), { failOnZero: true, maxAttempts: 1 });
  const first = await r.run(job);
  assert.equal(first.status, 'ok');
  const collectedAt = await lastOk(store, 'meraki.wan');
  const wm = await store.getWatermark('meraki.wan');
  assert.ok(collectedAt && wm);

  configured = false; clock.add(24);
  const out = await r.run(job);
  assert.equal(out.status, 'skipped');
  assert.equal(out.reason, 'not configured');
  assert.equal(out.rows, undefined, 'a skip reports no row count');
  const run = store.runs[1];
  assert.equal(run.status, 'skipped');
  assert.equal(run.rows, null);
  assert.equal(run.error, null);
  assert.equal(run.meta.skipped, 'not configured');
  assert.equal(await store.getWatermark('meraki.wan'), wm, 'watermark not advanced by a skip');
  assert.equal(await lastOk(store, 'meraki.wan'), collectedAt, 'last valid collection date preserved');
  assert.deepEqual(events.map((e) => e[0]), ['sync_ok', 'sync_skipped']);
  assert.equal(events[1][1].reason, 'not configured');
});

test('a source that was never configured has no successful run at all (no invented date, no watermark)', async () => {
  const { store, r } = rig();
  for (let i = 0; i < 3; i++) assert.equal((await r.run(legacyJob('meraki.wan', async () => ({ skipped: true }), { failOnZero: true }))).status, 'skipped');
  assert.equal(await store.lastSuccessfulRun('meraki.wan'), null);
  assert.equal(await store.getWatermark('meraki.wan'), null);
  assert.equal(store.locks.size, 0, 'lock released after a skip');
});

test('publication gate: only skips → UNKNOWN; a real collection then skips → ages to STALE, never FRESH from a skip', async () => {
  const { store, r, clock } = rig();
  const job = (cfg) => legacyJob('meraki.wan', async () => (cfg.on ? { rows: 9 } : { skipped: true }), { failOnZero: true, maxAttempts: 1 });
  const cfg = { on: false };
  await r.run(job(cfg));
  let fr = PG.freshness(['wan'], { 'meraki.wan': await lastOk(store, 'meraki.wan') }, clock.now());
  assert.equal(fr.sources[0].state, 'UNKNOWN'); assert.equal(fr.fresh, false);
  assert.equal(PG.moduleFreshness('wan', { 'meraki.wan': await lastOk(store, 'meraki.wan') }, clock.now()).state, 'UNKNOWN');

  cfg.on = true; await r.run(job(cfg));
  fr = PG.freshness(['wan'], { 'meraki.wan': await lastOk(store, 'meraki.wan') }, clock.now());
  assert.equal(fr.sources[0].state, 'FRESH');

  cfg.on = false;                                   // the key is removed: the job skips every night
  for (let d = 0; d < 3; d++) { clock.add(24); await r.run(job(cfg)); }
  fr = PG.freshness(['wan'], { 'meraki.wan': await lastOk(store, 'meraki.wan') }, clock.now());
  assert.equal(fr.sources[0].state, 'STALE', '72 h after the last real collection, whatever the skips since');
  assert.equal(fr.sources[0].age_h, 72);
});

test('failure path unchanged: an error result fails the run and does not move the last collection', async () => {
  const { store, r, clock } = rig();
  await r.run(legacyJob('meraki.wan', async () => ({ rows: 4 }), { failOnZero: true, maxAttempts: 1 }));
  const at = await lastOk(store, 'meraki.wan'); const wm = await store.getWatermark('meraki.wan');
  clock.add(1);
  const bad = await r.run(legacyJob('meraki.wan', async () => ({ error: 'Meraki 503' }), { failOnZero: true, maxAttempts: 1 }));
  assert.equal(bad.status, 'error');
  const zero = await r.run(legacyJob('meraki.wan', async () => ({ ok: true, rows: 0 }), { failOnZero: true, maxAttempts: 1 }));
  assert.equal(zero.status, 'error', 'failOnZero: a configured source answering nothing is a failure');
  assert.equal(await lastOk(store, 'meraki.wan'), at);
  assert.equal(await store.getWatermark('meraki.wan'), wm);
});

test('a complete collection with zero rows is an ok run (rows 0, new watermark) — distinguishable from a skip', async () => {
  const { store, r, clock } = rig();
  const zero = await r.run(legacyJob('audit.retention', async () => ({ deleted: 0, rows: 0 })));
  assert.equal(zero.status, 'ok'); assert.equal(zero.rows, 0);
  assert.equal(store.runs[0].status, 'ok'); assert.equal(store.runs[0].rows, 0);
  assert.ok(await store.getWatermark('audit.retention'));
  clock.add(1);
  const skip = await r.run(legacyJob('audit.retention', async () => ({ skipped: 'disarmed' })));
  assert.equal(skip.status, 'skipped'); assert.equal(skip.reason, 'disarmed');
  assert.equal(store.runs[1].status, 'skipped'); assert.equal(store.runs[1].rows, null);
});

test('a digest that sent to some users and skipped others is a normal ok run', async () => {
  const { r } = rig();
  const out = await r.run(legacyJob('engagement.digest', async () => ({ users: 3, sent: 1, skipped: 2, rows: 1 })));
  assert.equal(out.status, 'ok'); assert.equal(out.rows, 1);
});

test('drift ignores skips: no fake zero-row runs in the history', async () => {
  const { store, r, clock } = rig();
  const cfg = { on: true };
  const job = legacyJob('zoho.requests', async () => (cfg.on ? { upserted: 100 } : { skipped: true }));
  for (let i = 0; i < 6; i++) { await r.run(job); clock.add(1); }
  cfg.on = false; for (let i = 0; i < 3; i++) { await r.run(job); clock.add(1); }
  const runs = await store.recentOkRuns('zoho.requests', D.WINDOW);
  assert.equal(runs.length, 6);
  const d = D.computeDrift(runs);
  assert.equal(d.status, 'ok'); assert.deepEqual(d.flags, []); assert.equal(d.last_rows, 100);
});

test('stale alerter: an optional job whose newest run is a skip is not paged; a mandatory one is, with the reason', async () => {
  const store = memoryStore();
  store.recentRuns = async () => [];
  const sent = [];
  const t = Date.parse('2026-11-12T12:00:00Z');
  const alerter = createAlerter({ store, senders: [async (m) => sent.push(m)], now: () => t });
  const rows = [
    { job: 'meraki.wan', last_ok: '2026-11-01T05:20:00Z', last_skipped: '2026-11-12T05:20:00Z', skip_reason: 'not configured' },   // optional, key removed
    { job: 'teams.sla_poll', last_ok: null, last_skipped: '2026-11-12T11:55:00Z', skip_reason: 'disarmed' },                         // optional, never collected
    { job: 'audit.retention', last_ok: '2026-11-01T03:30:00Z', last_skipped: '2026-11-12T03:30:00Z', skip_reason: 'disarmed' },      // mandatory
    { job: 'opmanager.availability', last_ok: '2026-11-01T05:10:00Z', last_skipped: null },                                          // optional, stale without a skip
  ];
  const out = await alerter.checkStale(rows, FRESHNESS_HOURS, OPTIONAL);
  assert.deepEqual(out.map((m) => m.job).sort(), ['audit.retention', 'opmanager.availability']);
  assert.match(out.find((m) => m.job === 'audit.retention').text, /last run was skipped \(disarmed\)/);
});
