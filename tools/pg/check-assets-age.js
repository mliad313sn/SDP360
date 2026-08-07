'use strict';
// ── tools/pg/check-assets-age.js ─────────────────────────────────────────────
// READ-ONLY diagnostic: where does the acquisition-date data actually stop?
//
// Run on PROD (ASSETS_BACKEND=postgres) after triggering an assets sync:
//   node tools/pg/check-assets-age.js            (all sites)
//   node tools/pg/check-assets-age.js HOUNDE     (one site, case-insensitive substring)
//
// It answers the question "I filled acquisition dates in SDP but the Progress
// tab's Age % didn't move — is the PG sync broken?" by showing three things:
//   1) per-site acquisition_date FILL RATE in the live PG `assets` table
//      (what the sync last wrote)
//   2) the latest `asset_effort_history` snapshot's age_pct per site
//      (what the Progress tab reads)
//   3) whether the two agree.
//
// Verdict guide:
//   • FILL RATE still 0% after a successful sync  → the AP Analytics `assets`
//     view has NOT propagated your SDP edit yet (upstream, NOT our PG sync).
//   • FILL RATE moved but age_pct snapshot didn't → run a fresh snapshot
//     (POST /api/assets/progress/snapshot, or trigger the assets sync which
//      chains one).
//   • Both moved                                  → it's working; Ctrl+F5.
//
// Never prints PG_URL. Read-only (SELECT only). Loads .env like copy-assets.js.

const path = require('path');
if (!process.env.PG_URL && !process.env.DATABASE_URL) {
  try { require('dotenv').config({ path: path.join(__dirname, '../../.env') }); } catch (_) {}
}
const url = process.env.PG_URL || process.env.DATABASE_URL;
if (!url) { console.error('Set PG_URL or DATABASE_URL (or run where .env has it).'); process.exit(1); }

const filter = (process.argv[2] || '').trim();   // optional site substring

(async () => {
  const { Client } = require('pg');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    // 0) did the last assets sync actually SUCCEED? A per-view failure leaves the
    //    table stale while the chained snapshot still runs on old data → exactly the
    //    "fresh snapshot date + empty dates" symptom.
    const meta = await c.query(`
      SELECT job_name, last_sync_at, last_sync_rows, last_error, last_error_at
        FROM sync_metadata WHERE job_name LIKE 'assets%' ORDER BY job_name`);
    console.log('\n=== SYNC STATUS — sync_metadata (did the assets sync succeed?) ===');
    console.log('job'.padEnd(26), 'last_sync_at'.padStart(21), 'rows'.padStart(6), '  last_error');
    for (const r of meta.rows) {
      console.log(String(r.job_name).padEnd(26),
        String(r.last_sync_at || '—').slice(0, 21).padStart(21),
        String(r.last_sync_rows ?? '—').padStart(6),
        '  ' + (r.last_error ? `⚠ ${String(r.last_error).slice(0, 60)} @ ${String(r.last_error_at || '').slice(0, 19)}` : 'clean'));
    }

    // 1) live assets table: per-site total + acquisition_date AND months_since fill.
    //    months_since_acquisition comes from the SAME view — if it is filled but
    //    acquisition_date is not, the "Acquisition Date" column specifically is the
    //    problem (name/empty in the view); if BOTH are empty, the view is delivering
    //    no acquisition data at all (upstream ETL) — or the sync above failed.
    const like = filter ? `WHERE site ILIKE $1` : '';
    const args = filter ? [`%${filter}%`] : [];
    const fill = await c.query(`
      SELECT COALESCE(site,'(null)') AS site,
             COUNT(*)                                                              AS total,
             COUNT(*) FILTER (WHERE acquisition_date IS NOT NULL
                                AND acquisition_date <> '')                        AS with_date,
             COUNT(*) FILTER (WHERE months_since_acquisition IS NOT NULL
                                AND months_since_acquisition <> '')                AS with_months,
             COUNT(*) FILTER (WHERE purchase_cost IS NOT NULL
                                AND purchase_cost NOT IN ('0.00','0',''))          AS with_cost
        FROM assets ${like}
       GROUP BY 1
       ORDER BY total DESC`, args);

    console.log('\n=== LIVE PG assets — acquisition fill rate (what the last sync wrote) ===');
    console.log('site'.padEnd(24), 'total'.padStart(7), 'w/date'.padStart(8), 'w/months'.padStart(9), 'w/cost'.padStart(8));
    for (const r of fill.rows) {
      const t = Number(r.total), wd = Number(r.with_date), wm = Number(r.with_months), wc = Number(r.with_cost);
      console.log(String(r.site).slice(0, 23).padEnd(24), String(t).padStart(7),
        String(wd).padStart(8), String(wm).padStart(9), String(wc).padStart(8));
    }

    // sample rows — see the actual stored values
    if (filter) {
      const sample = await c.query(`
        SELECT asset_name, acquisition_date, months_since_acquisition, created_time
          FROM assets WHERE site ILIKE $1 ORDER BY asset_name LIMIT 6`, args);
      console.log('\n--- sample rows (stored values) ---');
      for (const r of sample.rows) {
        console.log(String(r.asset_name || '').padEnd(18),
          'acq=' + JSON.stringify(r.acquisition_date), ' months=' + JSON.stringify(r.months_since_acquisition));
      }
    }

    // 2) latest effort snapshot per site (what the Progress tab reads)
    const snap = await c.query(`
      SELECT DISTINCT ON (site) site, snapshot_date, total, no_age, age_pct
        FROM asset_effort_history ${filter ? 'WHERE site ILIKE $1' : ''}
       ORDER BY site, snapshot_date DESC`, args);

    console.log('\n=== LATEST asset_effort_history snapshot — age_pct (what Progress shows) ===');
    console.log('site'.padEnd(24), 'snapshot'.padStart(12), 'total'.padStart(7), 'no_age'.padStart(7), 'age_pct'.padStart(8));
    for (const r of snap.rows) {
      console.log(String(r.site).slice(0, 23).padEnd(24), String(r.snapshot_date).slice(0, 10).padStart(12),
        String(r.total).padStart(7), String(r.no_age).padStart(7),
        (Math.round(Number(r.age_pct) * 100) + '%').padStart(8));
    }

    console.log('\nReading:');
    console.log(' • SYNC STATUS shows ⚠ on assets_assets  → the sync is FAILING; the table is stale');
    console.log('   and the snapshot ran on old data. Fix the sync (see last_error) and re-run it.');
    console.log(' • w/date=0 but w/months>0                → the "Acquisition Date" column specifically');
    console.log('   is empty/renamed in the Analytics VIEW (our side maps it; the view is not giving it).');
    console.log(' • w/date=0 AND w/months=0 (sync clean)   → the Analytics view has no acquisition data');
    console.log('   yet — the ETL from AssetExplorer→Analytics has not refreshed (upstream).');
    console.log(' • w/date>0 but snapshot age_pct=0%       → just run a fresh snapshot.\n');
  } finally {
    await c.end();
  }
})().catch((e) => { console.error('check-assets-age failed:', e.message); process.exit(1); });
