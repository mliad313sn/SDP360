'use strict';
// W1-INTEGRITY / A-INT-1 — READ-ONLY report of PPM plan rows that break the integrity rules the write path now
// enforces (services/ppm/planIntegrity.js): a task that is its own parent, a parent loop, a parent from another
// project or that no longer exists, a task depending on its own parent / sub-task, a non-date string in a date field,
// an end before its start (projects, tasks, milestones).
//
//   node tools/pg/ppm-integrity-report.js            human-readable list
//   node tools/pg/ppm-integrity-report.js --json     machine-readable
//
// NOTHING IS WRITTEN (dry run by construction: SELECT only, no flag turns writing on). The rows are corrected by a
// person in the project page; such rows stay readable meanwhile (the reads never fail on them) and stay editable for
// their other fields (the write rules apply only to what a write changes).
const path = require('path');

const { findIntegrityIssues } = require('../../services/ppm/planIntegrity');

/** Read the three tables through a pg-style client ({ query } → { rows }) and list the issues. Live rows only. */
async function collect(client) {
  const q = async (sql) => (await client.query(sql)).rows;
  const projects = await q(`SELECT id, start_date, end_date, baseline_start, baseline_end, forecast_end, actual_start, actual_end FROM portfolio_projects WHERE deleted_at IS NULL ORDER BY id`);
  const tasks = await q(`SELECT id, project_id, parent_id, depends_on, start_date, end_date, baseline_start, baseline_end, forecast_end, actual_start, actual_end FROM portfolio_tasks WHERE deleted_at IS NULL ORDER BY id`);
  const milestones = await q(`SELECT id, project_id, due_date, baseline_date, done_at FROM portfolio_milestones WHERE deleted_at IS NULL ORDER BY id`);
  return { counts: { projects: projects.length, tasks: tasks.length, milestones: milestones.length }, issues: findIntegrityIssues({ projects, tasks, milestones }) };
}

function format(r) {
  const head = `PPM plan integrity — read ${r.counts.projects} project(s), ${r.counts.tasks} task(s), ${r.counts.milestones} milestone(s). Nothing was written.`;
  if (!r.issues.length) return `${head}\nNo row breaks the integrity rules.`;
  return [head, `${r.issues.length} row(s) to correct by hand in the project page:`,
    ...r.issues.map((i) => `  ${i.entity} #${i.id}${i.project_id != null && i.entity !== 'project' ? ` (project #${i.project_id})` : ''} — ${i.code}: ${i.detail}`)].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  if (!process.env.PG_URL) { console.error('PG_URL is not set (.env) — nothing to read.'); process.exitCode = 1; return null; }
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.PG_URL });
  await c.connect();
  try {
    await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const r = await collect(c);
    console.log(argv.includes('--json') ? JSON.stringify(r, null, 2) : format(r));
    return r;
  } finally { await c.end(); }
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
  main().catch((e) => { console.error('[ppm-integrity-report] ' + (e && e.message)); process.exitCode = 1; });
}

module.exports = { collect, format, main };
