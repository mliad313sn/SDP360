'use strict';
// 2027 Goal 02 — commitments backfill, DRY-RUN by default.
//
//   node tools/pg/commitments-backfill.js            prints the reconciliation report (JSON), writes nothing
//   node tools/pg/commitments-backfill.js --out=report.md   also writes a Markdown reconciliation summary
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
async function pagedAll(fn, pageSize) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = (await fn({ limit: pageSize, offset })) || [];
    out.push(...page);
    if (page.length < pageSize) return out;
    if (offset > 1e6) throw new Error('backfill: more than a million source rows — refusing to continue');
  }
}

async function run(deps, { apply = false, log = () => {}, pageSize = 500 } = {}) {
  const { rdb, mdb, idb, store } = deps;
  const codes = await rdb.listSiteModuleCodes('meetings');
  const siteIdByCode = {}; for (const c of codes || []) siteIdByCode[String(c.code).toUpperCase()] = Number(c.site_id);
  const sites = await rdb.listSites({ includeInactive: true });
  const reportActions = [];
  for (const s of sites || []) {
    const r = await rdb.getSiteOpenReportActions(s.id);
    for (const a of (r && r.actions) || []) reportActions.push({ ...a, site_id: s.id });
  }
  // G-17 — page through the readers: listActions() defaults to LIMIT 1000, so a single call would drop
  // every action beyond the first thousand without saying so.
  const mdActions = await pagedAll((o) => mdb.listActions(o), pageSize);
  const inspActions = await pagedAll((o) => idb.listActions(o), pageSize);
  const all = [...mdActions.map((a) => ['meetings', a.id]), ...inspActions.map((a) => ['inspection', a.id]), ...reportActions.filter((a) => a.uid).map((a) => ['report', a.uid])];
  const linkedMap = await store.linksFor(all.map(([system, id]) => ({ system, id: String(id) })));
  const report = proposeCommitments({ mdActions, inspActions, reportActions, siteIdByCode, linked: new Set(linkedMap.keys()) });
  report.mode = apply ? 'apply' : 'dry-run';
  report.read = { md_actions: mdActions.length, insp_actions: inspActions.length, report_actions: reportActions.length };
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

/** Human-readable reconciliation report (Markdown) for the dry-run evidence file. */
function formatMarkdown(r, { siteNames = {}, generatedAt = new Date().toISOString() } = {}) {
  const L = [];
  L.push(`# Commitments backfill — ${r.mode}`, '', `Generated ${generatedAt}. Nothing in this report was written unless the mode is \`apply\`.`, '');
  L.push('| Source | Rows read |', '|---|---|');
  for (const [k, v] of Object.entries(r.read || {})) L.push(`| ${k} | ${v} |`);
  L.push('', `Proposed: **${r.totals.proposed}** · skipped: ${r.totals.skipped} · likely duplicates: ${r.totals.duplicates} · created: ${r.created}`, '');
  L.push('| Site | Proposed | High / critical | Already linked | Skipped |', '|---|---|---|---|---|');
  for (const [sid, v] of Object.entries(r.per_site || {})) L.push(`| ${siteNames[sid] || sid} | ${v.proposed} | ${v.high_or_critical} | ${v.already_linked} | ${v.skipped} |`);
  const reasons = {}; for (const s of r.skipped || []) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
  if (Object.keys(reasons).length) { L.push('', '| Skip reason | Count |', '|---|---|'); for (const [k, v] of Object.entries(reasons)) L.push(`| ${k} | ${v} |`); }
  const gaps = {}; for (const p of r.proposals || []) for (const g of p.gaps || []) gaps[g] = (gaps[g] || 0) + 1;
  if (Object.keys(gaps).length) { L.push('', 'Fields a site will have to complete before a serious commitment can move:', '', '| Missing field | Proposals |', '|---|---|'); for (const [k, v] of Object.entries(gaps)) L.push(`| ${k} | ${v} |`); }
  L.push('', 'Titles and owners are deliberately not listed here: the JSON output carries them for the operator.');
  return L.join('\n') + '\n';
}

async function main() {
  const apply = process.argv.includes('--apply');
  const outArg = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6);
  const rdb = require('../../reports-db'), mdb = require('../../meetings-db'), idb = require('../../inspection-db');
  await rdb.initPgReports(); await require('../../db/migrate').migrateAtBoot({ log: () => {} });   // 021 tables
  await mdb.initPgMeetings();
  await idb.initPgInspection();
  const store = require('../../routes/commitments').createStore(rdb);
  await store.init();
  const out = await run({ rdb, mdb, idb, store }, { apply, log: console.log });
  if (outArg) {
    const names = {}; for (const st of await rdb.listSites({ includeInactive: true })) names[String(st.id)] = st.name;
    require('fs').writeFileSync(outArg, formatMarkdown(out, { siteNames: names }));
    console.error(`[commitments-backfill] report written to ${outArg}`);
  }
  console.log(JSON.stringify({ mode: out.mode, read: out.read, totals: out.totals, created: out.created, per_site: out.per_site, duplicates: out.duplicates, skipped: out.skipped, proposals: out.proposals }, null, 2));
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error('[commitments-backfill]', e.message); process.exit(1); });
}

module.exports = { run, pagedAll, formatMarkdown };
