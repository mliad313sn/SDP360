'use strict';
// P11 r4 N-11 — the PostgreSQL pool had no acquire timeout: with every client held (a long table lock behind a slow
// report), ordinary requests queued for ~43 s. The acquire wait is now bounded (PG_POOL_ACQUIRE_TIMEOUT_MS, default
// 10 s) and a timed-out acquire is a typed DB_BUSY error that fail() answers as 503 + Retry-After. A query that
// already holds a client is never cut short (a long migration keeps running).
const test = require('node:test');
const assert = require('node:assert');
const { makePgDb, acquireTimeoutMs, DEFAULT_ACQUIRE_TIMEOUT_MS, _busy } = require('../services/pgDb');
const H = require('../services/httpError');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('acquireTimeoutMs: default 10 s, env override, 0 = unbounded, garbage → default', () => {
  assert.equal(DEFAULT_ACQUIRE_TIMEOUT_MS, 10000);
  assert.equal(acquireTimeoutMs({}), 10000);
  assert.equal(acquireTimeoutMs({ PG_POOL_ACQUIRE_TIMEOUT_MS: '2500' }), 2500);
  assert.equal(acquireTimeoutMs({ PG_POOL_ACQUIRE_TIMEOUT_MS: '0' }), 0);
  assert.equal(acquireTimeoutMs({ PG_POOL_ACQUIRE_TIMEOUT_MS: 'abc' }), 10000);
  assert.equal(acquireTimeoutMs({ PG_POOL_ACQUIRE_TIMEOUT_MS: '-5' }), 10000);
});

test('a DB_BUSY error is answered 503 database_busy + Retry-After, no internal message', () => {
  const e = _busy(new Error('timeout exceeded when trying to connect'));
  assert.equal(e.code, 'DB_BUSY');
  const res = { headers: {}, set(k, v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; } };
  const orig = console.error; console.error = () => {};
  try { H.fail(res, e); } finally { console.error = orig; }
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'database_busy');
  assert.equal(res.body.code, 'DB_BUSY');
  assert.ok(res.body.correlation_id);
  assert.equal(res.headers['Retry-After'], '5');
  assert.ok(!JSON.stringify(res.body).includes('timeout exceeded'));
  // any other error is untouched
  const other = new Error('x'); assert.strictEqual(_busy(other), other);
});

test('every client held: a request fails fast with DB_BUSY, the held query keeps running', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) { t.skip('no PostgreSQL'); return; }
  const prevMax = process.env.PG_POOL_MAX; const prevTo = process.env.PG_POOL_ACQUIRE_TIMEOUT_MS;
  process.env.PG_POOL_MAX = '1'; process.env.PG_POOL_ACQUIRE_TIMEOUT_MS = '300';
  const db = makePgDb(ctx.url);
  try {
    await db.connect();
    // a long statement holds the only client for 1.5 s (longer than the acquire timeout)
    const held = db.prepare('SELECT pg_sleep(1.5) AS slept').get();
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    await assert.rejects(db.prepare('SELECT 1 AS ok').get(), (e) => e.code === 'DB_BUSY' && e.status === 503);
    const waited = Date.now() - t0;
    assert.ok(waited < 1200, `failed within the bound, not after the held query (${waited} ms)`);
    await assert.rejects(db.runTransaction(async () => 1), (e) => e.code === 'DB_BUSY');
    const r = await held; // the long query was not cut short
    assert.ok(r && 'slept' in r);
    assert.equal((await db.prepare('SELECT 1 AS ok').get()).ok, 1, 'the pool is usable again');
  } finally {
    if (prevMax == null) delete process.env.PG_POOL_MAX; else process.env.PG_POOL_MAX = prevMax;
    if (prevTo == null) delete process.env.PG_POOL_ACQUIRE_TIMEOUT_MS; else process.env.PG_POOL_ACQUIRE_TIMEOUT_MS = prevTo;
    await db.close(); await dropTestDb(ctx);
  }
});
