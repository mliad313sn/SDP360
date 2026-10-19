'use strict';
// Step 8 — PURE agenda generator for a cockpit session. Inputs are already-read facts (metrics
// from the KPI dictionary, open/overdue actions from the Site Actions register, active major
// incidents, open decisions, RFIs to triage); the output is a dated agenda document the
// session page renders and the minutes reuse. No I/O, no formula: every figure comes with its
// metric key, window and as_of, and a missing figure stays null (never 0).

const DEFAULT_TEMPLATES = {
  site_weekly:   { minutes: 45, sections: ['kpis', 'incidents', 'actions', 'decisions', 'next'] },
  site_monthly:  { minutes: 60, sections: ['kpis', 'trackers', 'incidents', 'actions', 'decisions', 'rfis', 'next'] },
  group_monthly: { minutes: 90, sections: ['kpis', 'trackers', 'incidents', 'portfolio', 'actions', 'decisions', 'rfis', 'next'] },
  committee:     { minutes: 60, sections: ['rfis', 'decisions', 'portfolio', 'trackers', 'next'] },
  cab:           { minutes: 45, sections: ['incidents', 'actions', 'decisions', 'next'] },
  custom:        { minutes: 60, sections: ['kpis', 'actions', 'decisions', 'next'] },
};
const KPI_SETS = {
  site_weekly: ['helpdesk.window_created', 'helpdesk.window_resolved', 'helpdesk.window_overdue', 'helpdesk.window_major_incidents', 'wan.wan1_availability_pct', 'inspection.open_actions'],
  site_monthly: ['helpdesk.resolution_sla_pct', 'helpdesk.first_reply_sla_pct', 'inspection.conformity_pct', 'meetings.engagement_score', 'assets.completeness_pct', 'tracker.site_score_pct'],
  group_monthly: ['helpdesk.resolution_sla_pct', 'helpdesk.closure_pct', 'inspection.conformity_pct', 'meetings.engagement_score', 'assets.completeness_pct', 'tracker.fleet_score_pct', 'programme.composite'],
  committee: ['tracker.fleet_score_pct', 'programme.site_score'],
  cab: ['helpdesk.window_major_incidents', 'helpdesk.resolution_sla_pct'],
  custom: ['helpdesk.resolution_sla_pct'],
};
const TITLES = { kpis: 'Key figures', trackers: 'Trackers and roadmap', incidents: 'Major incidents', portfolio: 'Portfolio — objectives and slippage', actions: 'Overdue and open actions', decisions: 'Pending decisions', rfis: 'Requests for improvement to triage', next: 'Next steps and next session' };

/** Which metric keys an agenda of this kind needs (so the route can resolve them first). */
function metricKeysFor(kind, template) { return (template && Array.isArray(template.kpis) && template.kpis.length) ? template.kpis : (KPI_SETS[kind] || KPI_SETS.custom); }

/**
 * @param {object} o  { cadence, scheduledAt, metrics:[{key,name,value,unit,rag,window,as_of}], actions:{open,overdue,groups?}, incidents:[{display_id,subject,site,created_time}],
 *                      decisions:[{ref,title,owner,due_date}], rfis:[{ref,title,kind,score}], trackers:[{key,name,score,rag}], portfolio:{objectives:[{name,status,evidence_pct,slip_days}]}, now }
 */
function buildAgenda(o) {
  const kind = (o.cadence && o.cadence.kind) || 'custom';
  const tpl = Object.assign({}, DEFAULT_TEMPLATES[kind] || DEFAULT_TEMPLATES.custom, (o.cadence && o.cadence.agenda_template) || {});
  const total = tpl.minutes || 60;
  const sections = tpl.sections || DEFAULT_TEMPLATES.custom.sections;
  const per = Math.max(5, Math.floor(total / sections.length));
  const items = sections.map((s, i) => {
    const it = { id: `s${i + 1}-${s}`, kind: s, title: TITLES[s] || s, minutes: per, content: null };
    if (s === 'kpis') it.content = (o.metrics || []).map(m => ({ key: m.key, name: m.name, value: m.value, unit: m.unit, rag: m.rag, window: m.window && m.window.label, as_of: m.as_of }));
    if (s === 'incidents') it.content = (o.incidents || []).slice(0, 10).map(x => ({ id: x.display_id || x.request_id, subject: x.subject, site: x.site, since: x.created_time }));
    if (s === 'actions') { const a = o.actions || {}; it.content = { open: a.open ?? null, overdue: a.overdue ?? null, list: (a.list || []).slice(0, 15) }; }
    if (s === 'decisions') it.content = (o.decisions || []).slice(0, 15).map(d => ({ ref: d.ref, title: d.title, owner: d.owner, due_date: d.due_date, status: d.status }));
    if (s === 'rfis') it.content = (o.rfis || []).slice(0, 10).map(r => ({ ref: r.ref, title: r.title, kind: r.kind, score: r.score, status: r.status }));
    if (s === 'trackers') it.content = (o.trackers || []).map(t => ({ key: t.key, name: t.name, score: t.score, rag: t.rag }));
    if (s === 'portfolio') it.content = (o.portfolio && o.portfolio.objectives || []).map(x => ({ name: x.name, status: x.status, evidence_pct: x.evidence_pct ?? null, slip_days: x.slip_days ?? null }));
    if (s === 'next') it.content = { next_session: o.nextSession || null };
    return it;
  });
  return { kind, title: (o.cadence && o.cadence.name) || 'Session', scheduled_at: o.scheduledAt || null, generated_at: (o.now || new Date()).toISOString(), total_minutes: total, items,
    summary: { reds: (o.metrics || []).filter(m => m.rag === 'RED').length, overdue_actions: o.actions && o.actions.overdue != null ? o.actions.overdue : null, open_decisions: (o.decisions || []).length, rfis: (o.rfis || []).length, incidents: (o.incidents || []).length } };
}

module.exports = { buildAgenda, metricKeysFor, DEFAULT_TEMPLATES, KPI_SETS, TITLES };
