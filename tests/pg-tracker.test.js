'use strict';
// Chunk 1 — PostgreSQL adapter + tracker.db cutover. TDD suite.
// Pure-unit tests run anywhere; DB-backed tests skip cleanly when Postgres is down.
// tracker-db tests run in the prod-live mode: per-year edits + postgres backend.
process.env.TRACKER_BACKEND = 'postgres';
process.env.TRACKER_PER_YEAR_EDITS = '1';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { _translate, makePgDb } = require('../services/pgDb');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const SCHEMA = fs.readFileSync(path.join(__dirname, '../db/postgres/tracker/001_init.sql'), 'utf8');

// Build a minimal tracker.db fixture (config + 1 year + 1 pillar + 1 activity + v2 rows).
// Returns the sqlite file path. Mirrors the columns copy-tracker reads.
function _makeSqliteFixture() {
  const Database = require('better-sqlite3');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trk-fix-'));
  const p = path.join(dir, 'tracker.db');
  const db = new Database(p);
  db.exec(`
    CREATE TABLE tracker_config (id INTEGER PRIMARY KEY, activities_json TEXT, pillar_weights_json TEXT, active_sites_json TEXT, years_json TEXT, current_month INTEGER);
    CREATE TABLE tracker_years (year INTEGER PRIMARY KEY, active INTEGER DEFAULT 1);
    CREATE TABLE tracker_pillars (id INTEGER PRIMARY KEY, year INTEGER, code TEXT, name TEXT, weight REAL, display_order INTEGER, active INTEGER);
    CREATE TABLE tracker_activities (id INTEGER PRIMARY KEY, pillar_id INTEGER, code TEXT, name TEXT, kpi_type TEXT, start_month INTEGER, end_month INTEGER, display_order INTEGER, active INTEGER, legacy_id INTEGER, legacy_num INTEGER, weight REAL, shared INTEGER);
    CREATE TABLE tracker_targets (site TEXT, activity_ix INTEGER, target TEXT, active INTEGER, activity_id INTEGER, PRIMARY KEY(site,activity_ix));
    CREATE TABLE tracker_inputs (year INTEGER, site TEXT, activity_ix INTEGER, months_json TEXT, activity_id INTEGER, PRIMARY KEY(year,site,activity_ix));
    CREATE TABLE tracker_targets_v2 (year INTEGER, site TEXT, activity_id INTEGER, target TEXT, active INTEGER, PRIMARY KEY(year,site,activity_id));
    CREATE TABLE tracker_inputs_v2 (year INTEGER, site TEXT, activity_id INTEGER, months_json TEXT, PRIMARY KEY(year,site,activity_id));
  `);
  db.prepare(`INSERT INTO tracker_config (id,activities_json,pillar_weights_json,active_sites_json,years_json,current_month) VALUES (1,'[]','{}','["HGO"]','[2026]',6)`).run();
  db.prepare(`INSERT INTO tracker_years (year,active) VALUES (2026,1)`).run();
  db.prepare(`INSERT INTO tracker_pillars (id,year,code,name,weight,display_order,active) VALUES (1,2026,'P1','Network Infrast',25,0,1)`).run();
  db.prepare(`INSERT INTO tracker_activities (id,pillar_id,code,name,kpi_type,start_month,end_month,display_order,active,legacy_id,legacy_num,weight,shared) VALUES (1,1,'A1','Patching','BOOLEAN',1,12,0,1,7,7,0,0)`).run();
  db.prepare(`INSERT INTO tracker_targets_v2 (year,site,activity_id,target,active) VALUES (2026,'HGO',1,'1',1)`).run();
  db.prepare(`INSERT INTO tracker_inputs_v2 (year,site,activity_id,months_json) VALUES (2026,'HGO',1,'[1,0,1,0,0,0,0,0,0,0,0,0]')`).run();
  db.close();
  return p;
}

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

test('copy-tracker: tracker.db -> Postgres parity + idempotence', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) return t.skip('Postgres not reachable (start tools/pg/dev-up)');
  const { copyTracker } = require('../tools/pg/copy-tracker');
  const src = _makeSqliteFixture();
  const db = makePgDb(ctx.url); await db.connect();
  try {
    const c1 = await copyTracker(src, db);            // applies schema + copies
    assert.equal(c1.tracker_years, 1);
    assert.equal(c1.tracker_pillars, 1);
    assert.equal(c1.tracker_activities, 1);
    // months_json preserved verbatim
    const iv = await db.prepare(`SELECT months_json FROM tracker_inputs_v2 WHERE year=? AND site=? AND activity_id=?`).get(2026, 'HGO', 1);
    assert.equal(iv.months_json, '[1,0,1,0,0,0,0,0,0,0,0,0]');
    // pillar/activity ids copied explicitly
    assert.equal((await db.prepare(`SELECT id FROM tracker_pillars WHERE code=?`).get('P1')).id, 1);
    // idempotent: second copy keeps exactly one row each, no PK violation
    await copyTracker(src, db);
    assert.equal((await db.prepare(`SELECT count(*)::int n FROM tracker_activities`).get()).n, 1);
    assert.equal((await db.prepare(`SELECT count(*)::int n FROM tracker_inputs_v2`).get()).n, 1);
    // sequence advanced past copied id: a bare insert gets id > 1
    const r = await db.prepare(`INSERT INTO tracker_pillars (year,code,name,weight) VALUES (2026,'P9','Extra',5)`).run();
    assert.ok(r.lastID > 1, 'identity sequence should be past copied id 1, got ' + r.lastID);
  } finally { await db.close(); await dropTestDb(ctx); fs.rmSync(path.dirname(src), { recursive: true, force: true }); }
});

// ── Task 5: TRACKER_BACKEND selector + boot init ────────────────────────────
test('tracker-db: initPgTracker() connects + applies schema; pgHandle usable', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) return t.skip('Postgres not reachable');
  process.env.PG_URL = ctx.url;
  const tdb = require('../tracker-db');
  assert.equal(tdb.TRACKER_BACKEND, 'postgres', 'backend selector should read env');
  try {
    await tdb.initPgTracker();                       // connect + apply 001_init.sql
    const h = tdb.pgHandle();
    assert.deepEqual(await h.prepare('SELECT 1 AS x').get(), { x: 1 });
    // 001_init applied → config singleton present
    assert.equal((await h.prepare('SELECT count(*)::int n FROM tracker_config').get()).n, 1);
  } finally { try { await tdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
