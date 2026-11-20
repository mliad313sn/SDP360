'use strict';
// P11 F-03 — an applied migration whose bytes changed (a comment edit) used to be RE-EXECUTED, re-running its data
// backfill (reports/039 stage reset, reports/066 time-zone default) on top of what users changed since. Contract now:
// a changed applied script is REPORTED (`changed`); one that WRITES DATA is NOT re-executed (status stays 'changed',
// journal keeps the applied checksum); a DDL-only script is re-applied as before. Line markers override:
// `-- migrate:rerun-on-change` / `-- migrate:run-once`.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrate, status, listMigrations, writesData, rerunOnChange, RERUN_MARKER } = require('../db/migrate');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const { makePgDb } = require('../services/pgDb');

test('writesData / rerunOnChange: data scripts frozen, DDL re-applied, markers override; 039 and 066 are frozen', () => {
  assert.equal(writesData('ALTER TABLE t ADD COLUMN IF NOT EXISTS x INT;'), false);
  assert.equal(writesData('-- UPDATE t SET x = 1 (in a comment)\nCREATE INDEX IF NOT EXISTS i ON t(x);'), false);
  assert.equal(writesData('UPDATE portfolio_projects\n  SET stage = 1;'), true);
  assert.equal(writesData('INSERT INTO t VALUES (1) ON CONFLICT DO NOTHING;'), true);
  assert.equal(writesData('DO $$ BEGIN DELETE FROM t WHERE false; END $$;'), true);
  assert.equal(rerunOnChange('-- migrate:rerun-on-change\nUPDATE t SET x = 1;'), true);
  assert.equal(rerunOnChange('-- migrate:run-once\nCREATE TABLE IF NOT EXISTS t (x INT);'), false);
  const byId = Object.fromEntries(listMigrations().map((m) => [m.id, m]));
  for (const id of ['reports/039_native_ppm.sql', 'reports/066_site_time_zone.sql']) assert.equal(rerunOnChange(byId[id].sql), false, `${id} must never re-run on a byte change`);
  for (const id of ['reports/085_ppm_workbench.sql', 'sync/001_init.sql']) assert.equal(rerunOnChange(byId[id].sql), true, `${id} (DDL, edited by append in the past) keeps re-applying`);
});

test('pg: an edited applied DATA script is reported, never re-executed; DDL and marked scripts re-apply', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) { t.skip('no pg'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p11-mig-'));
  fs.mkdirSync(path.join(root, 'reports'));
  const f1 = path.join(root, 'reports', '001_seed.sql');
  const f2 = path.join(root, 'reports', '002_ddl.sql');
  fs.writeFileSync(f1, "CREATE TABLE IF NOT EXISTS fx_t (id INT PRIMARY KEY, v TEXT);\nINSERT INTO fx_t VALUES (1, 'seed') ON CONFLICT DO NOTHING;\nUPDATE fx_t SET v = 'backfilled' WHERE v = 'seed';\n");
  fs.writeFileSync(f2, 'CREATE TABLE IF NOT EXISTS fx_u (id INT);\n');
  const f3 = path.join(root, 'reports', '003_marked.sql');
  fs.writeFileSync(f3, `${RERUN_MARKER}\nCREATE TABLE IF NOT EXISTS fx_v (id INT PRIMARY KEY);\nINSERT INTO fx_v VALUES (1) ON CONFLICT DO NOTHING;\n`);
  const pg = makePgDb(ctx.url); await pg.connect();
  const logs = [];
  try {
    const first = await migrate(pg, { root });
    assert.deepEqual(first.applied, ['reports/001_seed.sql', 'reports/002_ddl.sql', 'reports/003_marked.sql']);
    // a user changes the data after the backfill ran
    await pg.prepare("UPDATE fx_t SET v = 'seed' WHERE id = 1").run();
    // a comment edit changes the bytes of both applied files
    fs.appendFileSync(f1, '-- typo fixed in a comment\n');
    fs.appendFileSync(f2, 'ALTER TABLE fx_u ADD COLUMN IF NOT EXISTS w TEXT;\n');
    fs.appendFileSync(f3, '-- edited\n');
    const second = await migrate(pg, { root, log: (s) => logs.push(s) });
    assert.deepEqual(second.changed.sort(), ['reports/001_seed.sql', 'reports/002_ddl.sql', 'reports/003_marked.sql']);
    assert.deepEqual(second.applied, ['reports/002_ddl.sql', 'reports/003_marked.sql'], 'the DDL script and the marked one re-run');
    assert.deepEqual(second.notReapplied, ['reports/001_seed.sql']);
    const row = await pg.prepare('SELECT v FROM fx_t WHERE id = 1').get();
    assert.equal(row.v, 'seed', 'the backfill did NOT run again over the user change');
    const col = await pg.prepare("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'fx_u' AND column_name = 'w'").get();
    assert.equal(Number(col.n), 1, 'the DDL script was re-applied (historical contract kept)');
    assert.ok(logs.some((l) => /001_seed\.sql.*changed after it was applied.*NOT re-executed/.test(l)), logs.join('\n'));
    const st = Object.fromEntries((await status(pg, { root })).map((r) => [r.id, r.state]));
    assert.equal(st['reports/001_seed.sql'], 'changed', 'still reported on every run');
    assert.equal(st['reports/002_ddl.sql'], 'applied');
    assert.equal(st['reports/003_marked.sql'], 'applied');
    const third = await migrate(pg, { root });
    assert.deepEqual(third.applied, [], 'replay stays inert');
    assert.equal(RERUN_MARKER, '-- migrate:rerun-on-change');
  } finally { await pg.close(); await dropTestDb(ctx); fs.rmSync(root, { recursive: true, force: true }); }
});
