'use strict';
// Standalone runs (Task Scheduler, a manual `node tools/reports/...`) must read the app's
// .env BEFORE any *-db module loads: each picks its backend (*_BACKEND) at require time,
// and without it a prod run silently reads the frozen SQLite archives. In-process calls
// (server.js already loaded .env) and tests skip this.
if (require.main === module) require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
// One-shot backfill (2026-09-21): freeze the Parc informatique counts on each site's
// LATEST submitted weekly report that has none yet.
//
// Why: the counts are frozen at the FIRST submission, and the change arrow of a
// week compares with the previous report's frozen counts. Reports submitted before
// the feature went live have no counts, so the following week would show "pas de
// semaine précédente" too. Freezing the latest submitted report now (current state
// of the register, a few days after its week) gives next week a baseline.
//
// Only reports whose review row is missing, has null counts, or predates the
// no_tag key are touched; notes are never written. Dry-run by default.
//
//   node tools/reports/backfill-asset-review.js           # dry-run, prints the plan
//   node tools/reports/backfill-asset-review.js --apply   # writes

function needsBackfill(review) {
  if (!review || review.applicable === false) return !review;
  const c = review.counts;
  return !c || typeof c !== 'object' || c.no_tag === undefined;
}

async function main({ reportsDb, assetsDb, apply = false, log = console.log } = {}) {
  const { labelsForCode } = require('../../services/assetHygieneForSite');
  const { assetLabelToCode } = require('../../services/scoreboardAliases');
  const codes = (await reportsDb.listSiteModuleCodes('meetings')) || [];
  const lookups = (await assetsDb.getAssetLookups()) || {};
  const out = [];
  for (const { site_id, code } of codes) {
    if (!site_id) continue;   // a falsy site_id makes listReports return every site
    const reports = ((await reportsDb.listReports(site_id)) || [])
      .filter(r => r.status === 'submitted')
      .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
    const latest = reports[0];
    if (!latest) { out.push({ code, action: 'skip', reason: 'no submitted report' }); continue; }
    const review = await reportsDb.getReportAssetReview(latest.id);
    if (!needsBackfill(review)) { out.push({ code, report: latest.week_label, action: 'skip', reason: 'already frozen' }); continue; }
    const labels = labelsForCode(lookups.sites, code, assetLabelToCode);
    if (!labels.length) { out.push({ code, report: latest.week_label, action: 'skip', reason: 'no asset label' }); continue; }
    const f = await assetsDb.getSiteAssetFollowups(labels, { newFrom: latest.start_date, newTo: latest.end_date });
    if (apply) await reportsDb.saveReportAssetReview(latest.id, { applicable: true, counts: f.counts }, 'backfill-2026-09-21');
    out.push({ code, report: latest.week_label, action: apply ? 'frozen' : 'would freeze', counts: f.counts });
  }
  for (const r of out) log(`${r.code.padEnd(5)} ${String(r.report || '').padEnd(10)} ${r.action}${r.reason ? ' (' + r.reason + ')' : ''}${r.counts ? ' ' + JSON.stringify(r.counts) : ''}`);
  if (!apply) log('\nDry-run: nothing written. Re-run with --apply to freeze.');
  return out;
}

if (require.main === module) {
  (async () => {
    const reportsDb = require('../../reports-db');
    if ((process.env.REPORTS_BACKEND || 'sqlite').toLowerCase() === 'postgres') await reportsDb.initPgReports();
    const assetsDb = require('../../assets-db');
    if (assetsDb.ASSETS_BACKEND === 'postgres') await assetsDb.initPgAssets();
    const rb = (process.env.REPORTS_BACKEND || 'sqlite').toLowerCase();
    console.log(`[backfill-asset-review] reports backend: ${rb} · assets backend: ${assetsDb.ASSETS_BACKEND}`);
    if (rb !== 'postgres' && !process.argv.includes('--allow-sqlite')) {
      // Prod runs on PostgreSQL; a sqlite run here reads the frozen archive.
      console.error('[backfill-asset-review] refusing: not on PostgreSQL (.env not found?). Run from the app folder, or pass --allow-sqlite on purpose.');
      return 2;
    }
    await main({ reportsDb, assetsDb, apply: process.argv.includes('--apply') });
    return 0;
  })().then(c => process.exit(c)).catch(e => { console.error('[backfill-asset-review] fatal:', e.message); process.exit(1); });
}

module.exports = { main, needsBackfill };
