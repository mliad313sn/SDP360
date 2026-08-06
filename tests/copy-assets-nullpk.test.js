'use strict';
// Regression for the Assets → PG cutover (copy-assets.js):
//  1. Rows with a NULL/empty PK are SKIPPED (logged), never abort the tx.
//  2. Append-only tables with NO PK (asset_import_log) copy via a plain INSERT
//     and only into an EMPTY target (re-run guard).
//  3. The irreplaceable history/reconcile tables are in the copy set.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { copyAssets, _upsertSql, TABLES } = require('../tools/pg/copy-assets');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-'));
const sqlitePath = path.join(dir, 'assets.db');
const db = new Database(sqlitePath);
db.exec('CREATE TABLE asset_memory (memory_module_id TEXT, workstation_id TEXT, capacity_gb TEXT, socket_label TEXT, module_tag TEXT)');
db.prepare('INSERT INTO asset_memory VALUES (?,?,?,?,?)').run(null, 'A001', '4', null, null);  // NULL PK → skip
db.prepare('INSERT INTO asset_memory VALUES (?,?,?,?,?)').run('',   'A002', '8', null, null);  // empty PK → skip
db.prepare('INSERT INTO asset_memory VALUES (?,?,?,?,?)').run('M1', 'A003', '16', null, null); // valid → copy
db.exec('CREATE TABLE asset_import_log (source TEXT, imported_at TEXT, row_count INTEGER, dated_count INTEGER, imported_by TEXT)');
db.prepare('INSERT INTO asset_import_log VALUES (?,?,?,?,?)').run('ad', '2026-07-01', 4805, 4805, 'aziz');
db.prepare('INSERT INTO asset_import_log VALUES (?,?,?,?,?)').run('entra', '2026-07-02', 3200, 3100, 'aziz');
db.close();

// Fake pgDb: records inserts; .get() returns {n:emptyCount} for the re-run guard.
function fakePg(emptyCount = 0) {
  const inserts = [];
  return {
    inserts,
    exec: async () => {},
    runTransaction: async (fn) => fn(),
    prepare: (sql) => ({
      run: async (...args) => { inserts.push({ sql, args }); },
      get: async () => ({ n: emptyCount }),
    }),
  };
}

test('skips NULL/empty-PK rows, copies the valid one', async () => {
  const pg = fakePg(0);
  const counts = await copyAssets(sqlitePath, pg);
  assert.deepEqual(counts.asset_memory, { copied: 1, skipped: 2 });
  const mem = pg.inserts.filter(i => /INTO asset_memory/.test(i.sql));
  assert.equal(mem.length, 1);
  assert.equal(mem[0].args[0], 'M1');
});

test('no-PK append-only log copies into an EMPTY target (plain INSERT)', async () => {
  const pg = fakePg(0);
  const counts = await copyAssets(sqlitePath, pg);
  assert.deepEqual(counts.asset_import_log, { copied: 2, skipped: 0 });
  const log = pg.inserts.filter(i => /INTO asset_import_log/.test(i.sql));
  assert.equal(log.length, 2);
  assert.ok(!/ON CONFLICT/.test(log[0].sql), 'no-PK table → plain INSERT, no ON CONFLICT');
});

test('re-run guard: no-PK log is SKIPPED when the target already has rows', async () => {
  const pg = fakePg(7);   // target already populated
  const counts = await copyAssets(sqlitePath, pg);
  assert.equal(counts.asset_import_log.copied, 0);
  assert.equal(counts.asset_import_log.note, 'target not empty');
  assert.equal(pg.inserts.filter(i => /INTO asset_import_log/.test(i.sql)).length, 0);
});

test('_upsertSql builds a plain INSERT for an empty PK', () => {
  const sql = _upsertSql('t', ['a', 'b'], []);
  assert.ok(!/ON CONFLICT/.test(sql));
  assert.equal(sql, 'INSERT INTO t (a, b) VALUES (?, ?)');
});

test('the irreplaceable capture tables are in the copy set', () => {
  const names = TABLES.map(t => t[0]);
  for (const t of ['asset_effort_history', 'asset_reconcile_history', 'asset_reconcile_decisions', 'asset_external_devices', 'asset_import_log']) {
    assert.ok(names.includes(t), `${t} must be copied (irreplaceable / append-only)`);
  }
});
