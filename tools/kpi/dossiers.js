'use strict';
// P08 §1 — one committee dossier per KPI shown to executives. The registry fields (name, formula, window, RAG
// policy, source reader, owner role, certification) are read from services/metricRegistry.js; freshness from the
// sync job declarations; the worked example runs the PRODUCTION RAG function (metricRegistry.ragFor) on a
// FICTITIOUS numerator / denominator. The committee fields this tool cannot know (owner, threshold approval,
// definition approval) are printed as "to be decided" — never filled.
//
//   node tools/kpi/dossiers.js           writes docs/agent-execution/P08-kpi-dossiers.md
//   node tools/kpi/dossiers.js --check   exits 1 when the committed file is stale
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'agent-execution', 'P08-kpi-dossiers.md');

// Surfaces an executive reads: the seeded executive home + committee view, plus the disputed figures.
function executiveKeys() {
  const S = require('../../services/dashboardSeeds');
  const keys = new Set();
  for (const d of [S.EXEC_HOME, ...S.SEED_DASHBOARDS.filter((x) => x.audience === 'committee' || x.audience === 'executive')]) for (const w of d.widgets || []) for (const k of [w.metric].concat(w.series || [])) if (k) keys.add(k);
  for (const k of ['helpdesk.first_reply_sla_pct', 'helpdesk.closure_pct', 'programme.composite', 'changes.success_pct_deck', 'changes.success_pct_itsm']) keys.add(k);
  return [...keys];
}

// What the registry does not carry: numerator / denominator / exclusions / aggregation, and the fictitious example.
// Each line is a description of TODAY's code (file named), not a proposal.
const D = {
  'helpdesk.resolution_sla_pct': { num: 'closed tickets of the month NOT flagged overdue', den: 'closed tickets of the month carrying an SLA rule (cancelled excluded) — `sla_res_den`', excl: 'open tickets (closed-only doctrine); cancelled; tickets without an SLA rule; groups outside the site\'s Zoho groups (scope = tech_group, never request_records.site)', agg: 'per site from reports-db.getCalendarMonthlyHelpdesk; a fleet comparator on a dashboard is the UNWEIGHTED MEAN of site percentages (services/dashboardData.js `unweighted_site_mean`) — a mean of percentages', ex: [45, 50], disputes: 'what "missed" means (stored Zoho flag vs resolved-after-due — `helpdesk_sla_definition`); closed-only vs incl. open & breached (A7, `sla_headline_definition`)' },
  'helpdesk.first_reply_sla_pct': { num: 'responded tickets whose first response was not violated', den: 'responded tickets of the month — `sla_reply_den`', excl: 'tickets not yet responded; groups outside the site\'s Zoho groups', agg: 'per site; fleet comparator = unweighted mean of site percentages', ex: [38, 40], disputes: 'target 80 % for the deck (CLAUDE.md 2026-07-08) vs the generic `sla-percent` policy — no committee record' },
  'helpdesk.closure_pct': { num: 'tickets created in the month and closed', den: 'tickets created in the month (`inbound`)', excl: 'tickets created in another month', agg: 'per site; fleet comparator = unweighted mean; /api/metrics/:key/explain decomposes numerator and denominator', ex: [30, 40], disputes: 'none recorded' },
  'helpdesk.window_major_incidents': { num: 'major incidents created in the window (template / request type)', den: 'not a ratio', excl: 'incidents created outside the window (open ones are a different population)', agg: 'per-site count; a group figure is a sum', ex: [2, null], disputes: 'month-raised vs open-now are two populations shown side by side on the site report' },
  'helpdesk.window_overdue': { num: 'tickets created in the window with the overdue flag set', den: 'not a ratio', excl: 'tickets created outside the window', agg: 'per-site count; group = sum', ex: [7, null], disputes: 'same "missed" definition question as the resolution SLA' },
  'inspection.conformity_pct': { num: 'findings OK', den: 'applicable findings (ok + minor + major + critical + opportunity) — `applicable_n`', excl: 'N/A findings; inspections outside the window', agg: 'per site; fleet comparator = unweighted mean of site percentages', ex: [44, 52], disputes: 'none recorded' },
  'meetings.engagement_score': { num: 'mean of the non-null engagement scores E1, E2, E3, E5', den: 'number of non-null engagement scores (E4 excluded — no outbound-communication log)', excl: 'E4; engagements with no data', agg: 'per site from meetings-db.insights; the score is itself a mean of percentages', ex: null, inputs: { e1: 100, e2: 50, e3: 75, e5: null }, disputes: 'E4 absent from the formula; the RAG thresholds 80/60 come from the module, not a committee record' },
  'tracker.site_score_pct': { dp: 0, num: 'Σ effective weight × attainment (capped 1.0) over active activities', den: 'Σ effective weights of active activities', excl: 'inactive activities; activities outside their month window', agg: 'per site', ex: [0.55, 1], ratioScale: true, disputes: 'RAG band GREEN ≥ 90 % of pro-rated target (frozen change, CLAUDE.md 2026-09-04) — policy `tracker-executive`' },
  'tracker.fleet_score_pct': { dp: 0, num: 'sum of site scores', den: 'number of active sites', excl: 'inactive sites', agg: 'MEAN OF SITE PERCENTAGES (tracker-pptx.fleetStats) — one site = one vote whatever its activity count', ex: [0.22, 1], ratioScale: true, disputes: 'D-03 — tracker fleet (this) vs Roadmap Manager weighted objectives' },
  'tracker.fleet_attainment_pct': { dp: 0, num: 'GREEN activities across active sites', den: 'scored activities (GREEN + AMBER + RED) across active sites', excl: 'unscored activities', agg: 'pooled ratio Σ GREEN ÷ Σ scored (not a mean of site percentages)', ex: [18, 31], disputes: 'the donut was later changed to weight-based attainment (frozen e17b7b7) — two definitions of "attainment" exist' },
  'programme.site_score': { num: 'points earned over 6 dimensions (0/1/2 each)', den: '12 points', excl: 'a site with no data on the window is "non applicable" (null), never RED 33', agg: 'per site; fleet = mean of site scores', ex: null, inputs: 'see side-by-side FX-A/B/C', disputes: 'D-01/D-02 — vs the operational composite' },
  'programme.composite': { num: 'Σ weight × dimension value over present dimensions', den: 'Σ weights of present dimensions (renormalised)', excl: 'absent dimensions (coverage N/4 stated)', agg: 'per site; fleet = mean of applicable site scores', ex: null, inputs: 'see side-by-side FX-A/B/C', disputes: 'D-02 — vs the programme score' },
  'changes.success_pct_deck': { dp: 0, num: 'successful changes', den: 'successful + partial + failed + backed out + CANCELLED', excl: 'pending (no outcome)', agg: 'per site over 90 days (group = the site\'s change groups)', ex: [7, 14], disputes: 'D-01' },
  'changes.success_pct_itsm': { dp: 0, num: 'successful changes', den: 'successful + partial + failed + backed out (cancelled excluded)', excl: 'pending; cancelled', agg: 'per site over 90 days', ex: [7, 11], disputes: 'D-01' },
};

function build() {
  const MR = require('../../services/metricRegistry');
  const KpiRag = require('../../services/kpiRag');
  const { FRESHNESS_HOURS } = require('../../services/sync/jobs');
  const { FRESHNESS_SOURCES } = require('../../services/governancePolicy');
  const SBS = require('./side-by-side');
  const jobOf = new Map(FRESHNESS_SOURCES);
  const keys = executiveKeys();
  const c = (v) => String(v == null || v === '' ? '—' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const L = [
    '# P08 — KPI committee dossier set (executive KPIs)', '',
    'Generated by `node tools/kpi/dossiers.js` (`--check` in tests/kpi-dossiers.test.js). Prepared by an AI agent (Claude) — this is **not** an independent review and **approves nothing**.',
    'Every "to be decided" cell is a human field: owner, definition approval, threshold approval. Worked examples use FICTITIOUS figures through the production RAG function.', '',
    `Executive KPIs covered: **${keys.length}** (seeded executive home + committee views + the disputed figures). The full dictionary (every registered metric, consumers, freshness) is docs/ops/METRIC-LINEAGE.md.`, '',
    '## Disputed definitions — both results on the same fictitious data', '', 'Produced by `node tools/kpi/side-by-side.js`, pinned by tests/kpi-side-by-side.test.js. No choice is made here.', '',
    SBS.markdown(SBS.run()), '',
  ];
  for (const k of keys) {
    const m = MR.SEED.find((x) => x.key === k); const d = D[k] || {};
    if (!m) { L.push(`## \`${k}\``, '', '_Not in the dictionary — cannot be certified until registered._', ''); continue; }
    const pol = m.rag_policy ? KpiRag.POLICIES[m.rag_policy] : null;
    const job = jobOf.get(m.module);
    let example = '—';
    if (d.ex && d.ex[1] != null) {
      const dp = d.dp == null ? 1 : d.dp; const f = Math.pow(10, dp); const v = Math.round(100 * f * d.ex[0] / d.ex[1]) / f;   // same rounding as the reader
      example = `FICTITIOUS: numerator ${d.ex[0]}, denominator ${d.ex[1]} → **${v} ${m.unit}** → RAG **${MR.ragFor(m, v)}**${pol ? ` (policy \`${m.rag_policy}\`)` : ''}; denominator 0 → **null** (shown "—", no colour)`;
    } else if (d.ex) example = `FICTITIOUS: ${d.ex[0]} rows in the window → **${d.ex[0]}** (no colour: count); no source / site without the module → **null**`;
    else if (d.inputs && typeof d.inputs === 'object') { const vals = Object.values(d.inputs).filter((x) => x != null); const v = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length); example = `FICTITIOUS: ${JSON.stringify(d.inputs)} → mean of non-null = **${v} %** → RAG **${MR.ragFor(m, v)}**; all null → **null**`; }
    else if (d.inputs) example = d.inputs;
    L.push(`## \`${k}\` — ${m.name}`, '', '| Field | Value |', '|---|---|',
      `| Definition (registry wording) | ${c(m.formula)} |`,
      `| Numerator | ${c(d.num)} |`, `| Denominator | ${c(d.den)} |`, `| Exclusions | ${c(d.excl)} |`,
      `| Source and job | reader \`${m.reader}\` · field \`${m.field}\` · ${c(m.source)} · sync job ${job ? `\`${job}\`` : 'none (typed into the application)'} |`,
      `| Freshness window | ${job && FRESHNESS_HOURS[job] ? FRESHNESS_HOURS[job] + ' h (colour withdrawn when stale)' : 'not tracked (no sync job) — NO_SYNC_JOB on exports'} · window kind \`${m.window_kind}\` |`,
      `| Aggregation across sites | ${c(d.agg)} |`,
      `| RAG policy and origin | ${pol ? `\`${m.rag_policy}\` — scale ${pol.scale}, green ${pol.green}, amber ${pol.amber}; origin: ${c(pol.source || 'code default (public/lib/kpiRag.js)')}; **threshold approval: to be decided (KPI committee)**` : 'none (no colour)'} |`,
      `| Owner role | ${m.owner_role ? c(m.owner_role) + ' (code default — to be confirmed by the committee)' : '**to be decided** (nobody named)'} |`,
      `| Status / certification | ${c(m.status)} · ${c(m.certification)} |`,
      `| Open disputes | ${c(d.disputes || 'none recorded')} |`,
      `| Worked example | ${example} |`,
      `| Parity proof | tests/figure-parity-all-kpis.test.js (8 surfaces)${/^changes\./.test(k) ? ' — draft: never leaves the platform (ext API refuses drafts); parity of the classifier in tests/kpi-change-parity.test.js' : ''} |`, '');
  }
  L.push('## Calculation paths (P08 §3 — one path per KPI)', '',
    '| KPI | Server path (canonical for the dictionary) | Other paths still computing it | Status |', '|---|---|---|---|',
    '| Change success rate | reports-db `_changeOutcome` / `_computeSiteChanges` | public/executive-report.html + public/executive.html (browser classifier, ported verbatim the other way) | duplicate kept: the deck builder runs in the browser; removal = moving the deck payload server-side (P06 / reporting area) — **listed, not removed** |',
    '| Resolution SLA ("missed") | reports-db + services/slaDefinition.js `resOverdueSql` | public/lib/dashboard-shared.js `isResOverdue`, public/lib/execDeckPayload.js, public/index.html | duplicate kept: the browser pages compute from the raw ticket cache; pinned equal by tests/sla-definition-parity.test.js |',
    '| Tracker scores | tracker-pptx.js `ss` / `ps2` / `fleetStats` | public/activity-tracker/engine.js (twin) | twin by design (browser + server); pinned by tests/tracker-engine-*.test.js |',
    '| Programme score (sbDims) | services/siteScore.js | services/reviewDashboard.js `sbMeasure` (port of the author\'s page) | two ports of one model, both fidelity-pinned (score-fidelity / review-fidelity) |',
    '| Dictionary KPIs (all 53) | services/metricRegistry.js `resolve` | none on the 8 report surfaces — proven by tests/figure-parity-all-kpis.test.js | one path |', '');
  return L.join('\n');
}

if (require.main === module) {
  const md = build();
  if (process.argv.includes('--check')) { const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : ''; if (cur.trim() !== md.trim()) { console.error('P08-kpi-dossiers.md is stale — run node tools/kpi/dossiers.js'); process.exit(1); } console.log('up to date'); }
  else { fs.writeFileSync(OUT, md + '\n'); console.log('written ' + path.relative(ROOT, OUT)); }
}
module.exports = { build, executiveKeys, OUT };
