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
    // 1) live assets table: per-site total + acquisition_date fill rate
    const like = filter ? `WHERE site ILIKE $1` : '';
    const args = filter ? [`%${filter}%`] : [];
    const fill = await c.query(`
      SELECT COALESCE(site,'(null)') AS site,
             COUNT(*)                                                              AS total,
             COUNT(*) FILTER (WHERE acquisition_date IS NOT NULL
                                AND acquisition_date <> '')                        AS with_date,
             COUNT(*) FILTER (WHERE purchase_cost IS NOT NULL
                                AND purchase_cost NOT IN ('0.00','0',''))          AS with_cost
        FROM assets ${like}
       GROUP BY 1
       ORDER BY total DESC`, args);

    console.log('\n=== LIVE PG assets — acquisition_date fill rate (what the last sync wrote) ===');
    console.log('site'.padEnd(24), 'total'.padStart(7), 'w/date'.padStart(8), 'age%'.padStart(6), 'w/cost'.padStart(8));
    for (const r of fill.rows) {
      const t = Number(r.total), wd = Number(r.with_date), wc = Number(r.with_cost);
      const pct = t ? Math.round((wd / t) * 100) : 0;
      console.log(String(r.site).slice(0, 23).padEnd(24), String(t).padStart(7),
        String(wd).padStart(8), (pct + '%').padStart(6), String(wc).padStart(8));
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

    console.log('\nReading: if "w/date" > 0 in the live table but the snapshot age_pct is still 0%,');
    console.log('run a fresh snapshot. If "w/date" is still 0 after a sync, the AP `assets` view');
    console.log('has not propagated your SDP edit — that is upstream of our PG sync.\n');
  } finally {
    await c.end();
  }
})().catch((e) => { console.error('check-assets-age failed:', e.message); process.exit(1); });
