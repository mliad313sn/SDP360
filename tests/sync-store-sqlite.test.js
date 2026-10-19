'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { makeSyncStore } = require('../services/sync/syncStore');
const { createSyncRunner } = require('../services/sync/syncRunner');

function fresh() { return makeSyncStore(new Database(':memory:'), { owner: 'test:1' }); }

test('sqlite store: creates tables and round-trips watermark', async () => {
  const s = fresh();
  assert.equal(await s.getWatermark('j'), null);
  await s.setWatermark('j', '2026-01-01T00:00:00Z');
  assert.equal(await s.getWatermark('j'), '2026-01-01T00:00:00Z');
  await s.setWatermark('j', '2026-02-01T00:00:00Z');
  assert.equal(await s.getWatermark('j'), '2026-02-01T00:00:00Z');
});

test('sqlite store: lock is exclusive, stale lock is stolen, release frees it', async () => {
  const s = fresh();
  const now = Date.now();
  assert.equal(await s.acquireLock('j', now, 60_000), true);
  assert.equal(await s.acquireLock('j', now + 1000, 60_000), false);
  assert.equal(await s.acquireLock('j', now + 61_000, 60_000), true, 'stale lock stolen');
  await s.releaseLock('j');
  assert.equal(await s.acquireLock('j', now + 62_000, 60_000), true);
});

test('sqlite store: run rows are written and lastSuccessfulRun/health read them back', async () => {
  const s = fresh();
  const r = createSyncRunner({ store: s, log: () => {}, sleep: async () => {} });
  await r.run({ name: 'assets', key: 'id', fetch: async () => ({ rows: [{ id: 1 }, { id: 1 }, { id: 2 }] }) });
  const last = await s.lastSuccessfulRun('assets');
  assert.equal(last.rows, 2);
  assert.equal(last.duplicates, 1);
  assert.equal(last.status, 'ok');
  await r.run({ name: 'assets', key: 'id', opts: { maxAttempts: 1 }, fetch: async () => { throw new Error('boom'); } });
  const recent = await s.recentRuns('assets', 10);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].status, 'error');
  assert.equal(recent[0].error, 'boom');
  const h = await s.health();
  assert.equal(h.length, 1);
  assert.equal(h[0].job, 'assets');
  assert.equal(Number(h[0].errors), 1);
  assert.ok(h[0].last_ok);
});
