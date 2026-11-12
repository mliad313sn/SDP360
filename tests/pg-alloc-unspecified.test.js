'use strict';
// F-PRODUCT-09 (gap E07) — what a new task stores when allocation_pct is not sent (report_config
// ppm_alloc_unspecified), the CHECK of migration 080, and the read-only audit CLI. Fictitious data only.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'alloc-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin'; process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const AUD = require('../tools/governance/alloc-audit');
let ctx, s, rdb, pj, pg;
const U = { id: 7, username: 'pmo' };
const alloc = async (id) => (await pg.prepare('SELECT allocation_pct FROM portfolio_tasks WHERE id=?').get(id)).allocation_pct;

before(async () => {
  ctx = await provisionTestDb(); if (!ctx) return;
  process.env.PG_URL = ctx.url;
  rdb = require('../reports-db'); await rdb.initPgReports();
  await require('../db/migrate').migrateAtBoot({ log: () => {} });
  pg = rdb.pgHandle();
  const { makeGovernanceStore } = require('../services/governanceStore');
  s = makeGovernanceStore({ prepare: (sql) => pg.prepare(sql), runTransaction: (fn) => pg.runTransaction(fn) }, { isPg: true });
  const pr = await s.upsertPortfolio('programme', { key: 'al-p', name: 'P' }); const ob = await s.upsertPortfolio('objective', { programme_id: pr, key: 'al-o', name: 'O' });
  pj = await s.upsertPortfolio('project', { objective_id: ob, key: 'AL-J', name: 'J', site_id: 1 });
});
after(async () => { if (ctx) await dropTestDb(ctx); });

test("default 'full_time' (today): an omitted allocation takes the column default 100", async (t) => {
  if (!ctx) return t.skip('no pg');
  assert.equal(require('../services/reportConfig').DEFAULTS.ppm_alloc_unspecified, 'full_time');
  assert.equal(Number(await alloc(await s.upsertPortfolio('task', { project_id: pj, name: 'A' }, { user: U }))), 100);
  assert.equal(Number(await alloc(await s.upsertPortfolio('task', { project_id: pj, name: 'A2' }, { user: U, allocUnspecified: 'full_time' }))), 100);
});

test("'unknown': an omitted allocation is stored NULL; a sent value (0, 40, null) is kept as sent; an update never touches it", async (t) => {
  if (!ctx) return t.skip('no pg');
  const o = { user: U, allocUnspecified: 'unknown' };
  const a = await s.upsertPortfolio('task', { project_id: pj, name: 'B' }, o);
  assert.strictEqual(await alloc(a), null);
  assert.equal(Number(await alloc(await s.upsertPortfolio('task', { project_id: pj, name: 'C', allocation_pct: 0 }, o))), 0);
  assert.equal(Number(await alloc(await s.upsertPortfolio('task', { project_id: pj, name: 'D', allocation_pct: 40 }, o))), 40);
  assert.strictEqual(await alloc(await s.upsertPortfolio('task', { project_id: pj, name: 'E', allocation_pct: null }, o)), null);
  const full = await s.upsertPortfolio('task', { project_id: pj, name: 'F' }, { user: U });
  await s.upsertPortfolio('task', { id: full, name: 'F renamed' }, o);
  assert.equal(Number(await alloc(full)), 100, 'no UPDATE of an existing row');
});

test('migration 080: the CHECK is present (NOT VALID) on a clean table and refuses an out-of-range value written around the store', async (t) => {
  if (!ctx) return t.skip('no pg');
  const r = await AUD.audit(pg);
  assert.deepEqual(r.constraint, { present: true, validated: false });
  assert.deepEqual(r.out_of_range, []); assert.strictEqual(r.add_constraint_sql, null);
  assert.ok(r.unknown >= 2 && r.at_100 >= 2);
  await assert.rejects(pg.prepare("INSERT INTO portfolio_tasks (project_id, name, allocation_pct) VALUES (?, 'raw', 150)").run(pj), /portfolio_tasks_allocation_pct_range/);
  await assert.rejects(s.upsertPortfolio('task', { project_id: pj, name: 'G', allocation_pct: 150 }, { user: U }), /0\.\.100/);
});

test('audit CLI: lists legacy out-of-range rows, says the constraint is absent, prints the statement, writes nothing', async (t) => {
  if (!ctx) return t.skip('no pg');
  // a legacy database: no constraint, one row above 100 and one below 0
  await pg.exec(`ALTER TABLE portfolio_tasks DROP CONSTRAINT ${AUD.CONSTRAINT}`);
  await pg.prepare("INSERT INTO portfolio_tasks (project_id, name, owner, allocation_pct) VALUES (?, 'legacy high', 'Ana', 150)").run(pj);
  await pg.prepare("INSERT INTO portfolio_tasks (project_id, name, allocation_pct) VALUES (?, 'legacy low', -50)").run(pj);
  const before = await pg.prepare('SELECT COUNT(*) AS n, SUM(COALESCE(allocation_pct, 0)) AS s FROM portfolio_tasks').get();
  const lines = [];
  const r = await AUD.main([], { pg, log: (l) => lines.push(l) });
  assert.deepEqual(r.out_of_range.map((x) => [x.name, x.allocation_pct, x.project_key]), [['legacy high', 150, 'AL-J'], ['legacy low', -50, 'AL-J']]);
  assert.equal(r.constraint.present, false);
  const out = lines.join('\n');
  assert.match(out, /2 outside 0\.\.100/); assert.match(out, /ABSENT — correct the rows above first/); assert.ok(out.includes(AUD.ADD_SQL)); assert.match(out, /nothing was changed/);
  assert.deepEqual(await pg.prepare('SELECT COUNT(*) AS n, SUM(COALESCE(allocation_pct, 0)) AS s FROM portfolio_tasks').get(), before, 'read-only');
  // migration 080 run over such a table does NOT add the constraint (a legacy row would become uneditable)
  await pg.exec(_fs.readFileSync(_path.join(__dirname, '..', 'db', 'postgres', 'reports', '080_task_allocation_check.sql'), 'utf8'));
  assert.equal((await AUD.audit(pg)).constraint.present, false);
  await s.upsertPortfolio('task', { id: r.out_of_range[0].id, name: 'legacy high (renamed)' }, { user: U });   // the legacy row stays editable
  // once the rows are corrected the same migration adds it
  await pg.exec('UPDATE portfolio_tasks SET allocation_pct = NULL WHERE allocation_pct < 0 OR allocation_pct > 100');
  await pg.exec(_fs.readFileSync(_path.join(__dirname, '..', 'db', 'postgres', 'reports', '080_task_allocation_check.sql'), 'utf8'));
  assert.equal((await AUD.audit(pg)).constraint.present, true);
  const j = []; await AUD.main(['--json'], { pg, log: (l) => j.push(l) });
  assert.equal(JSON.parse(j[0]).constraint.present, true);
});

test('wiring: the routes pass the setting, the CLI is guarded and loads .env first', () => {
  const read = (f) => _fs.readFileSync(_path.join(__dirname, '..', f), 'utf8');
  assert.match(read('routes/governance.js'), /allocUnspecified: cfgW\.ppm_alloc_unspecified/);
  assert.match(read('routes/governancePpm.js'), /allocUnspecified: \(await cfg\(\)\)\.ppm_alloc_unspecified/);
  const cli = read('tools/governance/alloc-audit.js');
  assert.ok(cli.indexOf("require('dotenv')") < cli.indexOf("require('../../reports-db')"));
  assert.match(cli, /require\.main === module/);
  assert.doesNotMatch(cli, /\b(UPDATE|DELETE|INSERT)\b/, 'the audit never writes');
});
