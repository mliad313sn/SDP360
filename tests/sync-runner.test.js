'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createSyncRunner, memoryStore, dedupeBy, deltaSince, isTransient, backoffDelay, scrub } = require('../services/sync/syncRunner');

const quiet = () => {};
function runner(extra = {}) {
  const store = memoryStore();
  const slept = [];
  let t = 1_000_000;
  const r = createSyncRunner({ store, log: quiet, sleep: async (ms) => { slept.push(ms); }, now: () => (t += 1000), rand: () => 0.5, ...extra });
  return { r, store, slept };
}

test('happy path: rows applied, run logged ok, watermark advanced', async () => {
  const { r, store } = runner();
  const applied = [];
  const out = await r.run({
    name: 'zoho.requests', key: 'request_id',
    fetch: async () => ({ rows: [{ request_id: 1 }, { request_id: 2 }], nextWatermark: '2026-10-19T00:00:00Z' }),
    apply: async ({ rows }) => { applied.push(...rows); return { upserted: rows.length, deleted: 0 }; },
  });
  assert.equal(out.status, 'ok');
  assert.equal(out.rows, 2);
  assert.equal(applied.length, 2);
  assert.equal(await store.getWatermark('zoho.requests'), '2026-10-19T00:00:00Z');
  assert.equal(store.runs[0].status, 'ok');
  assert.equal(store.runs[0].attempts, 1);
});

test('dedupe by natural key keeps the last occurrence and drops unkeyed rows', () => {
  const rows = dedupeBy([{ id: 1, v: 'a' }, { id: 2 }, { id: 1, v: 'b' }, { v: 'orphan' }], 'id');
  assert.deepEqual(rows, [{ id: 1, v: 'b' }, { id: 2 }]);
});

test('transient errors retry with exponential backoff, then succeed', async () => {
  const { r, store, slept } = runner();
  let n = 0;
  const out = await r.run({
    name: 'meraki.wan', key: 'id',
    fetch: async () => { n++; if (n < 3) { const e = new Error('rate limited'); e.status = 429; throw e; } return { rows: [{ id: 'x' }] }; },
  });
  assert.equal(out.status, 'ok');
  assert.equal(out.attempts, 3);
  assert.deepEqual(slept, [2000, 4000]);
  assert.equal(store.runs[0].attempts, 3);
});

test('non-transient error fails fast without retry and is recorded', async () => {
  const { r, store, slept } = runner();
  const events = [];
  const r2 = createSyncRunner({ store, log: quiet, sleep: async () => {}, onEvent: (k, p) => events.push([k, p]) });
  const out = await r2.run({ name: 'sdp.api', fetch: async () => { const e = new Error('bad filter'); e.status = 400; throw e; } });
  assert.equal(out.status, 'error');
  assert.equal(out.attempts, 1);
  assert.equal(slept.length, 0);
  assert.equal(store.runs[0].status, 'error');
  assert.ok(events.some(([k]) => k === 'sync_failed'));
});

test('gives up after maxAttempts on persistent transient failure', async () => {
  const { r } = runner();
  const out = await r.run({ name: 'opm', opts: { maxAttempts: 3 }, fetch: async () => { const e = new Error('ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e; } });
  assert.equal(out.status, 'error');
  assert.equal(out.attempts, 3);
});

test('overlap: a second run of the same job is skipped while the first holds the lock', async () => {
  const { r, store } = runner();
  let release;
  const gate = new Promise((res) => { release = res; });
  const first = r.run({ name: 'poll', fetch: async () => { await gate; return { rows: [] }; } });
  const second = await r.run({ name: 'poll', fetch: async () => ({ rows: [] }) });
  assert.equal(second.status, 'skipped');
  assert.equal(second.reason, 'overlap');
  release();
  const out = await first;
  assert.equal(out.status, 'ok');
  assert.equal(store.locks.size, 0, 'lock released');
});

test('stale lock (older than lockTtlMs) is stolen', async () => {
  const store = memoryStore();
  store.locks.set('job', 0); // locked at epoch
  const r = createSyncRunner({ store, log: quiet, now: () => 10_000_000 });
  const out = await r.run({ name: 'job', fetch: async () => ({ rows: [] }) });
  assert.equal(out.status, 'ok');
});

test('empty-result guard: 0 rows after a populated run is refused and retried, never applied', async () => {
  const { r, store } = runner();
  await r.run({ name: 'assets', key: 'id', fetch: async () => ({ rows: [{ id: 1 }, { id: 2 }] }) });
  let applied = false;
  const out = await r.run({ name: 'assets', key: 'id', opts: { maxAttempts: 2 }, fetch: async () => ({ rows: [] }), apply: async () => { applied = true; } });
  assert.equal(out.status, 'error');
  assert.equal(applied, false);
  assert.match(out.error, /empty fetch/);
  assert.equal(store.runs[1].status, 'error');
});

test('empty-result guard lets a genuinely empty first run through, and can be disabled', async () => {
  const { r } = runner();
  const a = await r.run({ name: 'fresh', fetch: async () => ({ rows: [] }) });
  assert.equal(a.status, 'ok');
  await r.run({ name: 'g', key: 'id', fetch: async () => ({ rows: [{ id: 1 }] }) });
  const b = await r.run({ name: 'g', key: 'id', opts: { emptyGuard: false }, fetch: async () => ({ rows: [] }) });
  assert.equal(b.status, 'ok');
});

test('deltaSince keeps rows newer than the watermark and advances it; unparseable dates always pass', () => {
  const rows = [
    { id: 1, t: '2026-10-01T00:00:00Z' },
    { id: 2, t: '2026-10-05T00:00:00Z' },
    { id: 3, t: 'n/a' },
    { id: 4, t: '2026-10-03T00:00:00Z' },
  ];
  const d = deltaSince(rows, '2026-10-02T00:00:00Z', 't');
  assert.deepEqual(d.rows.map((r) => r.id), [2, 3, 4]);
  assert.equal(d.nextWatermark, '2026-10-05T00:00:00Z');
  assert.equal(d.liveIds.length, 4, 'full live set kept for the deletion reconcile');
  const none = deltaSince(rows.slice(0, 1), null, 't');
  assert.equal(none.rows.length, 1);
  assert.equal(none.nextWatermark, '2026-10-01T00:00:00Z');
});

test('isTransient classification', () => {
  assert.equal(isTransient({ status: 503 }), true);
  assert.equal(isTransient({ status: 429 }), true);
  assert.equal(isTransient({ code: 'ECONNRESET' }), true);
  assert.equal(isTransient({ message: 'socket hang up' }), true);
  assert.equal(isTransient({ status: 401 }), false);
  assert.equal(isTransient({ status: 404 }), false);
  assert.equal(isTransient({ transient: false, status: 500 }), false);
});

test('backoffDelay honours Retry-After seconds and caps at maxDelayMs', () => {
  const opts = { baseDelayMs: 1000, maxDelayMs: 5000, jitter: 0 };
  assert.equal(backoffDelay(1, {}, opts, () => 0.5), 1000);
  assert.equal(backoffDelay(3, {}, opts, () => 0.5), 4000);
  assert.equal(backoffDelay(10, {}, opts, () => 0.5), 5000);
  assert.equal(backoffDelay(1, { response: { headers: { 'retry-after': '3' } } }, opts), 3000);
  assert.equal(backoffDelay(1, { response: { headers: { 'retry-after': '999' } } }, opts), 5000);
});

test('scrub removes tokens and keys from error text', () => {
  assert.equal(scrub('GET /x?apiKey=abc123&y=1'), 'GET /x?apiKey=***&y=1');
  assert.equal(scrub('Zoho-oauthtoken 1000.abcd.efgh failed'), 'Zoho-oauthtoken *** failed');
  assert.equal(scrub('X-Cisco-Meraki-API-Key: deadbeef'), 'X-Cisco-Meraki-API-Key: ***');
});

test('run() rejects a job without name or fetch', async () => {
  const { r } = runner();
  await assert.rejects(async () => r.run({ name: 'x' }), TypeError);
  await assert.rejects(async () => r.run({ fetch: async () => ({}) }), TypeError);
});
