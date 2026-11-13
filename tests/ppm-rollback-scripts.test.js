'use strict';
// W1-INTEGRITY / ARCH-MIG-1 (PPM parity W0, P0) — every PPM / portfolio / roadmap migration has a MANUAL rollback in
// db/postgres_rollback/ (kept outside db/postgres/, the migrator never applies it). Proved on this file's throwaway
// database, in reverse migration order: the rollback applies cleanly and removes something, the forward migration
// re-applies over it, and the schema comes back IDENTICAL (tables, columns, indexes, constraints, triggers).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FWD = path.join(__dirname, '..', 'db', 'postgres', 'reports');
const RB = path.join(__dirname, '..', 'db', 'postgres_rollback');
// 018_governance is NOT here on purpose: it also creates the meeting cadence / session / decision / RFI tables that
// non-PPM features build on (025, 070, 071) — rolling it back is a governance-wide decision, not a PPM one.
const PPM = ['010_roadmap', '011_roadmap_project', '039_native_ppm', '043_portfolio_scope', '044_project_page', '045_ppm_baselines',
  '052_portfolio_soft_delete', '056_portfolio_benefits', '072_ppm_budget_periods', '073_ppm_raci_templates', '080_task_allocation_check',
  '081_benefit_class_and_currency_flag', '085_ppm_workbench', '091_ppm_schedule_engine', '092_ppm_row_version', '093_ppm_evm',
  // P8 / B1 — not PPM, but an additive feature migration that ships its manual rollback and is proved here the same way
  '098_wan_sla_claims',
  // P5 / A3 — Home queue presentation columns (block order, snoozed lines)
  '099_home_queue_prefs'];

async function snapshot(pg) {
  const q = async (sql) => (await pg.prepare(sql).all()).map((r) => Object.values(r).join('|'));
  return [
    ...(await q(`SELECT 'col', table_name, column_name, data_type, is_nullable, COALESCE(column_default,'') FROM information_schema.columns WHERE table_schema = current_schema()`)),
    ...(await q(`SELECT 'idx', tablename, indexname FROM pg_indexes WHERE schemaname = current_schema()`)),
    ...(await q(`SELECT 'con', c.conrelid::regclass::text, c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = current_schema()`)),
    ...(await q(`SELECT 'trg', t.tgrelid::regclass::text, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND NOT t.tgisinternal`)),
  ].sort();
}

test('every PPM / portfolio / roadmap migration has a rollback script, and every rollback points at a real migration', () => {
  for (const m of PPM) {
    assert.ok(fs.existsSync(path.join(FWD, m + '.sql')), `forward ${m}.sql exists`);
    const rb = path.join(RB, m + '_drop.sql');
    assert.ok(fs.existsSync(rb), `rollback ${m}_drop.sql exists`);
    const sql = fs.readFileSync(rb, 'utf8');
    assert.match(sql, new RegExp(`MANUAL rollback of db/postgres/reports/${m}\\.sql`));
    assert.match(sql, new RegExp(`DELETE FROM schema_migrations WHERE id = 'reports/${m}\\.sql'`));
    assert.ok(!/\bCASCADE\b/i.test(sql.replace(/^--.*$/gm, '')), `${m}: no CASCADE — an out-of-order rollback must refuse, not drop a dependant`);
  }
});

test('pg: each rollback applies cleanly in reverse order, removes something, and forward + rollback round-trip exactly', async () => {
  const pg = require('../reports-db').pgHandle();
  const initial = await snapshot(pg);
  for (const m of [...PPM].reverse()) {
    const fwd = fs.readFileSync(path.join(FWD, m + '.sql'), 'utf8');
    const rb = fs.readFileSync(path.join(RB, m + '_drop.sql'), 'utf8');
    const before = await snapshot(pg);
    await pg.exec(rb);
    const rolled = await snapshot(pg);
    assert.notDeepEqual(rolled, before, `${m}: the rollback removed nothing`);
    assert.ok(rolled.every((x) => before.includes(x)), `${m}: the rollback must only remove objects`);
    await pg.exec(fwd);
    assert.deepEqual(await snapshot(pg), before, `${m}: forward re-applied over the rollback rebuilds the same schema`);
    await pg.exec(rb);   // continue the reverse chain
    assert.deepEqual(await snapshot(pg), rolled, `${m}: the rollback is repeatable`);
  }
  // put everything back so nothing else in this process sees a half schema
  for (const m of PPM) await pg.exec(fs.readFileSync(path.join(FWD, m + '.sql'), 'utf8'));
  assert.deepEqual(await snapshot(pg), initial, 'all PPM migrations re-applied = the migrated schema');
});
