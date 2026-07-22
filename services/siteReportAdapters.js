'use strict';
// Pure mappers: real reader shapes → the site-report §4 contract shape.
// Foundation's binder assumed contract-shaped readers; the real ones differ.
// Every mapper is total: junk in → a zeroed block out, never a throw.

const n = (v) => (Number.isFinite(+v) ? +v : 0);

// getSiteMonthlyMeetingSummary: kpis are dept_target/resolved_month/new_month/
// escalations_open; there is no site_name (only site_code).
//
// `dept_target` is Engagement #1: THREE DISTINCT DEPARTMENTS met this month.
// Its numerator is therefore `depts_with_pv` (COUNT DISTINCT department), NOT
// `pvs_held` (COUNT of PVs) — the reader emits both, side by side
// (meetings-db.js:2841-2843), and pairing the wrong one against the target made
// five PVs of the SAME department read "5 / 3 — target met" while Engagement #1
// was not held. Both are carried through: the target comparison uses
// depts_with_pv, `pvs_held` is still reported as the volume of PVs.
function adaptMeetingsSummary(ms) {
  const s = ms || {}; const k = s.kpis || {};
  return {
    site_name: s.site_name || s.site_code || '',
    month_label: s.month_label || '',
    departments: Array.isArray(s.departments) ? s.departments : [],
    kpis: {
      pvs_held: n(k.pvs_held), depts_with_pv: n(k.depts_with_pv), pvs_target: n(k.dept_target),
      open_issues: n(k.open_issues), high_open: n(k.high_open),
      resolved: n(k.resolved_month), new: n(k.new_month),
      escalations: n(k.escalations_open),
      signoff_pct: n(k.signoff_pct),
      overdue_actions_count: n(k.overdue_actions_count),
    },
  };
}

// md_actions exposes owner_it (not owner).
function adaptMeetingsActions(rows) {
  return (rows || []).map(a => ({ description: a.description, owner: a.owner_it || null, target_date: a.target_date || null }));
}

// inspection aggregate: counts.* is nested; findings live in findingStatus[].
//
// `'low'` is NOT part of the finding-status vocabulary (inspection-init.json:
// ok · minor · major · critical · opp · na) — the `.find()` below can never
// return it, so every 'low' this ever produced came from the fallback. On a site
// with ZERO inspections that fallback rendered a GREEN "Overall risk: low" over
// nothing measured at all: absence of data presented as good news.
//
// So the fallback is now conditional on something having been inspected:
//   · inspections run, none of them critical/major/minor → 'low' is a REAL
//     "nothing serious found" verdict, kept as-is;
//   · no inspection run (or an unreadable aggregate) → `null`, "we did not
//     measure". Both renderers already print null as a muted '—'
//     (coordinator.js inspectionSection, public/site-report.js renderInspection).
const _RISK_ORDER = ['critical', 'major', 'minor', 'low'];
function adaptInspectionAggregate(agg) {
  const a = agg || {}; const c = a.counts || {};
  const fs = Array.isArray(a.findingStatus) ? a.findingStatus : [];
  const byStatus = Object.fromEntries(fs.map(f => [String(f.status || '').toLowerCase(), n(f.n)]));
  const done = n(c.total);
  const worst = _RISK_ORDER.find(s => (byStatus[s] || 0) > 0) || (done > 0 ? 'low' : null);
  return {
    inspections_done: done,
    findings_critical_major: (byStatus.critical || 0) + (byStatus.major || 0),
    overall_risk: worst,
  };
}

// insp_actions already exposes owner + due_date.
function adaptInspectionActions(rows) {
  return (rows || []).map(a => ({ description: a.description, owner: a.owner || null, due_date: a.due_date || null }));
}

module.exports = { adaptMeetingsSummary, adaptMeetingsActions, adaptInspectionAggregate, adaptInspectionActions };
