'use strict';
// P11 F-20 — the "edited applied script" detector (db/migrate.js rerunOnChange) also treats destructive DDL as
// run-once: an applied script edited to contain DROP TABLE / DROP COLUMN / ALTER … TYPE is never re-executed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { destructiveDdl, rerunOnChange, listMigrations, migrate, RERUN_MARKER } = require('../db/migrate');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const { makePgDb } = require('../services/pgDb');

test('F-20: DROP TABLE / COLUMN and ALTER … TYPE are destructive; re-creatable drops and comments are not', () => {
  for (const sql of ['DROP TABLE IF EXISTS t;', 'ALTER TABLE t DROP COLUMN IF EXISTS x;', 'ALTER TABLE t DROP x;',
    'ALTER TABLE t ALTER COLUMN x TYPE BIGINT;', 'ALTER TABLE t ALTER x SET DATA TYPE NUMERIC;', 'DROP SCHEMA s CASCADE;',
    'DROP VIEW v;', 'DROP MATERIALIZED VIEW mv;', 'DROP SEQUENCE s;', 'DROP TYPE e;',
    'DO $$ BEGIN ALTER TABLE t DROP IF EXISTS x; END $$;', 'ALTER TABLE "t" ALTER COLUMN "x" TYPE TEXT USING x::text;']) {
    assert.equal(destructiveDdl(sql), true, sql);
    assert.equal(rerunOnChange(sql), false, `${sql} must be run-once`);
  }
  for (const sql of ['DROP TRIGGER IF EXISTS tr ON t;', 'DROP INDEX IF EXISTS i;', 'ALTER TABLE t DROP CONSTRAINT IF EXISTS c;',
    'ALTER TABLE t ALTER COLUMN x DROP DEFAULT;', 'ALTER TABLE t ALTER COLUMN x DROP NOT NULL;', 'DROP FUNCTION IF EXISTS f();',
    '-- DROP TABLE t (comment)\nCREATE TABLE IF NOT EXISTS t (x INT);', 'ALTER TABLE t ADD COLUMN IF NOT EXISTS type TEXT;',
    'CREATE TABLE IF NOT EXISTS t (type TEXT NOT NULL);']) {
    assert.equal(destructiveDdl(sql), false, sql);
  }
  assert.equal(rerunOnChange(`${RERUN_MARKER}\nALTER TABLE t ALTER COLUMN x TYPE BIGINT;`), true, 'an explicit marker still overrides');
});

test('F-20: no shipped migration is reclassified (the DDL re-apply contract is unchanged today)', () => {
  for (const m of listMigrations()) assert.equal(destructiveDdl(m.sql), false, m.id);
});

test('pg F-20: an applied DDL script edited to add DROP COLUMN is reported, never re-executed', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) { t.skip('no pg'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p11-f20-'));
  fs.mkdirSync(path.join(root, 'reports'));
  const f = path.join(root, 'reports', '001_ddl.sql');
  fs.writeFileSync(f, 'CREATE TABLE IF NOT EXISTS fx_d (id INT PRIMARY KEY, keep TEXT);\n');
  const pg = makePgDb(ctx.url); await pg.connect();
  try {
    assert.deepEqual((await migrate(pg, { root })).applied, ['reports/001_ddl.sql']);
    await pg.prepare("INSERT INTO fx_d VALUES (1, 'precious')").run();
    fs.appendFileSync(f, 'ALTER TABLE fx_d DROP COLUMN IF EXISTS keep;\n');
    const r = await migrate(pg, { root, log: () => {} });
    assert.deepEqual(r.changed, ['reports/001_ddl.sql']);
    assert.deepEqual(r.applied, []);
    assert.deepEqual(r.notReapplied, ['reports/001_ddl.sql']);
    assert.equal((await pg.prepare('SELECT keep FROM fx_d WHERE id = 1').get()).keep, 'precious', 'the column survived');
  } finally { await pg.close(); await dropTestDb(ctx); fs.rmSync(root, { recursive: true, force: true }); }
});
