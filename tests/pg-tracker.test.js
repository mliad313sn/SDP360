'use strict';
// Chunk 1 — PostgreSQL adapter + tracker.db cutover. TDD suite.
// Pure-unit tests run anywhere; DB-backed tests skip cleanly when Postgres is down.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const { _translate, makePgDb } = require('../services/pgDb');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const SCHEMA = fs.readFileSync(path.join(__dirname, '../db/postgres/tracker/001_init.sql'), 'utf8');

test('translate: ? becomes $1..$N, quoted ? untouched', () => {
  assert.equal(_translate('SELECT * FROM t WHERE a=? AND b=?'),
                          'SELECT * FROM t WHERE a=$1 AND b=$2');
  assert.equal(_translate("SELECT '?' , a FROM t WHERE a=?"),
                          "SELECT '?' , a FROM t WHERE a=$1");
});

test('pgDb: exec/prepare/run/get/all + runTransaction round-trip', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) return t.skip('Postgres not reachable (start tools/pg/dev-up)');
  const db = makePgDb(ctx.url); await db.connect();
  try {
    await db.exec(`CREATE TABLE k (id INT PRIMARY KEY, v TEXT)`);
    const r = await db.prepare(`INSERT INTO k (id, v) VALUES (?, ?)`).run(1, 'a');
    assert.equal(r.changes, 1);
    assert.deepEqual(await db.prepare(`SELECT v FROM k WHERE id=?`).get(1), { v: 'a' });
    assert.deepEqual(await db.prepare(`SELECT * FROM k`).all(), [{ id: 1, v: 'a' }]);
    // rollback
    await db.runTransaction(async () => { await db.prepare(`INSERT INTO k VALUES (2,'b')`).run(); throw new Error('x'); })
      .catch(() => {});
    assert.equal((await db.prepare(`SELECT count(*)::int n FROM k`).get()).n, 1);
  } finally { await db.close(); await dropTestDb(ctx); }
});

test('schema: applies twice with no error (idempotent) + config singleton + actid indices', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) return t.skip('Postgres not reachable (start tools/pg/dev-up)');
  const db = makePgDb(ctx.url); await db.connect();
  try {
    await db.exec(SCHEMA); await db.exec(SCHEMA);          // idempotent
    const r = await db.prepare(`SELECT count(*)::int n FROM information_schema.tables
                                WHERE table_name LIKE 'tracker_%'`).get();
    assert.ok(r.n >= 7, `expected >=7 tracker tables, got ${r.n}`);
    // config singleton seeded exactly once
    assert.equal((await db.prepare(`SELECT count(*)::int n FROM tracker_config`).get()).n, 1);
    // legacy activity_id indices present
    const idx = await db.prepare(`SELECT indexname FROM pg_indexes
                                  WHERE indexname IN ('ix_track_tgt_actid','ix_track_inp_actid')`).all();
    assert.equal(idx.length, 2, 'both legacy actid indices must exist');
  } finally { await db.close(); await dropTestDb(ctx); }
});
