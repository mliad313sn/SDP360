'use strict';
// Step 2 — the schema migrator: applies every db/postgres/**/*.sql once, records it, is replayable
// with no effect, and reports edited scripts. Pure listing test runs anywhere; the apply test needs
// PostgreSQL (skips with a reason, fails under PG_TESTS_REQUIRED=1 — see tests/pg-helpers.js).
const { test } = require('node:test');
const assert = require('node:assert');
const { listMigrations, migrate, status, AREA_ORDER } = require('../db/migrate');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const { makePgDb } = require('../services/pgDb');

test('listMigrations: every area present, reports first, files in order, stable ids', () => {
  const ms = listMigrations();
  assert.ok(ms.length >= 21, `expected ≥ 21 scripts, got ${ms.length}`);
  assert.equal(ms[0].area, 'reports');
  const areas = [...new Set(ms.map((m) => m.area))];
  assert.deepEqual(areas, AREA_ORDER.filter((a) => areas.includes(a)));
  assert.ok(ms.some((m) => m.id === 'tracker/002_tracker_definitions.sql'));
  assert.ok(ms.some((m) => m.id === 'reports/016_dashboard_definitions.sql'));
  assert.ok(ms.some((m) => m.id === 'sync/001_init.sql'));
  const ids = ms.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('pg: migrate applies all scripts, is idempotent, records schema_migrations, status reads back', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) { t.skip('no pg'); return; }
  const pg = makePgDb(ctx.url); await pg.connect();
  try {
    const first = await migrate(pg);
    assert.ok(first.applied.length >= 21);
    assert.equal(first.skipped.length, 0);
    const second = await migrate(pg);
    assert.equal(second.applied.length, 0, 'replay applies nothing');
    assert.equal(second.skipped.length, first.applied.length);
    const st = await status(pg);
    assert.ok(st.every((r) => r.state === 'applied'));
    // the previously-unexecuted SDP360 tables now exist
    for (const tbl of ['tracker_definitions', 'dashboard_definitions', 'metric_registry', 'kpi_rag_policies', 'rfi_requests', 'sync_runs']) {
      const r = await pg.prepare(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?`).get(tbl);
      assert.equal(Number(r.n), 1, `table ${tbl} created`);
    }
    const n = await pg.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get();
    assert.equal(Number(n.n), first.applied.length);
  } finally { await pg.close(); await dropTestDb(ctx); }
});
