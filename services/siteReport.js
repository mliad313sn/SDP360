'use strict';
// siteReportData(siteCode, period, deps) → the spec §4 JSON contract.
// Every reader call is wrapped: a failure degrades to an empty block (never a
// 500), matching reportPayload.build's resilience doctrine. deps are injected
// so this is unit-testable without a DB.
const { computeSiteScore } = require('./siteScore');

const EMPTY = {
  meetings: { pvs_held: 0, pvs_target: 0, open_issues: 0, high_open: 0, resolved: 0, new: 0, escalations: 0, departments: [], overdue_actions: [] },
  inspection: { inspections_done: 0, findings_critical_major: 0, overall_risk: '—', overdue_actions: [] },
  helpdesk: { created: 0, resolved: 0, backlog: 0, sla_overdue: 0, major_incidents: 0, top_categories: [], recurring: [] },
  // A failed changes reader has COUNTED nothing and JUDGED nothing. The counts
  // are 0; success_pct is `null`, NOT 0 — "0% of the changes succeeded" is a
  // verdict, and we have no basis for one. Read "degrades to zeros" as: counts
  // zero, verdict null.
  changes: { total: 0, successful: 0, failed: 0, cancelled: 0, deferred: 0, pending: 0,
             executed: 0, emergency: 0, success_pct: null, buckets: {} },
};

async function _safe(fn, fallback, label) {
  try { const v = await fn(); return v == null ? fallback : v; }
  catch (e) { console.warn(`[site-report] ${label} failed:`, e.message); return fallback; }
}

function _techAlerts(t, medianLoad) {
  const a = [];
  if (t.current_load > 1.5 * medianLoad) a.push('overloaded');
  if (t.assigned >= 5 && (t.resolved / t.assigned) < 0.6) a.push('low_closure');
  if ((t.sla_overdue || 0) >= 3) a.push('repeat_late');
  return a;
}

async function siteReportData(siteCode, period, deps) {
  const ms = await _safe(() => deps.meetingsSummary(siteCode, period), { kpis: {}, departments: [] }, 'meetingsSummary');
  const mk = ms.kpis || {};
  const mActions = await _safe(() => deps.meetingsActions(siteCode), [], 'meetingsActions');
  const insp = await _safe(() => deps.inspectionAggregate(siteCode, period), {}, 'inspectionAggregate');
  const iActions = await _safe(() => deps.inspectionActions(siteCode), [], 'inspectionActions');
  const hd = await _safe(() => deps.helpdesk(siteCode, period), EMPTY.helpdesk, 'helpdesk');
  // Changes over the REPORT MONTH (see siteReportDeps.changes for why this is
  // not the IT Review's rolling 90-day window).
  const c = await _safe(() => deps.changes(siteCode, period), EMPTY.changes, 'changes');
  const miOpen = await _safe(() => deps.majorIncidents(siteCode, period), [], 'majorIncidents');
  const techsRaw = await _safe(() => deps.technicians(siteCode, period), [], 'technicians');
  const siteStatusRaw = await _safe(() => deps.siteStatus(siteCode), 'operational', 'siteStatus');
  // The score is measured over its OWN 3-month rolling window by deps.scoreInputs
  // — it is NOT derived from the meetings/inspection blocks, which stay monthly
  // narrative content. Both windows are surfaced with the numbers they describe.
  const si = await _safe(() => deps.scoreInputs(siteCode, period), null, 'scoreInputs');
  const prev = await _safe(() => deps.prevScore(siteCode, period), null, 'prevScore');

  const meetings = {
    pvs_held: mk.pvs_held || 0, pvs_target: mk.pvs_target || 0, open_issues: mk.open_issues || 0,
    high_open: mk.high_open || 0, resolved: mk.resolved || 0, new: mk.new || 0, escalations: mk.escalations || 0,
    departments: ms.departments || [],
    overdue_actions: mActions.map(a => ({ description: a.description, owner: a.owner, target_date: a.target_date })),
  };
  const inspection = {
    inspections_done: insp.inspections_done || 0, findings_critical_major: insp.findings_critical_major || 0,
    overall_risk: insp.overall_risk || '—',
    overdue_actions: iActions.map(a => ({ description: a.description, owner: a.owner, due_date: a.due_date })),
  };
  const helpdesk = { created: hd.created || 0, resolved: hd.resolved || 0, backlog: hd.backlog || 0, sla_overdue: hd.sla_overdue || 0, major_incidents: hd.major_incidents || 0, top_categories: hd.top_categories || [], recurring: hd.recurring || [],
    // Detail for the incidents still RUNNING (≠ major_incidents, which counts the
    // month's). Whitelisted field by field: the reader also carries requester /
    // technician / site PII that this report has no reason to forward.
    major_incidents_open: (Array.isArray(miOpen) ? miOpen : []).map(mi => ({
      display_id: mi.display_id, subject: mi.subject, status: mi.status,
      overdue: !!mi.overdue, created_time: mi.created_time, downtime: mi.downtime || '',
    })) };

  // The changes block. `failed` ALREADY includes backed_out and `pending` already
  // includes rework (reports-db._computeSiteChanges, porting _tallyChanges) — the
  // raw counts survive only under `buckets`. There is no completed/open pair.
  //
  // success_pct takes `?? null`, NOT the `|| 0` used by every count above it.
  // `null || 0` is 0, which would print "0%" in the coordinator email for a site
  // with nothing to judge — a verdict fabricated one layer ABOVE the renderers,
  // where their '—' guards cannot reach it. A genuine 0 (all executed changes
  // failed) is a real measurement and must still print 0%, which `??` preserves
  // and `||` would also destroy.
  const changes = { total: c.total || 0, successful: c.successful || 0, failed: c.failed || 0,
    cancelled: c.cancelled || 0, deferred: c.deferred || 0, pending: c.pending || 0,
    executed: c.executed || 0, emergency: c.emergency || 0,
    success_pct: c.success_pct ?? null,          // ← NEVER `|| 0`
    buckets: c.buckets || {} };

  const loads = techsRaw.map(t => t.current_load || 0).sort((a, b) => a - b);
  const medianLoad = loads.length ? loads[Math.floor(loads.length / 2)] : 0;
  const technicians = techsRaw.map(t => ({ ...t, alerts: _techAlerts(t, medianLoad || 1) }));

  // computeSiteScore now gates on applicability: a site with NO data over the
  // window returns { applicable:false, score:null, dims:[], moves:[] } rather
  // than the old fabricated 4/12 = RED 33 (two dims are inverted, so absence of
  // data used to read as excellence). A failed scoreInputs lands here too — an
  // unreadable site is an unknown site, not a bad one.
  //
  // Deliberate asymmetry worth knowing: deps.prevScore guards with
  // `if (!m.reviews && !m.raised && !i.inspections) return null` — it keys on
  // `raised`, which is NOT one of the six `inputs` this gate can see. The
  // outcomes still agree: prevScore only calls through when something happened,
  // and a null score there degrades to prev = null → trend_pts = null anyway.
  const score = si ? computeSiteScore(si.inputs, si.window, prev) : computeSiteScore({}, null, null);

  const recommended = _recommend(meetings, inspection, helpdesk, technicians);
  const fm = _financeView(meetings, inspection, helpdesk, siteStatusRaw);

  return {
    site_code: siteCode, site_name: ms.site_name || siteCode,
    period: { ...period, label: ms.month_label || '' },
    score, meetings, inspection, helpdesk, changes, technicians, recommended, fm,
  };
}

function _recommend(m, i, h, techs) {
  const out = [];
  if (m.high_open > 0) out.push({ kind: 'escalate', text: `${m.high_open} HIGH issue(s) open — escalate to council if unresolved` });
  if (i.findings_critical_major > 0) out.push({ kind: 'visit', text: `${i.findings_critical_major} critical/major inspection finding(s) — schedule a fix visit` });
  if (m.pvs_held < m.pvs_target) out.push({ kind: 'meeting', text: `Hold the remaining ${m.pvs_target - m.pvs_held} department PV(s) this month` });
  if (techs.some(t => t.alerts.includes('overloaded'))) out.push({ kind: 'support', text: 'One or more technicians overloaded — rebalance assignments' });
  return out;
}

function _financeView(m, i, h, siteStatus) {
  const svc = siteStatus === 'major' ? 'At risk' : siteStatus === 'degraded' ? 'Under strain' : 'Stable';
  const routine = (m.pvs_held >= m.pvs_target && i.inspections_done > 0) ? 'On track' : 'Slipping';
  const supportPct = h.created ? Math.round((h.resolved / h.created) * 100) : 100;
  return {
    service_level_label: svc, major_incidents: h.major_incidents, routine_discipline_label: routine,
    site_status: siteStatus,
    user_support: { requests: h.created, resolved_in_time_pct: supportPct, avg_resolution_label: '—', overdue: h.sla_overdue },
    top_frustrations: (h.recurring || []).slice(0, 3).map(r => r.label || r.category).filter(Boolean),
    managerial_attention: _attention(m, i),
    message: {
      good: m.resolved ? [`${m.resolved} issue(s) resolved this month`] : [],
      improve: m.high_open ? [`${m.high_open} HIGH issue(s) still open`] : [],
      decide: i.findings_critical_major ? [`Approve remediation for ${i.findings_critical_major} critical finding(s)`] : [],
    },
  };
}

function _attention(m, i) {
  const rows = [];
  (m.overdue_actions || []).slice(0, 3).forEach(a => rows.push({ subject: a.description, situation: `Owner ${a.owner}, due ${a.target_date}`, impact: 'Operational delay', action_expected: 'Follow up with owner' }));
  return rows;
}

module.exports = { siteReportData };
