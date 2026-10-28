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

// Minimal tracker fixture (config + 1 year + 1 pillar + 1 activity + v2 rows), written
// straight into PostgreSQL — the SQLite copy path is gone (PO-08).
async function _seedPg(h) {
  // a fresh database now carries the shipped programme (initPgTracker seeds it) — start from empty
  await h.exec('DELETE FROM tracker_inputs_v2; DELETE FROM tracker_targets_v2; DELETE FROM tracker_years');
  await h.prepare(`UPDATE tracker_config SET activities_json='[]', pillar_weights_json='{}', active_sites_json='["HGO"]', years_json='[2026]', current_month=6 WHERE id=1`).run();
  await h.prepare(`INSERT INTO tracker_years (year,active) VALUES (2026,1) ON CONFLICT DO NOTHING`).run();
  const p = await h.prepare(`INSERT INTO tracker_pillars (year,code,name,weight,display_order,active) VALUES (2026,'P1','Network Infrast',25,0,1)`).run();
  const a = await h.prepare(`INSERT INTO tracker_activities (pillar_id,code,name,kpi_type,start_month,end_month,display_order,active,legacy_id,legacy_num,weight,shared) VALUES (?,'A1','Patching','BOOLEAN',1,12,0,1,7,7,0,0)`).run(p.lastID);
  await h.prepare(`INSERT INTO tracker_targets_v2 (year,site,activity_id,target,active) VALUES (2026,'HGO',?,'1',1)`).run(a.lastID);
  await h.prepare(`INSERT INTO tracker_inputs_v2 (year,site,activity_id,months_json) VALUES (2026,'HGO',?,'[1,0,1,0,0,0,0,0,0,0,0,0]')`).run(a.lastID);
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
                                WHERE table_schema = current_schema() AND table_name LIKE 'tracker_%'`).get();
    assert.ok(r.n >= 7, `expected >=7 tracker tables, got ${r.n}`);
    // config singleton seeded exactly once
    assert.equal((await db.prepare(`SELECT count(*)::int n FROM tracker_config`).get()).n, 1);
    // legacy activity_id indices present
    const idx = await db.prepare(`SELECT indexname FROM pg_indexes
                                  WHERE schemaname = current_schema()
                                    AND indexname IN ('ix_track_tgt_actid','ix_track_inp_actid')`).all();
    assert.equal(idx.length, 2, 'both legacy actid indices must exist');
  } finally { await db.close(); await dropTestDb(ctx); }
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

// ── Task 6: async postgres v2 load/save parity ──────────────────────────────
// Boot a tracker pg handle pointed at a fresh DB seeded with the fixture.
async function _bootPgTracker() {
  const ctx = await provisionTestDb();
  if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const tdb = require('../tracker-db');
  await tdb.initPgTracker();
  await _seedPg(tdb.pgHandle());
  return { ctx, tdb };
}

test('pg load: loadTracker() returns correct per-year D from Postgres', async (t) => {
  const boot = await _bootPgTracker();
  if (!boot) return t.skip('Postgres not reachable');
  const { ctx, tdb } = boot;
  try {
    const D = await tdb.loadTracker();
    assert.ok(D.years.includes(2026), 'years includes 2026');
    assert.equal(D.perYearEnabled, true);
    const yd = D.byYear[2026];
    assert.equal(yd.activities[0].code, 'A1');
    assert.equal(yd.activities[0].name, 'Patching');
    assert.equal(yd.activities[0].kpi, 'BOOLEAN');
    assert.equal(yd.activities[0].pillar, 'P1-Network Infrast');
    assert.equal(yd.pillarWeights['P1-Network Infrast'], 25);
    assert.deepEqual(D.inputs[2026].HGO[0], [1,0,1,0,0,0,0,0,0,0,0,0]);
    assert.deepEqual(D.targets.HGO[0], { target: 1, active: true });
  } finally { try { await tdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('pg save: exec round-trip persists an input edit', async (t) => {
  const boot = await _bootPgTracker();
  if (!boot) return t.skip('Postgres not reachable');
  const { ctx, tdb } = boot;
  try {
    const D = await tdb.loadTracker();
    D.inputs[2026].HGO[0] = [9,9,9,0,0,0,0,0,0,0,0,0];   // edit
    await tdb.saveTracker(D, null);                       // exec/super_admin
    const D2 = await tdb.loadTracker();
    assert.deepEqual(D2.inputs[2026].HGO[0], [9,9,9,0,0,0,0,0,0,0,0,0]);
  } finally { try { await tdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('pg save: adding a pillar+activity syncs structure (lastID FK)', async (t) => {
  const boot = await _bootPgTracker();
  if (!boot) return t.skip('Postgres not reachable');
  const { ctx, tdb } = boot;
  try {
    const D = await tdb.loadTracker();
    // add a new pillar P2 with a new activity in byYear[2026]
    D.byYear[2026].pillarWeights['P2-Business Partner'] = 20;
    D.byYear[2026].activities.push({ pillar: 'P2-Business Partner', name: 'Onboarding', kpi: 'BOOLEAN', start: 1, end: 12, code: 'B1' });
    D.byYear[2026].targets = D.byYear[2026].targets || {};
    await tdb.saveTracker(D, null);
    const D2 = await tdb.loadTracker();
    const codes = D2.byYear[2026].activities.map(a => a.code).sort();
    assert.deepEqual(codes, ['A1', 'B1']);
    assert.equal(D2.byYear[2026].pillarWeights['P2-Business Partner'], 20);
  } finally { try { await tdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── Task 7: year delete cascade + preview + RBAC ────────────────────────────
test('pg delete-year: FK cascade removes year N, preserves year M', async (t) => {
  const boot = await _bootPgTracker();
  if (!boot) return t.skip('Postgres not reachable');
  const { ctx, tdb } = boot;
  try {
    // add a second year 2027 via the save path
    const D = await tdb.loadTracker();
    D.years = [2026, 2027];
    D.byYear[2027] = { activities: [{ pillar: 'P1-Network Infrast', name: 'Patching', kpi: 'BOOLEAN', start: 1, end: 12, code: 'A1' }], pillarWeights: { 'P1-Network Infrast': 25 }, targets: {} };
    D.inputs[2027] = { HGO: [[2,2,0,0,0,0,0,0,0,0,0,0]] };
    await tdb.saveTracker(D, null);

    const res = await tdb.deleteTrackerYear(2026);
    assert.deepEqual(res.years_after, [2027]);

    const h = tdb.pgHandle();
    assert.equal((await h.prepare('SELECT count(*)::int n FROM tracker_years WHERE year=?').get(2026)).n, 0);
    assert.equal((await h.prepare('SELECT count(*)::int n FROM tracker_pillars WHERE year=?').get(2026)).n, 0, 'pillars cascaded');
    assert.equal((await h.prepare('SELECT count(*)::int n FROM tracker_inputs_v2 WHERE year=?').get(2026)).n, 0, 'v2 inputs cascaded');
    assert.equal((await h.prepare('SELECT count(*)::int n FROM tracker_inputs_v2 WHERE year=?').get(2027)).n, 1, 'year 2027 intact');

    const D2 = await tdb.loadTracker();
    assert.ok(!D2.years.includes(2026));
    assert.deepEqual(D2.inputs[2027].HGO[0], [2,2,0,0,0,0,0,0,0,0,0,0]);
  } finally { try { await tdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('pg preview-year: returns cascade impact without mutating', async (t) => {
  const boot = await _bootPgTracker();
  if (!boot) return t.skip('Postgres not reachable');
  const { ctx, tdb } = boot;
  try {
    const D = await tdb.loadTracker();
    D.years = [2026, 2027];
    D.byYear[2027] = { activities: [{ pillar: 'P1-Network Infrast', name: 'Patching', kpi: 'BOOLEAN', start: 1, end: 12, code: 'A1' }], pillarWeights: { 'P1-Network Infrast': 25 }, targets: {} };
    D.inputs[2027] = { HGO: [[2,2,0,0,0,0,0,0,0,0,0,0]] };
    await tdb.saveTracker(D, null);

    const pv = await tdb.previewDeleteTrackerYear(2026);
    assert.equal(pv.is_in_config, true);
    assert.deepEqual(pv.years_after, [2027]);
    assert.equal(pv.inputs_will_be_deleted, 1);
    assert.equal(pv.would_leave_zero_years, false);
    // not mutated
    assert.equal((await tdb.pgHandle().prepare('SELECT count(*)::int n FROM tracker_years WHERE year=?').get(2026)).n, 1);
  } finally { try { await tdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('pg RBAC: admin save writes only own site inputs', async (t) => {
  const boot = await _bootPgTracker();
  if (!boot) return t.skip('Postgres not reachable');
  const { ctx, tdb } = boot;
  try {
    const D = await tdb.loadTracker();
    D.inputs[2026].HGO[0] = [5,5,5,0,0,0,0,0,0,0,0,0];
    D.inputs[2026].MGO    = [[7,7,7,0,0,0,0,0,0,0,0,0]];
    await tdb.saveTracker(D, 'HGO');                       // admin scoped to HGO
    const D2 = await tdb.loadTracker();
    assert.deepEqual(D2.inputs[2026].HGO[0], [5,5,5,0,0,0,0,0,0,0,0,0], 'HGO written');
    assert.ok(!D2.inputs[2026].MGO, 'MGO inputs must NOT be written under HGO scope');
  } finally { try { await tdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
