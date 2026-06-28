'use strict';
// One-shot orchestrator: copy ALL of reports.db (SQLite) → PostgreSQL in FK-safe order, over a
// SINGLE pg connection. Runs the four phase-copiers in dependency order:
//   auth   → users + sessions + sites      (sites FK'd by users.site_id; created in 001_auth.sql)
//   config → action_departments + audit_log + dashboard_preset_groups + rr_site_aliases
//   reports→ weeks + weekly_reports + infra_kpis + helpdesk_data + lights + action_items
//            + monthly_reports + annual_objectives + site_module_codes + infra_kpi_catalog
//   hot    → request_records + change_records + cab_approvals + survey_results + survey_answers
//            + sync_metadata
// Each phase-copier is idempotent (upsert on PK / Zoho-id) and applies the 001–004 schemas first,
// so re-running is safe. Used at cutover to load prod data into PG before flipping
// REPORTS_BACKEND=postgres. The flip itself is a deploy action (NOT done here).
const fs   = require('fs');
const path = require('path');

const { copyReportsAuth }    = require('./copy-reports-auth');
const { copyReportsConfig }  = require('./copy-reports-config');
const { copyReportsReports } = require('./copy-reports-reports');
const { copyReportsHot }     = require('./copy-reports-hot');

// FK-safe order: auth (sites/users) → config → reports (FK→sites) → hot (no inter-table FKs).
const PHASES = [
  ['auth',    copyReportsAuth],
  ['config',  copyReportsConfig],
  ['reports', copyReportsReports],
  ['hot',     copyReportsHot],
];

async function copyReportsAll(sqlitePath, pg) {
  const result = {};
  for (const [name, fn] of PHASES) {
    const t0 = process.hrtime.bigint();
    const counts = await fn(sqlitePath, pg);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    result[name] = counts;
    console.log(`[copy-reports-all] ${name.padEnd(8)} done in ${ms.toFixed(0)}ms — ${JSON.stringify(counts)}`);
  }
  return result;
}

module.exports = { copyReportsAll, PHASES };

if (require.main === module) {
  (async () => {
    const { makePgDb } = require('../../services/pgDb');
    const url = process.env.PG_URL || process.env.DATABASE_URL;
    if (!url) { console.error('Set PG_URL or DATABASE_URL'); process.exit(2); }
    const src = process.argv[2] || path.join(__dirname, '../../data/reports.db');
    if (!fs.existsSync(src)) { console.error('reports.db not found at ' + src); process.exit(2); }
    const pg = makePgDb(url); await pg.connect();
    try {
      console.log(`[copy-reports-all] source=${src}`);
      const res = await copyReportsAll(src, pg);
      // Grand total row count across every table, for a quick sanity number at cutover.
      const total = Object.values(res).reduce((s, phase) =>
        s + Object.values(phase).reduce((a, n) => a + (Number(n) || 0), 0), 0);
      console.log(`[copy-reports-all] ✅ ALL phases complete — ${total} rows copied total`);
    } finally { await pg.close(); }
  })().catch(e => { console.error(e); process.exit(1); });
}
