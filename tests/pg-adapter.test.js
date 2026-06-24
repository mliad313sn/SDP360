'use strict';
// Phase 1 — harden services/pgDb.js for Chunks 2-4: better-sqlite3 named @param
// binding + bigint (COUNT/SUM) handling. Unit tests run anywhere; DB tests skip-clean.
const { test } = require('node:test');
const assert = require('node:assert');
const { _translate, _translateNamed, makePgDb } = require('../services/pgDb');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('translateNamed: @name -> $N, values in first-appearance order', () => {
  const r = _translateNamed('SELECT * FROM t WHERE a=@a AND b=@b', { a: 1, b: 2 });
  assert.equal(r.text, 'SELECT * FROM t WHERE a=$1 AND b=$2');
  assert.deepEqual(r.values, [1, 2]);
});

test('translateNamed: reused name collapses to one $N (value supplied once)', () => {
  const r = _translateNamed("UPDATE t SET x=CASE WHEN @s='submitted' THEN 1 END WHERE st=@s", { s: 'submitted' });
  assert.equal(r.text, "UPDATE t SET x=CASE WHEN $1='submitted' THEN 1 END WHERE st=$1");
  assert.deepEqual(r.values, ['submitted']);
});

test('translateNamed: @ inside quotes and :: casts left untouched', () => {
  const r = _translateNamed("SELECT '@x', count(*)::int FROM t WHERE a=@a", { a: 5 });
  assert.equal(r.text, "SELECT '@x', count(*)::int FROM t WHERE a=$1");
  assert.deepEqual(r.values, [5]);
});

test('translateNamed: missing named parameter throws', () => {
  assert.throws(() => _translateNamed('SELECT * FROM t WHERE a=@a', {}), /missing named parameter/i);
});

test('pgDb: named-param run/get/all + bigint COUNT returns a JS number', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) return t.skip('Postgres not reachable');
  const db = makePgDb(ctx.url); await db.connect();
  try {
    await db.exec('CREATE TABLE m (id INT PRIMARY KEY, site TEXT, n INT)');
    await db.prepare('INSERT INTO m (id, site, n) VALUES (@id, @site, @n)').run({ id: 1, site: 'HGO', n: 5 });
    await db.prepare('INSERT INTO m (id, site, n) VALUES (@id, @site, @n)').run({ id: 2, site: 'HGO', n: 7 });
    assert.deepEqual(await db.prepare('SELECT n FROM m WHERE id=@id').get({ id: 1 }), { n: 5 });
    assert.equal((await db.prepare('SELECT site,n FROM m WHERE site=@s').all({ s: 'HGO' })).length, 2);
    // BIGINT count(*) must come back as a number, not the node-pg default string
    const c = await db.prepare('SELECT count(*) AS n FROM m WHERE site=@s').get({ s: 'HGO' });
    assert.strictEqual(typeof c.n, 'number');
    assert.strictEqual(c.n, 2);
  } finally { await db.close(); await dropTestDb(ctx); }
});

test('pgDb: positional ? binding still works (regression)', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) return t.skip('Postgres not reachable');
  const db = makePgDb(ctx.url); await db.connect();
  try {
    await db.exec('CREATE TABLE p (id INT PRIMARY KEY, v TEXT)');
    const r = await db.prepare('INSERT INTO p (id,v) VALUES (?,?)').run(1, 'a');
    assert.equal(r.changes, 1);
    assert.deepEqual(await db.prepare('SELECT v FROM p WHERE id=?').get(1), { v: 'a' });
  } finally { await db.close(); await dropTestDb(ctx); }
});
