'use strict';
// Pure mappers: real reader shapes → the site-report §4 contract shape.
// Foundation's binder assumed contract-shaped readers; the real ones differ.
// Every mapper is total: junk in → a zeroed block out, never a throw.

const n = (v) => (Number.isFinite(+v) ? +v : 0);

// getSiteMonthlyMeetingSummary: kpis are dept_target/resolved_month/new_month/
// escalations_open; there is no site_name (only site_code).
function adaptMeetingsSummary(ms) {
  const s = ms || {}; const k = s.kpis || {};
  return {
    site_name: s.site_name || s.site_code || '',
    month_label: s.month_label || '',
    departments: Array.isArray(s.departments) ? s.departments : [],
    kpis: {
      pvs_held: n(k.pvs_held), pvs_target: n(k.dept_target),
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
const _RISK_ORDER = ['critical', 'major', 'minor', 'low'];
function adaptInspectionAggregate(agg) {
  const a = agg || {}; const c = a.counts || {};
  const fs = Array.isArray(a.findingStatus) ? a.findingStatus : [];
  const byStatus = Object.fromEntries(fs.map(f => [String(f.status || '').toLowerCase(), n(f.n)]));
  const worst = _RISK_ORDER.find(s => (byStatus[s] || 0) > 0) || 'low';
  return {
    inspections_done: n(c.total),
    findings_critical_major: (byStatus.critical || 0) + (byStatus.major || 0),
    overall_risk: worst,
  };
}

// insp_actions already exposes owner + due_date.
function adaptInspectionActions(rows) {
  return (rows || []).map(a => ({ description: a.description, owner: a.owner || null, due_date: a.due_date || null }));
}

module.exports = { adaptMeetingsSummary, adaptMeetingsActions, adaptInspectionAggregate, adaptInspectionActions };
