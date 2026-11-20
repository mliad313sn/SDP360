'use strict';
// P11 r5 N-13 — 38 of the 39 manual rollback scripts in db/postgres_rollback/ ran as separate statements. Run with
// `psql -f` (the only form the docs show), a statement failing halfway left the schema HALF rolled back: rollback 125
// dropped the gate_to CHECK, failed to re-add it (a checklist used an extended stage), then still dropped
// created_by / updated_by — while its header promised "fails (and changes nothing)". Every rollback script is now one
// transaction (BEGIN … COMMIT): psql turns the COMMIT of an aborted transaction into a ROLLBACK, so a failure changes
// nothing, with or without -v ON_ERROR_STOP=1.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RB = path.join(__dirname, '..', 'db', 'postgres_rollback');
const SCRIPTS = fs.readdirSync(RB).filter((f) => f.endsWith('.sql')).sort();

function statements(sql) {
  return sql.replace(/\r\n/g, '\n').replace(/^\s*--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
}

test('every rollback script is ONE transaction: BEGIN first, COMMIT last, no other transaction control', () => {
  assert.ok(SCRIPTS.length >= 39, `found ${SCRIPTS.length} rollback scripts`);
  for (const f of SCRIPTS) {
    const st = statements(fs.readFileSync(path.join(RB, f), 'utf8'));
    assert.match(st[0], /^BEGIN$/i, `${f}: first statement is BEGIN`);
    assert.match(st[st.length - 1], /^COMMIT$/i, `${f}: last statement is COMMIT`);
    const inner = st.slice(1, -1);
    assert.ok(inner.length > 0, `${f}: does something`);
    for (const s of inner) {
      assert.ok(!/^(BEGIN|COMMIT|ROLLBACK|END|START\s+TRANSACTION)\b/i.test(s), `${f}: no nested transaction control (${s})`);
      assert.ok(!/\bCONCURRENTLY\b|^VACUUM\b/i.test(s), `${f}: nothing that cannot run inside a transaction (${s})`);
    }
  }
});

function pgUrl() { return process.env.PG_URL || process.env.DATABASE_URL; }
function psql(file) {
  return spawnSync('psql', ['-X', '-q', pgUrl(), '-f', file], { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '--client-min-messages=warning' } });
}

async function shape(pg) {
  const cols = (await pg.prepare(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'portfolio_projects' AND column_name IN ('created_by','updated_by') ORDER BY 1`).all()).map((r) => r.column_name);
  const con = await pg.prepare(`SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = current_schema() AND c.conname = 'ppm_gate_checklists_gate_to_check'`).get();
  return { cols, check: con ? con.def : null };
}

test('pg + psql -f: rollback 125 with an extended-stage checklist FAILS and changes NOTHING', async (t) => {
  if (spawnSync('psql', ['--version']).status !== 0) { t.skip('psql not installed'); return; }
  if (/search_path|options=/i.test(pgUrl() || '')) { t.skip('schema-fallback test database: psql would not see the same schema'); return; }
  const pg = require('../reports-db').pgHandle();
  const prog = await pg.prepare(`INSERT INTO portfolio_programmes (key, name) VALUES ('RB125-P', 'rb125') RETURNING id`).get();
  const obj = await pg.prepare(`INSERT INTO portfolio_objectives (programme_id, key, name) VALUES (?, 'RB125-O', 'rb125') RETURNING id`).get(prog.id);
  const proj = await pg.prepare(`INSERT INTO portfolio_projects (objective_id, key, name) VALUES (?, 'RB125-J', 'rb125') RETURNING id`).get(obj.id);
  await pg.prepare(`INSERT INTO ppm_gate_checklists (project_id, gate_to, definition_json, defined_at) VALUES (?, 'idea', '{}', '2026-11-20')`).run(proj.id);
  const migBefore = (await pg.prepare(`SELECT COUNT(*)::int AS n FROM schema_migrations WHERE id = 'reports/125_ppm_lifecycle_audit.sql'`).get()).n;
  const before = await shape(pg);
  assert.deepEqual(before.cols, ['created_by', 'updated_by']);
  assert.ok(before.check && /idea/.test(before.check), 'the extended CHECK is in place before');

  const r = psql(path.join(RB, '125_ppm_lifecycle_audit_drop.sql'));
  assert.match(r.stderr, /violated by some row|check constraint/i, 'the rollback fails on the extended-stage checklist');

  const after = await shape(pg);
  assert.deepEqual(after, before, 'schema unchanged: CHECK still there, created_by / updated_by still there');
  const migAfter = (await pg.prepare(`SELECT COUNT(*)::int AS n FROM schema_migrations WHERE id = 'reports/125_ppm_lifecycle_audit.sql'`).get()).n;
  assert.equal(migAfter, migBefore, 'the migration journal is untouched');

  // and once the offending checklist is gone, the same script rolls back completely
  await pg.prepare(`DELETE FROM ppm_gate_checklists WHERE project_id = ?`).run(proj.id);
  const ok = psql(path.join(RB, '125_ppm_lifecycle_audit_drop.sql'));
  assert.equal(ok.status, 0, ok.stderr);
  const rolled = await shape(pg);
  assert.deepEqual(rolled.cols, []);
  assert.ok(rolled.check && !/idea/.test(rolled.check), 'the narrow CHECK is back');
  // restore the forward migration for the rest of the process
  await pg.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'postgres', 'reports', '125_ppm_lifecycle_audit.sql'), 'utf8'));
  assert.deepEqual((await shape(pg)).cols, ['created_by', 'updated_by']);
});
