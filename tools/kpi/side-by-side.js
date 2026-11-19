'use strict';
// P08 §2 — every KPI that has TWO definitions in use, computed side by side on ONE synthetic dataset through
// the SAME production code paths (no re-implemented formula). Nothing here chooses: each pair states what each
// choice means. The dataset is FICTITIOUS (labelled), never production data.
//
//   node tools/kpi/side-by-side.js          markdown table (pasted into the committee dossier)
//   node tools/kpi/side-by-side.js --json   the raw results
const rdb = require('../../reports-db');
const SLA = require('../../services/slaDefinition');
const Dual = require('../../public/lib/slaDual');
const { computeSiteScore } = require('../../services/siteScore');
const { buildSiteScoreboard } = require('../../services/siteScoreboard');

// ── FIXTURE ─────────────────────────────────────────────────────────────────────────────────
const chg = (o) => ({ udf_json: JSON.stringify({ 'UDF:Change Implementation Outcome': o }) });
// 7 successful · 1 partial · 2 failed · 1 backed out · 3 cancelled · 2 pending (no outcome)
const CHANGES = [...Array(7).fill(chg('Successful')), chg('Partial'), chg('Failed'), chg('Failed'), chg('Backed out'),
  chg('Cancelled'), chg('Cancelled'), chg('Cancelled'), chg(''), chg('')];
// 10 tickets (1 cancelled); the stored Zoho flag is stale on one of them (resolved late, flagged 0)
const T = (status, due, resolved, flag) => ({ request_status: status, due_by_time: due, resolved_time: resolved, overdue_status: flag });
const TICKETS = [
  T('Closed', '2026-06-02T10:00', '2026-06-02T09:00', 0), T('Closed', '2026-06-03T10:00', '2026-06-03T08:00', 0),
  T('Closed', '2026-06-04T10:00', '2026-06-04T11:30', 1), T('Closed', '2026-06-05T10:00', '2026-06-05T12:00', 0),   // late, flag stale 0
  T('Closed', '2026-06-06T10:00', '2026-06-06T09:59', 0),
  T('Resolved', '2026-06-07T10:00', '2026-06-07T07:00', 0), T('Closed', '2026-06-08T10:00', '2026-06-08T09:00', 0),
  T('Closed', '2026-06-09T10:00', '2026-06-09T09:00', 0), T('Closed', '2026-06-10T10:00', '2026-06-10T09:00', 0),
  T('Cancelled', '2026-06-11T10:00', '2026-06-12T10:00', 1),                                                      // cancelled: never counts in rule B
];
const OPEN_BREACHED = 3;   // 3 tickets still open and already past their due time at month end
// Two sites, very different volumes (for the fleet aggregation question)
const SITES_SLA = [{ code: 'FX-BIG', closed: 400, ok: 300 }, { code: 'FX-SMALL', closed: 10, ok: 10 }];
// Programme inputs of three fictitious sites (sbDims raw measures + the 4 operational dims, both on the same sites)
const PROGRAMME = [
  { code: 'FX-A', sb: { reviews: 9, resolution: 45, overdue: 0, inspections: 3, findings: 1, signoff: 80, raised: 10 }, op: { helpdesk: 92, inspections: 70, meetings: 60, assets: 40 } },
  { code: 'FX-B', sb: { reviews: 4, resolution: 15, overdue: 7, inspections: 1, findings: 3, signoff: 20, raised: 8 }, op: { helpdesk: 97, inspections: 90, meetings: 30, assets: 88 } },
  { code: 'FX-C', sb: { reviews: 6, resolution: 30, overdue: 2, inspections: 2, findings: 0, signoff: 50, raised: 6 }, op: { helpdesk: 60, inspections: null, meetings: 75, assets: 50 } },
];
// D-03: the two roadmap instruments read DIFFERENT data by nature (activity tracker vs manager objectives)
const TRACKER_SITE_SCORES = [0.30, 0.15, 0.20, 0.23];                     // fleet = mean of site scores (0-1)
const ROADMAP_OBJECTIVES = [{ weight: 35, progress: 60 }, { weight: 25, progress: 50 }, { weight: 25, progress: 55 }, { weight: 15, progress: 40 }];

function run() {
  const out = [];
  // D-01 change success rate
  const c = rdb._computeSiteChanges(CHANGES);
  out.push({ figure: 'Change success rate', decision: 'D-01',
    a: { label: 'Deck (cancelled counted as executed)', value: c.success_pct, unit: '%', basis: `${c.successful} / ${c.executed}` },
    b: { label: 'ITSM (cancelled excluded)', value: c.success_pct_itsm, unit: '%', basis: `${c.successful} / ${c.executed_itsm}` },
    consequence: 'A punishes cancelling a bad change (a cancellation lowers the rate); B treats a cancelled change as not executed. The gap is exactly the cancelled count; with nothing executed both are null.' });
  // SLA definition (flag vs due_vs_resolved) — helpdesk_sla_definition
  const res = (mode) => { const closed = TICKETS.filter((t) => !/cancel/i.test(t.request_status)); const vio = closed.filter((t) => SLA.resOverdueRow(t, mode)).length; return { den: closed.length, vio, pct: Math.round(100 * (closed.length - vio) / closed.length * 10) / 10 }; };
  const fa = res('flag'), fb = res('due_vs_resolved');
  out.push({ figure: 'Resolution SLA — what "missed" means', decision: 'helpdesk_sla_definition (KPI committee)',
    a: { label: 'Stored Zoho flag (today)', value: fa.pct, unit: '%', basis: `${fa.den - fa.vio} / ${fa.den}` },
    b: { label: 'Resolved after due time (browser rule)', value: fb.pct, unit: '%', basis: `${fb.den - fb.vio} / ${fb.den}` },
    consequence: 'A follows whatever Zoho flagged at the last sync (a stale flag is believed); B recomputes from the two timestamps, so it agrees with the helpdesk page. They differ only on tickets whose flag is stale.' });
  // SLA headline: closed-only vs incl. open & breached
  const d = Dual.dual({ den: fa.den, violated: fa.vio, openBreached: OPEN_BREACHED });
  out.push({ figure: 'Resolution SLA — which tickets count', decision: 'sla_headline_definition (A7)',
    a: { label: 'Closed tickets only (ITSM doctrine, today)', value: d.closed_only.ok_pct, unit: '%', basis: `${d.closed_only.den - d.closed_only.violated} / ${d.closed_only.den}` },
    b: { label: 'Closed + open already breached', value: d.incl_open.ok_pct, unit: '%', basis: `${d.closed_only.den - d.closed_only.violated} / ${d.incl_open.den}` },
    consequence: 'A ignores tickets still open past their due time (a backlog of late tickets does not lower the rate until they close); B counts them as missed now. With no open-breached count known, B is null.' });
  // Fleet aggregation of a rate
  const meanOfPct = Math.round(SITES_SLA.reduce((s, x) => s + 100 * x.ok / x.closed, 0) / SITES_SLA.length * 10) / 10;
  const pooled = Math.round(1000 * SITES_SLA.reduce((s, x) => s + x.ok, 0) / SITES_SLA.reduce((s, x) => s + x.closed, 0)) / 10;
  out.push({ figure: 'Any rate across sites (fleet figure)', decision: 'aggregation rule (KPI committee)',
    a: { label: 'Mean of site percentages', value: meanOfPct, unit: '%', basis: SITES_SLA.map((x) => `${x.code} ${x.ok}/${x.closed}`).join(' · ') },
    b: { label: 'Σ numerators ÷ Σ denominators (pooled)', value: pooled, unit: '%', basis: `${SITES_SLA.reduce((s, x) => s + x.ok, 0)} / ${SITES_SLA.reduce((s, x) => s + x.closed, 0)}` },
    consequence: 'A gives a 10-ticket site the same weight as a 400-ticket site (one site = one vote); B weights by volume (one ticket = one vote). The step-6 group figures use B; tracker fleet score and IT Review fleet score use A.' });
  // D-02 site score
  const sb = PROGRAMME.map((p) => ({ code: p.code, r: computeSiteScore(p.sb) }));
  const op = buildSiteScoreboard(PROGRAMME.map((p) => ({ code: p.code, name: p.code, ...p.op })));
  for (const p of PROGRAMME) {
    const a = sb.find((x) => x.code === p.code).r; const b = op.rows.find((x) => x.code === p.code);
    out.push({ figure: `Site score — ${p.code}`, decision: 'D-02',
      a: { label: 'Programme score sbDims (6 dims, RAG 70/45)', value: a.score, unit: 'pts', basis: `${a.points}/12 · ${a.rag}` },
      b: { label: 'Operational composite (4 dims 40/20/20/20, RAG 75/55)', value: b.score, unit: 'pts', basis: `${b.coverage.present}/4 dims · ${b.rag}` },
      consequence: 'A measures programme discipline (reviews, resolution, sign-off); B measures operations (helpdesk SLA, inspections, meetings, assets) renormalised over the dimensions present. A site can be GREEN on one and RED on the other.' });
  }
  // D-03 roadmap progress
  const fleet = Math.round(100 * TRACKER_SITE_SCORES.reduce((s, x) => s + x, 0) / TRACKER_SITE_SCORES.length);
  const roadmap = Math.round(ROADMAP_OBJECTIVES.reduce((s, o) => s + o.weight * o.progress, 0) / ROADMAP_OBJECTIVES.reduce((s, o) => s + o.weight, 0));
  out.push({ figure: 'Strategic roadmap progress', decision: 'D-03',
    a: { label: 'Activity tracker fleet score (mean of site scores, YTD)', value: fleet, unit: '%', basis: `mean of ${TRACKER_SITE_SCORES.length} sites` },
    b: { label: 'Roadmap Manager weighted objectives Σ(w×p)/Σw', value: roadmap, unit: '%', basis: `${ROADMAP_OBJECTIVES.length} objectives` },
    consequence: 'Not the same data: A counts site activities against pro-rated targets; B is the manager\'s self-assessed progress on 4 objectives. Choosing one is choosing which instrument the executive material quotes, and its window.' });
  return out;
}

function markdown(rows) {
  const f = (x) => (x.value == null ? '— (null)' : `${x.value} ${x.unit}`);
  const lines = ['| Figure | Decision | Definition A | A | Definition B | B | Consequence of each choice |', '|---|---|---|---|---|---|---|'];
  for (const r of rows) lines.push(`| ${r.figure} | ${r.decision} | ${r.a.label} | **${f(r.a)}** (${r.a.basis}) | ${r.b.label} | **${f(r.b)}** (${r.b.basis}) | ${r.consequence} |`);
  return lines.join('\n');
}

if (require.main === module) { const r = run(); console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 1) : markdown(r)); }
module.exports = { run, markdown, FIXTURE: { CHANGES, TICKETS, OPEN_BREACHED, SITES_SLA, PROGRAMME, TRACKER_SITE_SCORES, ROADMAP_OBJECTIVES } };
