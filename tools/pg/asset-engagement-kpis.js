'use strict';
// G-07 (audit 2026-09-24) — READ-ONLY asset-engagement KPI baseline.
//
// The audit's T0 numbers came from ad-hoc SQL, so the 30-day re-measure the engine asks
// for would not have been comparable. This prints the same figures the same way, every
// time, so two runs can be diffed line by line.
//
//   node tools/pg/asset-engagement-kpis.js
//
// Nothing is written. The worklist predicates are REUSED from assets-db (exported
// constants) rather than re-typed — a KPI that drifts from what the module shows is
// worse than no KPI.
//
// .env FIRST: every *-db module picks its backend at require time and only server.js
// loads dotenv, so a standalone run without this line reads the frozen SQLite archives
// (the trap that made the September backfill dry-run report July weeks).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { formatKpiReport, effortDelta } = require('../../services/assetEngagementKpis');
const {
  FOLLOWUP_ACTIVE_STATES, FOLLOWUP_NO_TAG, FOLLOWUP_NO_DATE, FOLLOWUP_NO_COST, FOLLOWUP_UNASSIGNED,
} = require('../../assets-db');

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };

// snapshot_date and system_log.ts are TEXT. Postgres refuses `text <= date`, so every
// window bound is computed here as a YYYY-MM-DD string and compared text-to-text —
// the same rule the readers follow (no ::date on a TEXT column).
const minusDays = (day, n) => {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

async function main() {
  if (!process.env.PG_URL) {
    console.error('PG_URL absent du .env — impossible de mesurer.');
    process.exitCode = 1;
    return;
  }
  const asOf = arg('as-of', new Date().toISOString().slice(0, 10));
  const cutoff = minusDays(asOf, 30);
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.PG_URL });
  await c.connect();
  try {
    // Per-site worklists. The four predicates are the module's own, interpolated
    // verbatim — no parameters, no user input reaches this SQL.
    const sites = (await c.query(`
      SELECT COALESCE(NULLIF(TRIM(site), ''), '(sans site)') AS site,
             COUNT(*) FILTER (WHERE ${FOLLOWUP_ACTIVE_STATES}) AS active,
             COUNT(*) FILTER (WHERE ${FOLLOWUP_NO_TAG})        AS no_tag,
             COUNT(*) FILTER (WHERE ${FOLLOWUP_NO_DATE})       AS no_date,
             COUNT(*) FILTER (WHERE ${FOLLOWUP_NO_COST})       AS no_cost,
             COUNT(*) FILTER (WHERE ${FOLLOWUP_UNASSIGNED})    AS no_user
        FROM assets GROUP BY 1 HAVING COUNT(*) FILTER (WHERE ${FOLLOWUP_ACTIVE_STATES}) > 0
       ORDER BY 2 DESC`)).rows.map(r => ({
      site: r.site,
      active: Number(r.active), no_tag: Number(r.no_tag), no_date: Number(r.no_date),
      no_cost: Number(r.no_cost), no_user: Number(r.no_user),
    }));

    // Effort: the latest snapshot per site, and the ~30-day-lookback baseline — the same
    // rule the Progress leaderboard applies (nearest snapshot on/before asOf-30d; no
    // comparable snapshot → null, never 0).
    const eff = (await c.query(`
      SELECT h.site, h.snapshot_date, h.effort_score
        FROM asset_effort_history h
        JOIN (SELECT site, MAX(snapshot_date) d FROM asset_effort_history
               WHERE snapshot_date <= $1 GROUP BY site) m
          ON m.site = h.site AND m.d = h.snapshot_date
       ORDER BY h.effort_score DESC, h.site`, [asOf])).rows;
    const base = (await c.query(`
      SELECT DISTINCT ON (site) site, snapshot_date, effort_score
        FROM asset_effort_history
       WHERE snapshot_date <= $1
       ORDER BY site, snapshot_date DESC`, [cutoff])).rows;
    const baseBySite = new Map(base.map(r => [r.site, { date: r.snapshot_date, score: Number(r.effort_score) }]));
    const bySite = new Map(sites.map(s => [s.site, s.active]));
    const effort = eff.map((r, i) => {
      const score = Number(r.effort_score);
      return {
        site: r.site, effort_score: score, rank: i + 1,
        delta: effortDelta({ date: r.snapshot_date, score }, baseBySite.get(r.site) || null),
        active: bySite.has(r.site) ? bySite.get(r.site) : null,
      };
    });

    // Usage — G-06's events. Absent table/rows → null ("non mesuré"), never 0.
    let engagement = {};
    try {
      const u = (await c.query(`
        SELECT COUNT(DISTINCT actor) FILTER (WHERE action = 'assets_viewed') AS viewers,
               COUNT(*)              FILTER (WHERE action = 'asset_export')  AS exports
          FROM system_log
         WHERE substr(ts, 1, 10) >= $1`, [cutoff])).rows[0];
      engagement = { viewers_30d: Number(u.viewers), exports_30d: Number(u.exports) };
    } catch (e) { engagement = {}; }

    let last_sync = null;
    try {
      const r = (await c.query(`SELECT last_sync_at FROM sync_metadata WHERE job_name = 'assets_assets'`)).rows[0];
      last_sync = r ? r.last_sync_at : null;
    } catch (e) { last_sync = null; }

    console.log(formatKpiReport({ as_of: asOf, last_sync, sites, effort, engagement }));
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('[asset-engagement-kpis]', e.message); process.exitCode = 1; });
}

module.exports = { main };
