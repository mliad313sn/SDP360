'use strict';
// Frozen payloads for the byte-for-byte monthly-email goldens
// (tests/report-template-primitives.test.js).
//
// `full` is copied VERBATIM from tests/report-template-coordinator.test.js:12-42 —
// a complete, realistic §4 site-report contract. Do not "tidy" it: the goldens are
// regenerated from it, so any edit silently rebases the baseline.
//
// `nonApplicable` exists for one specific reason: scoreRagColor() forward-references
// MUTED, and with rag:'AMBER' the `||` short-circuits so MUTED is NEVER evaluated.
// Only a null rag walks that branch — it is what proves the extraction kept the
// palette resolvable.

const full = {
  site_code: 'HGO', site_name: 'Hounde',
  period: { year: 2026, month: 7, kind: 'weekly', label: 'July 2026' },
  score: {
    score: 58, points: 7, rag: 'AMBER', trend_pts: -8,
    window: { from: '2026-04-14', to: '2026-07-14' },
    dims: [
      { key: 'reviews', label: 'Reviews', val: 7, disp: '7', pts: 1, tip: 'reviews held — green from 8, amber 5 to 7, red below 5' },
      { key: 'resolution', label: 'Resolution', val: 14, disp: '14%', pts: 0, tip: 'resolved ÷ raised — green from 40%, amber 20 to 39%, red below 20%' },
      { key: 'overdue', label: 'Overdue', val: 2, disp: '2', pts: 1, tip: 'overdue issues + actions — green if none, amber 1 to 5, red above 5' },
      { key: 'inspections', label: 'Inspections', val: 5, disp: '5', pts: 2, tip: 'inspections run — green from 3, amber 2, red 1 or none' },
      { key: 'findings', label: 'Findings', val: 6, disp: '6', pts: 0, tip: 'critical + major findings — green if none, amber 1 or 2, red from 3' },
      { key: 'signoff', label: 'Sign-off', val: 71, disp: '71%', pts: 2, tip: 'minutes fully signed — green from 70%, amber 30 to 69%, red below 30%' },
    ],
    moves: [
      { n: 1, gain: '+17 pts', text: 'Lift resolution from 14% toward 40%: run a weekly closure sprint on the oldest in-progress items.' },
      { n: 2, gain: '+17 pts', text: 'Close out 6 critical/major inspection findings with dated corrective actions.' },
    ],
  },
  // depts_with_pv is the numerator that faces pvs_target (Engagement #1 counts
  // DEPARTMENTS, not PVs). Here 2 PVs across 2 departments, so the displayed
  // "2 / 3" is unchanged by the fix — the golden diff stays label-only.
  // tests/report-template-coordinator.test.js pins the divergent case (5 PVs,
  // 2 departments) separately.
  meetings: { pvs_held: 2, depts_with_pv: 2, pvs_target: 3, open_issues: 4, high_open: 1, resolved: 6, new: 3, escalations: 1,
              departments: [{ department: 'hse', status: 'blocked' }], overdue_actions: [{ description: 'Fix X', owner: 'Jean', target_date: '2026-07-20' }] },
  inspection: { inspections_done: 1, findings_critical_major: 2, overall_risk: 'major', overdue_actions: [] },
  helpdesk: { created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1, top_categories: [{ category: 'Network', count: 12 }], recurring: [{ label: 'Network / WAN', count: 4 }],
              major_incidents_open: [{ display_id: '311587', subject: 'WAN link down at the plant', status: 'In Progress', overdue: true, created_time: '2026-07-02T08:00:00.000Z', downtime: '4h' }] },
  // Task 1's changes contract — `failed` already includes backed_out; the raw
  // counts survive only under `buckets`. success_pct may be null.
  changes: { buckets: { success: 3, backed_out: 1 }, successful: 3, failed: 1, cancelled: 0, deferred: 0,
             pending: 2, executed: 4, total: 6, emergency: 1, success_pct: 75 },
  technicians: [{ name: 'Amina', assigned: 20, resolved: 18, avg_resolution_h: 6, reopened: 1, current_load: 4, alerts: ['overloaded'] }],
  recommended: [{ kind: 'escalate', text: '1 HIGH issue(s) open — escalate to council if unresolved' }],
};

const nonApplicable = {
  ...full,
  score: { applicable: false, rag: null, score: null, points: null, dims: [], moves: [] },
};

module.exports = { full, nonApplicable };
