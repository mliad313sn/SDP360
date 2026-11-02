'use strict';
// A-01 — tools/pg/copy-legacy-sqlite.js: copies a 1.x assets.db (SQLite, opened READ-ONLY through node:sqlite)
// into the migrated PostgreSQL assets tables. Dry-run by default, --apply in one transaction, NULL-PK rows skipped,
// append-only asset_import_log copied only into an empty target, never applies a schema itself.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { makePgDb } = require('../services/pgDb');
const tool = require('../tools/pg/copy-legacy-sqlite');

const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-copy-legacy-'));
const src = path.join(dir, 'assets.db');
{
  const db = new DatabaseSync(src);
  db.exec('CREATE TABLE asset_memory (memory_module_id TEXT, workstation_id TEXT, capacity_gb TEXT, socket_label TEXT, module_tag TEXT)');
  const m = db.prepare('INSERT INTO asset_memory VALUES (?,?,?,?,?)');
  m.run(null, 'A001', '4', null, null); m.run('', 'A002', '8', null, null); m.run('M1', 'A003', '16', null, null);
  db.exec('CREATE TABLE asset_effort_history (snapshot_date TEXT, site TEXT, total INTEGER, effort_score REAL)');
  db.prepare('INSERT INTO asset_effort_history (snapshot_date, site, total, effort_score) VALUES (?,?,?,?)').run('2026-08-01', 'MANA', 471, 54);
  db.prepare('INSERT INTO asset_effort_history (snapshot_date, site, total, effort_score) VALUES (?,?,?,?)').run('2026-08-02', 'MANA', 472, 55);
  db.exec('CREATE TABLE asset_import_log (source TEXT, imported_at TEXT, row_count INTEGER, dated_count INTEGER, imported_by TEXT)');
  const l = db.prepare('INSERT INTO asset_import_log VALUES (?,?,?,?,?)');
  l.run('ad', '2026-07-01', 4805, 4805, 'ops'); l.run('entra', '2026-07-02', 3200, 3100, 'ops');
  db.close();
}

let pg;
test.before(async () => { pg = makePgDb(process.env.PG_URL); await pg.connect(); });
test.after(async () => { if (pg) await pg.close(); });
const count = async (t) => Number((await pg.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).n);
const quiet = () => {};

test('dry-run (default) writes nothing and reports source and target counts', async () => {
  const out = [];
  const r = await tool.run({ module: 'assets', source: src, apply: false, pg, log: (m) => out.push(m) });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.applied, false);
  assert.strictEqual(r.source.asset_memory, 3);
  assert.strictEqual(r.source.assets, null, 'absent source table = null, not 0');
  assert.strictEqual(r.target.asset_memory, 0);
  assert.strictEqual(await count('asset_memory'), 0);
  assert.strictEqual(await count('asset_effort_history'), 0);
  assert.match(out.join('\n'), /dry run — nothing written/);
});

test('the CLI dry-run prints the plan and never PG_URL', () => {
  const env = { ...process.env }; delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, ['--experimental-sqlite', path.join(ROOT, 'tools/pg/copy-legacy-sqlite.js'), '--module', 'assets', '--source', src], { encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /source rows/);
  assert.match(r.stdout, /target rows/);
  assert.match(r.stdout, /asset_memory/);
  assert.ok(!r.stdout.includes(process.env.PG_URL) && !r.stderr.includes(process.env.PG_URL), 'PG_URL never printed');
});

test('--apply copies, skips NULL/empty-PK rows and reports them; the source file is untouched', async () => {
  const before = fs.statSync(src);
  const r = await tool.run({ module: 'assets', source: src, apply: true, pg, log: quiet });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(r.copied.asset_memory, { copied: 1, skipped: 2 });
  assert.deepStrictEqual(r.copied.asset_import_log, { copied: 2, skipped: 0 });
  assert.strictEqual(await count('asset_memory'), 1);
  assert.strictEqual(await count('asset_effort_history'), 2);
  assert.strictEqual(await count('asset_import_log'), 2);
  const after = fs.statSync(src);
  assert.strictEqual(after.size, before.size);
  assert.strictEqual(after.mtimeMs, before.mtimeMs);
});

test('a second --apply is idempotent for PK tables and copies 0 into a non-empty asset_import_log', async () => {
  const r = await tool.run({ module: 'assets', source: src, apply: true, pg, log: quiet });
  assert.strictEqual(r.copied.asset_import_log.copied, 0);
  assert.strictEqual(r.copied.asset_import_log.note, 'target not empty');
  assert.strictEqual(await count('asset_memory'), 1);
  assert.strictEqual(await count('asset_effort_history'), 2);
  assert.strictEqual(await count('asset_import_log'), 2);
});

test('a missing target table: exit 2 with "run db/migrate.js --apply first", nothing written', async () => {
  const schema = 'x_empty_' + process.pid;
  await pg.exec(`CREATE SCHEMA ${schema}`);
  const u = new URL(process.env.PG_URL); u.searchParams.set('options', '-c search_path=' + schema);
  const empty = makePgDb(u.toString()); await empty.connect();
  try {
    const out = [];
    const r = await tool.run({ module: 'assets', source: src, apply: true, pg: empty, log: (m) => out.push(m) });
    assert.strictEqual(r.code, 2);
    assert.match(r.message, /run db\/migrate\.js --apply first/);
  } finally { await empty.close(); await pg.exec(`DROP SCHEMA ${schema} CASCADE`); }
});

test('planCopy flags a target already holding more rows, and an unknown module is refused', async () => {
  const p = tool.planCopy({ asset_memory: 3, assets: null }, { asset_memory: 5, assets: 0 });
  assert.strictEqual(p.find((x) => x.table === 'assets').action, 'absent in source');
  assert.match(p.find((x) => x.table === 'asset_memory').action, /upsert 3/);
  const r = await tool.run({ module: 'tracker', source: src, apply: false, pg, log: quiet });
  assert.strictEqual(r.code, 2);
});

test('_upsertSql: plain INSERT without a PK, ON CONFLICT with one; the irreplaceable tables are in the set', () => {
  assert.strictEqual(tool._upsertSql('t', ['a', 'b'], []), 'INSERT INTO t (a, b) VALUES (?, ?)');
  assert.match(tool._upsertSql('t', ['a', 'b'], ['a']), /ON CONFLICT \(a\) DO UPDATE SET b=EXCLUDED\.b/);
  const names = tool.TABLES.map((t) => t[0]);
  for (const t of ['asset_effort_history', 'asset_reconcile_history', 'asset_reconcile_decisions', 'asset_external_devices', 'asset_import_log', 'asset_first_seen']) assert.ok(names.includes(t), t);
});

test('no better-sqlite3 (or any native SQLite module) comes back into package.json / package-lock.json', () => {
  for (const f of ['package.json', 'package-lock.json']) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) assert.ok(!fs.readFileSync(p, 'utf8').includes('better-sqlite3'), f);
  }
});
