'use strict';
// PORTFOLIO LOT 1 — give the existing projects their permanent id PRJ-{YEAR}-{SEQ} (migration 117).
//
//   node tools/ppm/backfill-project-ids.js              DRY RUN (default): lists the ids it would give, writes nothing
//   node tools/ppm/backfill-project-ids.js --dry-run    same
//   node tools/ppm/backfill-project-ids.js --apply      writes them (one transaction per project)
//   add --json for machine-readable output
//
// Rules (ADR-PORTFOLIO-LOT1 §1):
//   - only projects WITHOUT a project_ref are touched; a given id is never changed (a trigger refuses it anyway);
//   - soft-deleted projects get an id too (an id is independent of deletion);
//   - YEAR = the project's creation year (created_at; the current year when created_at is empty);
//   - order inside a year = created_at, then id — the numbers come from the same counter as new projects
//     (ppm_project_ref_seq), so a backfill and a live creation can never share a number;
//   - the project `key` is kept as it is.
// The ids stay invisible in the application while report_config ppm_intake_register_enabled = '0'.
// The dry run reads the counters to show the numbers it WOULD give; a creation between the dry run and --apply shifts them.
const path = require('path');

const yearOf = (createdAt, now = new Date()) => {
  if (createdAt instanceof Date && !Number.isNaN(createdAt.getTime())) return createdAt.getUTCFullYear();   // TIMESTAMPTZ via node-postgres
  const m = /^(\d{4})-/.exec(String(createdAt || '')); return m ? Number(m[1]) : now.getUTCFullYear();
};
const fmt = (y, n) => `PRJ-${y}-${String(n).padStart(3, '0')}`;

/** Projects to number, in the order they will be numbered. client = pg-style { query } → { rows }. */
async function pending(client) {
  return (await client.query(`SELECT id, key, created_at, deleted_at FROM portfolio_projects WHERE project_ref IS NULL ORDER BY created_at NULLS LAST, id`)).rows
    .map((r) => ({ id: Number(r.id), key: r.key, created_at: r.created_at || null, deleted: !!r.deleted_at, year: yearOf(r.created_at) }));
}

/** DRY RUN: the ids each project would receive. Reads only. */
async function plan(client) {
  const rows = await pending(client);
  const seq = new Map((await client.query('SELECT year, last_n FROM ppm_project_ref_seq')).rows.map((r) => [Number(r.year), Number(r.last_n)]));
  const taken = new Set((await client.query('SELECT project_ref FROM portfolio_projects WHERE project_ref IS NOT NULL')).rows.map((r) => r.project_ref));
  const out = [];
  for (const r of rows) {
    let n = seq.get(r.year) || 0, ref;
    do { n += 1; ref = fmt(r.year, n); } while (taken.has(ref));
    seq.set(r.year, n); taken.add(ref);
    out.push({ ...r, project_ref: ref });
  }
  return out;
}

/** --apply: allocate from the shared counter and set the id, one transaction per project. */
async function apply(client) {
  const rows = await pending(client); const done = [];
  for (const r of rows) {
    await client.query('BEGIN');
    try {
      let ref = null;
      for (let i = 0; i < 1000 && !ref; i++) {
        const n = Number((await client.query('INSERT INTO ppm_project_ref_seq (year, last_n) VALUES ($1, 1) ON CONFLICT (year) DO UPDATE SET last_n = ppm_project_ref_seq.last_n + 1 RETURNING last_n', [r.year])).rows[0].last_n);
        const cand = fmt(r.year, n);
        if (!(await client.query('SELECT 1 FROM portfolio_projects WHERE project_ref = $1', [cand])).rows.length) ref = cand;
      }
      if (!ref) throw new Error('could not allocate an id for project #' + r.id);
      const u = await client.query('UPDATE portfolio_projects SET project_ref = $1 WHERE id = $2 AND project_ref IS NULL', [ref, r.id]);
      await client.query('COMMIT');
      if (u.rowCount === 1) done.push({ ...r, project_ref: ref });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
  }
  return done;
}

function format(list, applied) {
  const head = applied ? `Project ids written: ${list.length}.` : `DRY RUN — ${list.length} project(s) without an id; nothing was written (add --apply to write).`;
  return [head, ...list.map((r) => `  #${r.id} ${r.key || ''}${r.deleted ? ' (soft-deleted)' : ''} → ${r.project_ref}`)].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  if (!process.env.PG_URL) { console.error('PG_URL is not set (.env) — nothing to read.'); process.exitCode = 1; return null; }
  const applyMode = argv.includes('--apply') && !argv.includes('--dry-run');
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.PG_URL });
  await c.connect();
  try {
    const list = applyMode ? await apply(c) : await plan(c);
    console.log(argv.includes('--json') ? JSON.stringify({ applied: applyMode, projects: list }, null, 2) : format(list, applyMode));
    return list;
  } finally { await c.end(); }
}

module.exports = { yearOf, plan, apply, pending, format };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });
  main().catch((e) => { console.error('[backfill-project-ids] ' + (e && e.message)); process.exitCode = 1; });
}
