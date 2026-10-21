'use strict';
// 2027 Goal 02 — commitments backfill, DRY-RUN by default.
//
//   node tools/pg/commitments-backfill.js            prints the reconciliation report (JSON), writes nothing
//   node tools/pg/commitments-backfill.js --apply    creates `captured` commitments linked to their source
//
// Proposals come from open md_actions, insp_actions (high / critical first) and report follow-ups
// (action_items). Source records are NEVER edited or deleted; a proposal whose source is already
// linked is skipped (idempotent: a second --apply creates nothing). Pure core:
// services/commitmentBackfill.proposeCommitments.
//
// .env FIRST — every *-db module picks its backend at require time (CLAUDE.md pitfall).
const path = require('path');
if (require.main === module) require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { proposeCommitments } = require('../../services/commitmentBackfill');

/** deps: { rdb, mdb, idb, store }  — store = services/commitmentStore instance. */
async function run(deps, { apply = false, log = () => {} } = {}) {
  const { rdb, mdb, idb, store } = deps;
  const codes = await rdb.listSiteModuleCodes('meetings');
  const siteIdByCode = {}; for (const c of codes || []) siteIdByCode[String(c.code).toUpperCase()] = Number(c.site_id);
  const sites = await rdb.listSites({ includeInactive: true });
  const reportActions = [];
  for (const s of sites || []) {
    const r = await rdb.getSiteOpenReportActions(s.id);
    for (const a of (r && r.actions) || []) reportActions.push({ ...a, site_id: s.id });
  }
  const mdActions = await mdb.listActions({});
  const inspActions = await idb.listActions({});
  const all = [...mdActions.map((a) => ['meetings', a.id]), ...inspActions.map((a) => ['inspection', a.id]), ...reportActions.filter((a) => a.uid).map((a) => ['report', a.uid])];
  const linkedMap = await store.linksFor(all.map(([system, id]) => ({ system, id: String(id) })));
  const report = proposeCommitments({ mdActions, inspActions, reportActions, siteIdByCode, linked: new Set(linkedMap.keys()) });
  report.mode = apply ? 'apply' : 'dry-run';
  report.created = 0;
  if (apply) {
    for (const p of report.proposals) {
      const r = await store.create({ kind: p.kind, title: p.title, site_id: p.site_id, severity: p.severity, accountable_owner: p.accountable_owner, due_date: p.due_date, source: p.source },
        { user: { username: 'backfill' } });
      if (r.created) report.created++;
    }
    log(`[commitments-backfill] created ${report.created}`);
  }
  return report;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const rdb = require('../../reports-db'), mdb = require('../../meetings-db'), idb = require('../../inspection-db');
  if (rdb.REPORTS_BACKEND === 'postgres') { await rdb.initPgReports(); await require('../../db/migrate').migrateAtBoot({ log: () => {} }); }   // 021 tables
  if (mdb.MEETINGS_BACKEND === 'postgres') await mdb.initPgMeetings();
  if (idb.INSPECTION_BACKEND === 'postgres') await idb.initPgInspection();
  const store = require('../../routes/commitments').createStore(rdb);
  await store.init();
  const out = await run({ rdb, mdb, idb, store }, { apply, log: console.log });
  console.log(JSON.stringify({ mode: out.mode, totals: out.totals, created: out.created, per_site: out.per_site, duplicates: out.duplicates, skipped: out.skipped, proposals: out.proposals }, null, 2));
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error('[commitments-backfill]', e.message); process.exit(1); });
}

module.exports = { run };
