#!/usr/bin/env node
'use strict';
// Step 3 (SDP-DASH-2.0) — before/after impact table for the RAG convergence (DEC-1 of
// docs/design/ETAPE-03-kpi.md). READ ONLY: computes today's figures per site with the existing
// readers, colours them with the CURRENT policy (public/lib/kpiRag.js) and with the PROPOSED one,
// and lists every site whose colour would change. Nothing is written; no policy is changed here.
//
//   node tools/metrics/rag-impact.js [--asOf=YYYY-MM-DD] [--json]
//
// The proposal lives in THIS file on purpose: kpiRag.js only ever holds decided values.
if (require.main === module) require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const rag = require('../../public/lib/kpiRag');

// Proposed: three policies instead of ten (see ETAPE-03 §3).
const PROPOSED = {
  score:    { kind: 'fixed', g: 75, a: 55, label: 'SCORE — any 0-100 index: green ≥ 75, amber ≥ 55' },
  target:   { kind: 'target', ratio: 0.9, label: 'TARGET — a value against its target: green ≥ target, amber ≥ 90 % of it' },
  progress: { kind: 'fixed', g: 0.9, a: 0.75, label: 'PROGRESS — actual ÷ pro-rated target: green ≥ 90 %, amber ≥ 75 %' },
};
const MAPPING = {   // current policy → proposed policy (+ scale factor so 0-1 policies read 0-100)
  programme_score: { to: 'score' }, composite: { to: 'score' }, scoreboard: { to: 'score' },
  tracker_site: { to: 'score' }, meetings_compliance: { to: 'score', scale: 100 },
  availability_target: { to: 'target' }, opm_availability: { to: 'target' }, wan_sla: { to: 'target' },
  sla_pct: { to: 'target', target: 90 },
  tracker_activity: { to: 'progress' },
};

function classifyWith(p, value, target) {
  if (value == null || !isFinite(Number(value))) return null;
  const v = Number(value);
  if (p.kind === 'fixed') return v >= p.g ? 'green' : v >= p.a ? 'amber' : 'red';
  const t = Number(target);
  if (target == null || !isFinite(t) || t <= 0) return null;
  return v >= t ? 'green' : v >= t * p.ratio ? 'amber' : 'red';
}

/** rows: [{site, metric, policy, value, target?}] → rows + before/after + changed. Pure. */
function impactRows(rows) {
  return rows.map(r => {
    const m = MAPPING[r.policy];
    if (!m) throw new Error('no mapping for policy ' + r.policy);
    const before = rag.classify(r.policy, r.value, r.target);
    const target = r.target != null ? r.target : m.target;
    const after = classifyWith(PROPOSED[m.to], r.value == null ? null : Number(r.value) * (m.scale || 1), target);
    return { ...r, proposed: m.to, before, after, changed: before !== after };
  });
}

function summarise(out) {
  const by = {};
  for (const r of out) {
    const k = r.metric;
    by[k] = by[k] || { metric: k, policy: r.policy, proposed: r.proposed, sites: 0, changed: 0, up: 0, down: 0 };
    by[k].sites++;
    if (r.changed) {
      by[k].changed++;
      const rank = { red: 0, amber: 1, green: 2 };
      if ((rank[r.after] ?? -1) > (rank[r.before] ?? -1)) by[k].up++; else by[k].down++;
    }
  }
  return Object.values(by);
}

async function gather(asOf) {
  const rows = [];
  const y = Number(asOf.slice(0, 4)), mo = Number(asOf.slice(5, 7));
  // Programme score + composite — the IT Review models, same inputs as /it-review.html.
  try {
    const { loadReviewData } = require('../../services/reviewData');
    const { sbMeasure, codesOf } = require('../../services/reviewDashboard');
    const { computeSiteScore } = require('../../services/siteScore');
    const { composite } = require('../../services/siteComposite');
    const D = await loadReviewData(asOf);
    for (const c of codesOf(D)) {
      const sb = computeSiteScore(sbMeasure(c, D, asOf));
      if (sb.applicable) rows.push({ site: c, metric: 'score.programme', policy: 'programme_score', value: sb.score });
      rows.push({ site: c, metric: 'score.composite', policy: 'composite', value: composite(c, D, asOf).score });
    }
  } catch (e) { console.error('[rag-impact] review models skipped:', e.message); }
  // 5 Engagements compliance — last 3 months, as on Meetings ▸ Insights.
  try {
    const from = new Date(Date.UTC(y, mo - 3, 1)).toISOString().slice(0, 10);
    const ins = await require('../../meetings-db').insights({ from, to: asOf });
    for (const r of (ins && ins.site_leaderboard) || []) {
      if (r.score != null) rows.push({ site: r.site, metric: 'meetings.engagements_score', policy: 'meetings_compliance', value: r.score });
    }
  } catch (e) { console.error('[rag-impact] meetings skipped:', e.message); }
  // Helpdesk resolution SLA — previous full month, per site with a meetings code.
  try {
    const rdb = require('../../reports-db');
    const pm = mo === 1 ? 12 : mo - 1, py = mo === 1 ? y - 1 : y;
    for (const s of await rdb.listSiteModuleCodes('meetings')) {
      const h = await rdb.getCalendarMonthlyHelpdesk(s.site_id, py, pm);
      if (h && h.sla_res_pct != null) rows.push({ site: s.code, metric: 'helpdesk.sla_res_pct', policy: 'sla_pct', value: h.sla_res_pct });
    }
  } catch (e) { console.error('[rag-impact] helpdesk skipped:', e.message); }
  // Tracker site score (the scoring engine as committed; prod may still run the 1.00 cut — see DEC-2).
  try {
    const D = await require('../../tracker-db').loadTracker();
    const { ss } = require('../../tracker-pptx');
    for (const s of D.activeSites || []) {
      const r = ss(D, s, mo === 1 ? y - 1 : y, mo === 1 ? 12 : mo - 1);   // previous full month (1-based)
      if (r && r.active) rows.push({ site: s, metric: 'score.tracker_site', policy: 'tracker_site', value: Math.round(r.avg * 100) });
    }
  } catch (e) { console.error('[rag-impact] tracker skipped:', e.message); }
  return rows;
}

async function main(argv) {
  const arg = k => (argv.find(a => a.startsWith('--' + k + '=')) || '').split('=')[1];
  const asOf = arg('asOf') || new Date().toISOString().slice(0, 10);
  if (process.env.REPORTS_BACKEND === 'postgres') await require('../../reports-db').initPgReports();
  if (process.env.MEETINGS_BACKEND === 'postgres') await require('../../meetings-db').initPgMeetings();
  if (process.env.TRACKER_BACKEND === 'postgres') await require('../../tracker-db').initPgTracker();
  const out = impactRows(await gather(asOf));
  const summary = summarise(out);
  if (argv.includes('--json')) { console.log(JSON.stringify({ asOf, proposed: PROPOSED, summary, rows: out }, null, 2)); return; }
  console.log(`RAG convergence impact — as of ${asOf} (read only)\n`);
  for (const [k, p] of Object.entries(PROPOSED)) console.log(`  ${k.padEnd(9)} ${p.label}`);
  console.log('\nmetric                        current → proposed   sites  changed (↑ / ↓)');
  for (const s of summary) console.log(`${s.metric.padEnd(30)}${(s.policy + ' → ' + s.proposed).padEnd(24)}${String(s.sites).padStart(4)}  ${s.changed} (${s.up} / ${s.down})`);
  const ch = out.filter(r => r.changed);
  console.log(`\nSites whose colour would change: ${ch.length}`);
  for (const r of ch) console.log(`  ${r.site.padEnd(8)} ${r.metric.padEnd(28)} ${String(r.value).padStart(6)}  ${r.before} → ${r.after}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0), e => { console.error(e); process.exit(1); });
}
module.exports = { impactRows, summarise, classifyWith, PROPOSED, MAPPING };
