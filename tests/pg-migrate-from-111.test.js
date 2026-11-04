'use strict';
// Upgrade from 1.11 (Installer CI job upgrade-from-111): the 1.11 release leaves a
// schema_migrations journal keyed (module, filename) without `id`, and a sync_runs table of
// another shape. The 2.0 migrator must bring such a database to the 2.0 schema without losing a
// row, and leave the journal readable by a 1.11 server (the installer rolls the FILES back to
// 1.11, never the database). Before the fix: `[migrate] FAILED: column "id" does not exist`.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrate, status, listMigrations } = require('../db/migrate');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const { makePgDb } = require('../services/pgDb');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'pg-111-legacy-shape.sql'), 'utf8');
const cols = async (pg, t) => (await pg.prepare(
  `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?`).all(t)).map((r) => r.column_name);

test('pg: a 1.11-shaped database migrates to 2.0, keeps every row, and stays readable by 1.11', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) { t.skip('no pg'); return; }
  const pg = makePgDb(ctx.url); await pg.connect();
  try {
    await pg.exec(FIXTURE);
    const all = listMigrations().length;

    const first = await migrate(pg);
    assert.equal(first.legacyJournal, true, '1.11 journal detected and converted');
    assert.equal(first.applied.length, all, 'every 2.0 script applied');

    // journal: 1.11 rows intact (the namespace a rolled-back 1.11 server reads), 2.0 rows beside them
    const legacy = await pg.prepare(`SELECT module, filename, checksum, applied_at FROM schema_migrations WHERE module = ? ORDER BY filename`).all('reports');
    assert.deepEqual(legacy.map((r) => [r.filename, r.checksum, r.applied_at]), [
      ['001_auth.sql', 'fixture-checksum-1', '2026-09-01T00:00:00.000Z'],
      ['015_sync_runs.sql', 'fixture-checksum-2', '2026-09-01T00:00:00.000Z'],
    ]);
    const n2 = await pg.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE id IS NOT NULL').get();
    assert.equal(Number(n2.n), all);
    // a 1.11 server can still record a script (its INSERT has no id, no duration_ms)
    await pg.prepare('INSERT INTO schema_migrations (module, filename, checksum, applied_at) VALUES (?, ?, ?, ?)')
      .run('meetings', '002_additive_columns.sql', 'fixture-checksum-3', '2026-09-02T00:00:00.000Z');

    // sync_runs: the 1.11 table is kept under sync_runs_v1 with its row, the 2.0 table is created
    assert.ok((await cols(pg, 'sync_runs')).includes('id'));
    assert.ok((await cols(pg, 'sync_runs')).includes('job'));
    const kept = await pg.prepare('SELECT run_id, job_key, status FROM sync_runs_v1').all();
    assert.deepEqual(kept, [{ run_id: 'fixture-run-1', job_key: 'fixture.job', status: 'ok' }]);
    assert.equal(Number((await pg.prepare('SELECT COUNT(*) AS n FROM sync_job_state').get()).n), 0, '1.11 sync_job_state untouched');
    const r = await pg.prepare('INSERT INTO sync_runs (job, started_at, status) VALUES (?, ?, ?)').run('assets.sync', '2026-11-04T00:00:00Z', 'ok');
    assert.ok(r.lastID, '2.0 run log writable');

    // replay: nothing to do, everything applied
    const second = await migrate(pg);
    assert.equal(second.legacyJournal, false);
    assert.equal(second.applied.length, 0);
    assert.equal(second.skipped.length, all);
    assert.ok((await status(pg)).every((s) => s.state === 'applied'));
  } finally { await pg.close(); await dropTestDb(ctx); }
});

test('pg: a fresh database is not affected by the 1.11 upgrade steps', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) { t.skip('no pg'); return; }
  const pg = makePgDb(ctx.url); await pg.connect();
  try {
    const r = await migrate(pg);
    assert.equal(r.legacyJournal, false);
    assert.equal(r.applied.length, listMigrations().length);
    const tables = (await pg.prepare(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE 'sync_runs%'`).all()).map((x) => x.table_name);
    assert.deepEqual(tables, ['sync_runs']);
    assert.deepEqual((await cols(pg, 'schema_migrations')).sort(), ['applied_at', 'checksum', 'duration_ms', 'id']);
  } finally { await pg.close(); await dropTestDb(ctx); }
});

test('pg: a failing script is named in the error and leaves no journal row', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) { t.skip('no pg'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-migrate-'));
  fs.mkdirSync(path.join(root, 'reports'));
  fs.writeFileSync(path.join(root, 'reports', '001_ok.sql'), 'CREATE TABLE IF NOT EXISTS mig_probe (a INT);');
  fs.writeFileSync(path.join(root, 'reports', '002_bad.sql'), 'CREATE TABLE mig_probe_2 (a INT); CREATE INDEX ON mig_probe (no_such_column);');
  const pg = makePgDb(ctx.url); await pg.connect();
  try {
    await assert.rejects(migrate(pg, { root }), (e) => e.migration === 'reports/002_bad.sql' && /^reports\/002_bad\.sql: .*no_such_column/.test(e.message));
    const ids = (await pg.prepare('SELECT id FROM schema_migrations').all()).map((r) => r.id);
    assert.deepEqual(ids, ['reports/001_ok.sql']);
    const t2 = await pg.prepare(`SELECT to_regclass(current_schema() || '.mig_probe_2') AS r`).get();
    assert.equal(t2.r, null, 'the failing script left no half of its DDL');
  } finally { await pg.close(); await dropTestDb(ctx); fs.rmSync(root, { recursive: true, force: true }); }
});
