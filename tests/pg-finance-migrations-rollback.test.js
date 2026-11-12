'use strict';
// A1/B8 — migrations 094 (finance certifications) and 095 (FX rates, display currency, actuals import) are additive
// and reversible: the manual rollback scripts in db/postgres_rollback/ remove exactly their tables, the ledger of
// actuals written to ppm_budget_periods survives, and re-applying the migrations restores the schema.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path');

const TABLES_094 = ['finance_certifications', 'finance_certification_events'];
const TABLES_095 = ['fx_rates', 'user_finance_prefs', 'actuals_import_templates', 'actuals_import_batches'];

test('094/095: applied, rolled back by their scripts (budget periods kept), re-applied by the migrator', async () => {
  const rdb = require('../reports-db'); const db = rdb.pgHandle();
  const exists = async (t) => Number((await db.prepare("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?").get(t)).n) === 1;
  for (const t of [...TABLES_094, ...TABLES_095]) assert.ok(await exists(t), t + ' created by the migrator');
  const ids = ['reports/094_finance_certifications.sql', 'reports/095_fx_rates_actuals_import.sql'];
  const n = await db.prepare(`SELECT COUNT(*) AS n FROM schema_migrations WHERE id IN (?, ?)`).get(...ids);
  assert.equal(Number(n.n), 2, 'both recorded in schema_migrations');
  // the ledger row a commit would have written must survive the rollback
  await db.prepare(`INSERT INTO fx_rates (currency, effective_from, rate, source, entered_at) VALUES ('XOF', '2026-01-01', 0.0016, 'fictitious', 'x')`).run();
  const bp = Number((await db.prepare('SELECT COUNT(*) AS n FROM ppm_budget_periods').get()).n);
  for (const f of ['095_fx_rates_actuals_import_drop.sql', '094_finance_certifications_drop.sql']) await db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'postgres_rollback', f), 'utf8'));
  for (const t of [...TABLES_094, ...TABLES_095]) assert.equal(await exists(t), false, t + ' dropped by the rollback');
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM ppm_budget_periods').get()).n), bp, 'budget periods untouched');
  await db.prepare('DELETE FROM schema_migrations WHERE id IN (?, ?)').run(...ids);
  const r = await require('../db/migrate').migrate(db, { log: () => {} });
  assert.deepEqual(r.applied.filter((x) => ids.includes(x)).sort(), ids, 're-applied');
  for (const t of [...TABLES_094, ...TABLES_095]) assert.ok(await exists(t), t + ' restored');
  // re-applying is idempotent (IF NOT EXISTS everywhere)
  const again = await require('../db/migrate').migrate(db, { log: () => {} });
  assert.equal(again.applied.length, 0);
});
