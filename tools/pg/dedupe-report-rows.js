'use strict';
// Find (and optionally repair) weekly reports whose section rows were DOUBLED by the
// concurrent-save race fixed on 2026-09-11 (two DELETE+INSERT saves under READ COMMITTED →
// every infra_kpis / lights row twice, both sets carrying sort_order 0..N). The writers now
// lock the report row, so this is a one-off clean-up of rows written BEFORE the fix.
//
// Detection: a report where the same sort_order appears more than once in a section table.
// Repair (per report, per section): keep the set with the HIGHEST id per sort_order (the
// later save = the one the coordinator saw when they clicked Save), delete the rest.
//
//   node tools/pg/dedupe-report-rows.js            → dry run: lists the affected reports
//   node tools/pg/dedupe-report-rows.js --apply    → deletes the older duplicates (one tx)
//
// Reads PG_URL from the environment (or .env in the app root). Never touches action_items:
// its rows are keyed by uid and a doubled follow-up may have been edited since — review
// those by hand in the report editor (✕ on the duplicate, then Save once).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { Client } = require('pg');
const APPLY = process.argv.includes('--apply');
const TABLES = ['infra_kpis', 'lights'];

(async () => {
  if (!process.env.PG_URL) { console.error('PG_URL not set'); process.exit(2); }
  const c = new Client({ connectionString: process.env.PG_URL });
  await c.connect();
  try {
    let total = 0;
    const plan = [];
    for (const t of TABLES) {
      const key = t === 'lights' ? 'type, sort_order' : 'sort_order';
      const xkey = key.split(', ').map(k => 'x.' + k).join(', ');   // sites has a sort_order too → qualify
      const dup = await c.query(`
        SELECT x.report_id, s.name AS site, w.label AS week, COUNT(*)::int AS rows,
               COUNT(DISTINCT (${xkey}))::int AS distinct_keys
        FROM ${t} x
        JOIN weekly_reports r ON r.id = x.report_id
        JOIN sites s ON s.id = r.site_id
        JOIN weeks w ON w.id = r.week_id
        GROUP BY x.report_id, s.name, w.label
        HAVING COUNT(*) > COUNT(DISTINCT (${xkey}))
        ORDER BY s.name, w.label`);
      for (const r of dup.rows) {
        console.log(`${t.padEnd(11)} report ${r.report_id}  ${r.site} ${r.week}: ${r.rows} rows for ${r.distinct_keys} keys → ${r.rows - r.distinct_keys} to delete`);
        plan.push({ t, key, report_id: r.report_id, extra: r.rows - r.distinct_keys });
        total += r.rows - r.distinct_keys;
      }
    }
    if (!plan.length) { console.log('No doubled section rows found.'); return; }
    console.log(`\n${plan.length} report/section pair(s), ${total} duplicate row(s).`);
    if (!APPLY) { console.log('Dry run — re-run with --apply to delete the OLDER copies (highest id per key is kept).'); return; }
    await c.query('BEGIN');
    let deleted = 0;
    for (const p of plan) {
      const r = await c.query(`
        DELETE FROM ${p.t} x
        USING (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY ${p.key} ORDER BY id DESC) AS rn
          FROM ${p.t} WHERE report_id = $1
        ) d
        WHERE x.id = d.id AND d.rn > 1`, [p.report_id]);
      deleted += r.rowCount;
    }
    await c.query('COMMIT');
    console.log(`Deleted ${deleted} row(s). Regenerate the affected decks; the editor now shows one row per KPI.`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('FAILED:', e.message); process.exit(1);
  } finally { await c.end(); }
})();
