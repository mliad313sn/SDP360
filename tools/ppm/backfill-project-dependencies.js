'use strict';
// PORTFOLIO LOT 6 — turn the legacy JSON portfolio_projects.depends_on into structured rows of ppm_project_dependencies
// (migration 130). The JSON itself is NEVER changed or cleared (it stays read-compatible).
//
//   node tools/ppm/backfill-project-dependencies.js              DRY RUN (default): lists the rows it would create, writes nothing
//   node tools/ppm/backfill-project-dependencies.js --dry-run    same
//   node tools/ppm/backfill-project-dependencies.js --apply      writes them (one transaction for all)
//   add --json for machine-readable output
//
// Rules (services/ppm/structuredDependencies.backfillPlan): a number that is a live project id, or a known project key,
// becomes a project dependency; any other text becomes an external dependency of category 'other' carrying the text as
// its description; an entry already present as a structured row is skipped; owner, target date and criticality stay
// unknown (null) — the PMO fills them in. A row that would close a loop between projects is NOT written (reported).
const path = require('path');
const SD = require('../../services/ppm/structuredDependencies');

/** client = pg-style { query } → { rows }. */
async function plan(client) {
  const projects = (await client.query('SELECT id, key, depends_on FROM portfolio_projects WHERE deleted_at IS NULL ORDER BY id')).rows.map((p) => ({ ...p, id: Number(p.id) }));
  const existing = (await client.query('SELECT project_id, predecessor_project_id, description FROM ppm_project_dependencies WHERE deleted_at IS NULL')).rows
    .map((r) => ({ project_id: Number(r.project_id), predecessor_project_id: r.predecessor_project_id == null ? null : Number(r.predecessor_project_id), description: r.description }));
  const edges = existing.filter((e) => e.predecessor_project_id != null).map((e) => ({ from: e.project_id, to: e.predecessor_project_id }));
  return SD.backfillPlan(projects, existing).map((r) => {
    if (r.predecessor_project_id == null) return r;
    if (SD.wouldCreateCycle(edges, r.project_id, r.predecessor_project_id)) return { ...r, skip: 'would create a loop' };
    edges.push({ from: r.project_id, to: r.predecessor_project_id }); return r;
  });
}
async function apply(client) {
  const rows = (await plan(client)); const done = [];
  await client.query('BEGIN');
  try {
    for (const r of rows) {
      if (r.skip) { done.push(r); continue; }
      await client.query('INSERT INTO ppm_project_dependencies (project_id, predecessor_project_id, external_category, description, status, created_by_name, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [r.project_id, r.predecessor_project_id, r.external_category, r.description, 'open', 'backfill (legacy depends_on)', new Date().toISOString()]);
      done.push(r);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  return done;
}
function format(list, applied) {
  const head = applied ? `Structured dependencies written: ${list.filter((r) => !r.skip).length}.` : `DRY RUN — ${list.length} legacy entr(y/ies) to convert; nothing was written (add --apply to write).`;
  return [head, ...list.map((r) => `  project #${r.project_id} → ${r.predecessor_project_id != null ? 'project #' + r.predecessor_project_id : 'external other: ' + r.description}${r.skip ? ' (SKIPPED: ' + r.skip + ')' : ''}`)].join('\n');
}
async function main(argv = process.argv.slice(2)) {
  if (!process.env.PG_URL) { console.error('PG_URL is not set (.env) — nothing to read.'); process.exitCode = 1; return null; }
  const applyMode = argv.includes('--apply') && !argv.includes('--dry-run');
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.PG_URL });
  await c.connect();
  try {
    const list = applyMode ? await apply(c) : await plan(c);
    console.log(argv.includes('--json') ? JSON.stringify({ applied: applyMode, rows: list }, null, 2) : format(list, applyMode));
    return list;
  } finally { await c.end(); }
}
module.exports = { plan, apply, format };
if (require.main === module) {
  require('dotenv').config({ quiet: true, path: path.join(__dirname, '..', '..', '.env') });
  main().catch((e) => { console.error('[backfill-project-dependencies] ' + (e && e.message)); process.exitCode = 1; });
}
