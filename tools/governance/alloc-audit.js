'use strict';
// F-PRODUCT-09 (gap E07) — READ-ONLY audit of portfolio_tasks.allocation_pct. Nothing is written.
// Lists the tasks whose allocation is outside 0..100 (legacy rows: the write path refuses them), counts the tasks
// with no allocation (unknown) and at exactly 100 (which may be the column default, not a decision), and says
// whether the CHECK constraint of migration 080 is present. When it is absent it prints the statement a person
// may run AFTER the listed rows are corrected.
//
//   node tools/governance/alloc-audit.js          # human-readable
//   node tools/governance/alloc-audit.js --json   # machine-readable
const path = require('path');
if (require.main === module) require('dotenv').config({ quiet: true, path: path.join(__dirname, '..', '..', '.env') });

const CONSTRAINT = 'portfolio_tasks_allocation_pct_range';
const ADD_SQL = `ALTER TABLE portfolio_tasks ADD CONSTRAINT ${CONSTRAINT} CHECK (allocation_pct IS NULL OR allocation_pct BETWEEN 0 AND 100) NOT VALID;`;

/** @param {{prepare:(sql:string)=>{all:Function,get:Function}}} pg */
async function audit(pg) {
  const rows = await pg.prepare(
    `SELECT t.id, t.project_id, p.key AS project_key, t.name, t.owner, t.status, t.allocation_pct
       FROM portfolio_tasks t LEFT JOIN portfolio_projects p ON p.id = t.project_id
      WHERE t.allocation_pct IS NOT NULL AND (t.allocation_pct < 0 OR t.allocation_pct > 100)
      ORDER BY t.project_id, t.id`).all();
  const c = await pg.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN allocation_pct IS NULL THEN 1 ELSE 0 END) AS unknown,
            SUM(CASE WHEN allocation_pct = 100 THEN 1 ELSE 0 END) AS at_100
       FROM portfolio_tasks`).get();
  const k = await pg.prepare(
    `SELECT convalidated FROM pg_constraint
      WHERE conname = ? AND conrelid = to_regclass(quote_ident(current_schema()) || '.portfolio_tasks')`).get(CONSTRAINT);
  return {
    tasks: Number(c.total || 0), unknown: Number(c.unknown || 0), at_100: Number(c.at_100 || 0),
    out_of_range: rows.map((r) => ({ id: Number(r.id), project_id: Number(r.project_id), project_key: r.project_key || null, name: r.name, owner: r.owner || null, status: r.status, allocation_pct: Number(r.allocation_pct) })),
    constraint: k ? { present: true, validated: !!k.convalidated } : { present: false, validated: false },
    add_constraint_sql: k ? null : ADD_SQL,
  };
}

function format(r) {
  const L = [`[alloc-audit] ${r.tasks} task(s): ${r.unknown} without allocation (unknown), ${r.at_100} at exactly 100 % (may be the column default), ${r.out_of_range.length} outside 0..100`];
  for (const t of r.out_of_range) L.push(`  - task #${t.id} (${t.project_key || 'project #' + t.project_id}) "${t.name}" owner ${t.owner || '(none)'} status ${t.status}: allocation ${t.allocation_pct}`);
  L.push(r.constraint.present ? `[alloc-audit] CHECK ${CONSTRAINT}: present${r.constraint.validated ? ', validated' : ' (NOT VALID: new and edited rows only)'}`
    : `[alloc-audit] CHECK ${CONSTRAINT}: ABSENT${r.out_of_range.length ? ' — correct the rows above first, then a person may run:' : ' — a person may run:'}\n  ${ADD_SQL}`);
  L.push('[alloc-audit] read-only: nothing was changed.');
  return L.join('\n');
}

async function main(argv = process.argv.slice(2), { pg, log = console.log } = {}) {
  const r = await audit(pg);
  log(argv.includes('--json') ? JSON.stringify(r, null, 1) : format(r));
  return r;
}

if (require.main === module) {
  (async () => { const rdb = require('../../reports-db'); await rdb.initPgReports(); await main(undefined, { pg: rdb.pgHandle() }); process.exit(0); })()
    .catch((e) => { console.error('[alloc-audit]', String(e && e.message || e).slice(0, 300)); process.exit(1); });
}

module.exports = { audit, format, main, CONSTRAINT, ADD_SQL };
