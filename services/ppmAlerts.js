'use strict';
// A-27 — catalogue rule A11: PPM exceptions (PURE: no I/O; `today` is passed in). Read by
// GET /api/governance/portfolio/exceptions (the Friday queue on the cockpit) and by the nightly
// tools/governance/ppm-alerts.js (armed off: ppm_alerts_enabled = '0').
// A null or unknown date is NEVER overdue; a project closed or cancelled raises nothing.
//   task_overdue       end_date < today, status not done / cancelled
//   task_blocked       status blocked and not updated for more than blockedDays
//   unowned_task       open task without owner on an in_progress project
//   unowned_milestone  open milestone without owner on an in_progress project
//   milestone_overdue  due_date < today, not done
//   dependency_blocked an open task whose predecessor is late or blocked
//   baseline_slip      project finish later than its baseline by more than slipDays (projectSchedule.varianceOf)
//   capacity_overload  one item per conflict, only when a capacity grid is passed
//   gate_approaching   (E-R02, catalogue A10 — only with gateLeadDays set) the project's next stage gate falls within
//                      gateLeadDays: a project in proposal / approval whose start_date is near (the approval gate must be
//                      passed before it starts), an in_progress project whose end_date is near (the closure gate).
//                      There is no funding-review or renewal date in the schema — those are not raised.
//   stale_plan         (B4, only with staleDays set — config stale_plan_days, '' = off = today) an in_progress project
//                      whose plan was last updated (services/ppm/planFreshness: ledger + plan rows) more than staleDays
//                      ago. The update dates are passed in `planUpdated` ({project_id: iso}); an UNKNOWN date (no row,
//                      no event) is never stale — the rule says nothing rather than guess.
const { varianceOf } = require('./projectSchedule');

const KINDS = ['task_overdue', 'task_blocked', 'unowned_task', 'unowned_milestone', 'milestone_overdue', 'dependency_blocked', 'baseline_slip', 'capacity_overload', 'gate_approaching', 'stale_plan'];
const DONE = ['done', 'cancelled'];
const _iso = (v) => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const _ms = (d) => Date.parse(d + 'T00:00:00Z');
const _blank = (v) => v == null || String(v).trim() === '';

function findExceptions(view, { today, blockedDays = 5, slipDays = 10, capacity = null, gateLeadDays = null, staleDays = null, planUpdated = null, management = null } = {}) {
  const T = _iso(today); if (!T) throw new Error('findExceptions needs today (YYYY-MM-DD)');
  const v = view || {};
  const projects = new Map((v.projects || []).map((p) => [Number(p.id), p]));
  const live = (p) => !!p && p.stage !== 'closed' && !DONE.includes(p.status);
  const out = [];
  const add = (kind, entity, id, p, owner, message, since) => out.push({ key: `${kind}:${entity}:${id}`, kind, entity, entity_id: id, project_id: p ? Number(p.id) : null, project_key: p ? p.key || null : null, site_id: p && p.site_id != null ? Number(p.site_id) : null, owner: _blank(owner) ? null : String(owner), message, since: since || null });
  const tasks = (v.tasks || []).filter((t) => live(projects.get(Number(t.project_id))));
  const byId = new Map(tasks.map((t) => [Number(t.id), t]));
  const isLate = (t) => !!t && !DONE.includes(t.status) && !!_iso(t.end_date) && _iso(t.end_date) < T;
  const isBlocked = (t) => !!t && t.status === 'blocked';
  for (const t of tasks) {
    const p = projects.get(Number(t.project_id)); const open = !DONE.includes(t.status); const who = t.owner || p.owner;
    const label = `${p.key || '#' + p.id} · ${t.wbs_code ? t.wbs_code + ' ' : ''}${t.name}`;
    if (isLate(t)) add('task_overdue', 'task', Number(t.id), p, who, `${label}: due ${_iso(t.end_date)}, not done`, _iso(t.end_date));
    if (isBlocked(t)) {
      const since = _iso(t.updated_at);
      if (since && (_ms(T) - _ms(since)) / 86400000 > Number(blockedDays)) add('task_blocked', 'task', Number(t.id), p, who, `${label}: blocked since ${since}`, since);
    }
    if (open && p.stage === 'in_progress' && _blank(t.owner)) add('unowned_task', 'task', Number(t.id), p, p.owner, `${label}: no owner`, null);
    if (open) {
      const pre = (Array.isArray(t.depends_on) ? t.depends_on : []).map((d) => byId.get(Number(d))).filter((x) => isLate(x) || isBlocked(x));
      if (pre.length) add('dependency_blocked', 'task', Number(t.id), p, who, `${label}: waits on ${pre.map((x) => (x.wbs_code || '#' + x.id) + (isBlocked(x) ? ' (blocked)' : ' (late)')).join(', ')}`, null);
    }
  }
  for (const m of v.milestones || []) {
    const p = projects.get(Number(m.project_id)); if (!live(p)) continue;
    const done = m.status === 'done' || !!m.done_at; if (done) continue;
    const label = `${p.key || '#' + p.id} · ◆ ${m.name}`;
    const due = _iso(m.due_date);
    if (due && due < T) add('milestone_overdue', 'milestone', Number(m.id), p, m.owner || p.owner, `${label}: due ${due}, not done`, due);
    if (p.stage === 'in_progress' && _blank(m.owner)) add('unowned_milestone', 'milestone', Number(m.id), p, p.owner, `${label}: no owner`, null);
  }
  for (const p of projects.values()) {
    if (!live(p)) continue;
    const d = varianceOf(p).finish_variance_days;
    if (d != null && d > Number(slipDays)) add('baseline_slip', 'project', Number(p.id), p, p.owner, `${p.key || '#' + p.id} ${p.name || ''}: finish ${d} d later than its baseline (${_iso(p.baseline_end)})`.replace(/\s+/g, ' '), _iso(p.baseline_end));
  }
  const lead = gateLeadDays == null || String(gateLeadDays).trim() === '' || !Number.isFinite(Number(gateLeadDays)) || Number(gateLeadDays) < 0 ? null : Number(gateLeadDays);
  if (lead != null) for (const p of projects.values()) {
    if (!live(p)) continue;
    const stage = p.stage || 'proposal';
    const gate = ['proposal', 'approval'].includes(stage) ? { date: _iso(p.start_date), name: 'approval (before start)' }
      : stage === 'in_progress' ? { date: _iso(p.end_date), name: 'closure (planned end)' } : null;
    if (!gate || !gate.date || gate.date < T) continue;   // no date = nothing to remind; a past date is A11's business
    const inDays = Math.round((_ms(gate.date) - _ms(T)) / 86400000);
    if (inDays <= lead) add('gate_approaching', 'project', `${Number(p.id)}:${stage}:${gate.date}`, p, p.owner, `${p.key || '#' + p.id} ${p.name || ''}: stage gate ${gate.name} due ${gate.date} (in ${inDays} d)`.replace(/\s+/g, ' '), gate.date);
  }
  const stale = staleDays == null || String(staleDays).trim() === '' || !Number.isFinite(Number(staleDays)) || Number(staleDays) < 1 ? null : Number(staleDays);
  if (stale != null && planUpdated) for (const p of projects.values()) {
    if (!live(p) || p.stage !== 'in_progress') continue;
    const at = planUpdated[p.id] != null ? planUpdated[p.id] : planUpdated[String(p.id)];
    const last = _iso(at); if (!last) continue;              // unknown = never stale
    const age = Math.floor((_ms(T) - _ms(last)) / 86400000);
    if (age > stale) add('stale_plan', 'project', `${Number(p.id)}:${last}`, p, p.owner, `${p.key || '#' + p.id} ${p.name || ''}: plan not updated for ${age} d (last update ${last})`.replace(/\s+/g, ' '), last);
  }
  if (Array.isArray(capacity)) for (const c of capacity) {
    const who = String(c.owner || '').trim(); if (!who) continue;
    out.push({ key: `capacity_overload:person:${who.toLowerCase()}:${_iso(c.from) || ''}`, kind: 'capacity_overload', entity: 'person', entity_id: who.toLowerCase(), project_id: null, project_key: null, site_id: null, owner: who, message: `${who}: booked at ${c.peak_pct} % from ${_iso(c.from)} to ${_iso(c.to)}`, since: _iso(c.from) });
  }
  // PORTFOLIO LOT 4 — the six spec §22 kinds ride along only when the caller passes `management` (switch
  // ppm_alert_actions_enabled); without it the list is exactly today's A11 list.
  if (management) out.push(...findManagementAlerts(v, { ...management, today: T }));
  return out.sort((a, b) => ALL_KINDS.indexOf(a.kind) - ALL_KINDS.indexOf(b.kind) || String(a.key).localeCompare(String(b.key)));
}

// ── PORTFOLIO LOT 4 (IT portfolio reconstruction spec §22) — management alert kinds ──────────────────────────────────
// Read only while report_config ppm_alert_actions_enabled = '1' (PROPOSED, default '0'). EVERY RULE, SEVERITY AND
// RECOMMENDED ACTION BELOW IS PROPOSED (a PMO decision, not approved policy). No second formula:
//   critical_risk          declared risk exposure 'critical' (Lot 1 intake field)
//   high_risk              declared 'high' OR at least one open high-severity register risk (portfolioEvidence.riskView)
//                          — the Lot 3 register "high risk" rule minus the projects already raised as critical_risk
//   unfunded               budget status in portfolioRegister.UNFUNDED (the Lot 3 report rule); amount readers only
//   decision_bottleneck    decision required = 'yes' and no decision recorded for the project; or a linked OPEN
//                          decision past its due date; or (only with decisionAgeDays set) an open undated decision older
//                          than decisionAgeDays. A null due date is never overdue; tbc is a data-quality matter.
//   missing_delivery_lead  the data-quality check delivery_lead_missing fails (blank or tbc; 'na' answers it) on a live
//                          project past the proposal stage
//   schedule_error         the data-quality check dates_invalid reads 'invalid' (unreadable date or end before start)
// Unknown inputs never raise: the intake columns absent (switch off) → the intake kinds are reported UNKNOWN by
// managementCoverage(), never "no alert"; decisions not passed → no bottleneck guessed.
const MANAGEMENT_KINDS = ['critical_risk', 'high_risk', 'unfunded', 'decision_bottleneck', 'missing_delivery_lead', 'schedule_error'];
const ALL_KINDS = [...KINDS, ...MANAGEMENT_KINDS];
const SEVERITY = Object.freeze({ critical_risk: 'critical', high_risk: 'high', unfunded: 'high', decision_bottleneck: 'high', missing_delivery_lead: 'medium', schedule_error: 'high' });
const RECOMMENDED_ACTION = Object.freeze({
  critical_risk: { en: 'Review the mitigation plan with the sponsor and decide whether to continue, re-plan or stop.', fr: 'Revoir le plan de mitigation avec le sponsor et décider de poursuivre, replanifier ou arrêter.' },
  high_risk: { en: 'Confirm an owner and a dated mitigation for each high risk.', fr: 'Confirmer un responsable et une mitigation datée pour chaque risque élevé.' },
  unfunded: { en: 'Obtain a budget decision (approve, defer or cancel) before committing resources.', fr: 'Obtenir une décision budgétaire (approuver, différer ou annuler) avant d’engager des ressources.' },
  decision_bottleneck: { en: 'Put the decision on the next committee agenda with its authority and due date.', fr: 'Inscrire la décision au prochain comité avec son autorité et son échéance.' },
  missing_delivery_lead: { en: 'Name a delivery lead.', fr: 'Désigner un responsable de livraison.' },
  schedule_error: { en: 'Correct the planned start and end dates.', fr: 'Corriger les dates de début et de fin prévues.' },
});
// commitment kind for a promoted alert (services/commitmentLifecycle KINDS) — PROPOSED mapping
const COMMITMENT_KIND = Object.freeze({ critical_risk: 'operational_risk', high_risk: 'operational_risk', unfunded: 'issue', decision_bottleneck: 'decision', missing_delivery_lead: 'issue', schedule_error: 'corrective_action' });
const INTAKE_KINDS = ['critical_risk', 'high_risk', 'unfunded', 'decision_bottleneck', 'missing_delivery_lead'];
const OPEN_DECISION = ['open', 'in_progress', 'awaiting_confirmation'];   // services/decisionLifecycle OPEN_STATUSES

/** Per kind: null = computed, else the reason it is UNKNOWN ('INTAKE_DISABLED' | 'MONEY_HIDDEN' | 'DECISIONS_UNKNOWN'). */
function managementCoverage(view, { money = false, decisions = undefined } = {}) {
  const ps = (view && view.projects) || [];
  const intake = ps.length === 0 || ps.some((p) => p && 'risk_exposure' in p);
  const out = {};
  for (const k of MANAGEMENT_KINDS) out[k] = null;
  if (!intake) for (const k of INTAKE_KINDS) out[k] = 'INTAKE_DISABLED';
  if (intake && !money) out.unfunded = 'MONEY_HIDDEN';
  if (intake && !Array.isArray(decisions)) out.decision_bottleneck = 'DECISIONS_UNKNOWN';
  return out;
}

function findManagementAlerts(view, { today, money = false, decisions = null, decisionAgeDays = null } = {}) {
  const T = _iso(today); if (!T) throw new Error('findManagementAlerts needs today (YYYY-MM-DD)');
  const DQ = require('./ppm/dataQuality');
  const PE = require('./portfolioEvidence');
  const { UNFUNDED } = require('./ppm/portfolioRegister');
  const v = view || {};
  const live = (p) => !!p && !p.deleted_at && p.stage !== 'closed' && !DONE.includes(p.status);
  const out = [];
  const label = (p) => `${!_blank(p.project_ref) ? p.project_ref : (p.key || '#' + p.id)} ${p.name || ''}`.replace(/\s+/g, ' ').trim();
  const add = (kind, entity, id, p, message, trigger, since) => out.push({ key: `${kind}:${entity}:${id}`, kind, entity, entity_id: id, project_id: Number(p.id),
    project_key: !_blank(p.project_ref) ? p.project_ref : (p.key || null), site_id: p.site_id != null ? Number(p.site_id) : null, owner: _blank(p.owner) ? null : String(p.owner),
    message, trigger, since: since || null, severity: SEVERITY[kind], recommended_action: RECOMMENDED_ACTION[kind] });
  const age = decisionAgeDays == null || String(decisionAgeDays).trim() === '' || !Number.isFinite(Number(decisionAgeDays)) || Number(decisionAgeDays) < 1 ? null : Number(decisionAgeDays);
  const decs = Array.isArray(decisions) ? decisions.filter((d) => d && d.project_id != null) : null;
  for (const p of v.projects || []) {
    if (!live(p)) continue;
    const pid = Number(p.id);
    if ('risk_exposure' in p) {
      if (p.risk_exposure === 'critical') add('critical_risk', 'project', pid, p, `${label(p)}: risk exposure declared critical`, 'risk_exposure=critical');
      else {
        const open = (v.risks || []).filter((r) => Number(r.project_id) === pid && r.status === 'open' && !r.deleted_at && (r.kind == null || r.kind === 'risk')).map(PE.riskView).filter((r) => r.severity === 'high');
        if (p.risk_exposure === 'high' || open.length) add('high_risk', 'project', pid, p, `${label(p)}: ${p.risk_exposure === 'high' ? 'risk exposure declared high' : ''}${p.risk_exposure === 'high' && open.length ? ', ' : ''}${open.length ? open.length + ' open high-severity risk(s)' : ''}`, p.risk_exposure === 'high' ? 'risk_exposure=high' : 'open_high_risks=' + open.length);
      }
    }
    if (money && 'budget_status' in p && p.budget_status != null && UNFUNDED.includes(p.budget_status)) add('unfunded', 'project', `${pid}:${p.budget_status}`, p, `${label(p)}: budget status ${p.budget_status}`, 'budget_status=' + p.budget_status);
    if (decs && 'decision_required' in p) {
      const mine = decs.filter((d) => Number(d.project_id) === pid);
      if (p.decision_required === 'yes' && !mine.length) add('decision_bottleneck', 'project', `${pid}:not_recorded`, p, `${label(p)}: a management decision is required and none is recorded`, 'decision_required=yes, no decision');
      for (const d of mine) {
        if (!OPEN_DECISION.includes(d.status)) continue;
        const due = _iso(d.due_date);
        if (due && due < T) { add('decision_bottleneck', 'decision', `${Number(d.id)}:${due}`, p, `${label(p)}: decision ${d.ref || '#' + d.id} due ${due}, still ${d.status}`, 'decision overdue', due); continue; }
        const made = _iso(d.created_at);
        if (!due && age != null && made && Math.floor((_ms(T) - _ms(made)) / 86400000) > age) add('decision_bottleneck', 'decision', `${Number(d.id)}:age`, p, `${label(p)}: decision ${d.ref || '#' + d.id} open since ${made} with no due date`, 'decision open > ' + age + ' d', made);
      }
    }
    if ('delivery_lead' in p && p.stage && p.stage !== 'proposal') {
      const c = DQ.evaluate(p, { money: false }).checks.find((x) => x.key === 'delivery_lead_missing');
      if (c && c.complete === false) add('missing_delivery_lead', 'project', pid, p, `${label(p)}: no delivery lead`, 'delivery_lead ' + c.state);
    }
    const sc = DQ.evaluate(p, { money: false }).checks.find((x) => x.key === 'dates_invalid');
    if (sc && sc.state === 'invalid') add('schedule_error', 'project', `${pid}:${p.start_date || ''}:${p.end_date || ''}`, p, `${label(p)}: invalid schedule (start ${p.start_date || '—'}, end ${p.end_date || '—'})`, 'dates_invalid');
  }
  return out.sort((a, b) => MANAGEMENT_KINDS.indexOf(a.kind) - MANAGEMENT_KINDS.indexOf(b.kind) || String(a.key).localeCompare(String(b.key)));
}

/** The commitment a promoted alert becomes (services/commitmentStore.create input). owner required; due_date YYYY-MM-DD or blank. */
function commitmentFromAlert(al, { owner, due_date } = {}) {
  const bad = (m) => Object.assign(new Error(m), { code: 'INVALID', status: 400, expose: true });
  if (!al || !MANAGEMENT_KINDS.includes(al.kind)) throw bad('not a management alert');
  if (_blank(owner)) throw bad('owner is required (assign the alert to someone)');
  const due = due_date == null || String(due_date).trim() === '' ? null : String(due_date).trim();
  if (due != null && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw bad('due_date must be YYYY-MM-DD');
  const act = (al.recommended_action && al.recommended_action.en) || '';
  return { kind: COMMITMENT_KIND[al.kind], title: String(al.message || al.kind).slice(0, 300), severity: al.severity || SEVERITY[al.kind], accountable_owner: String(owner).trim().slice(0, 200),
    due_date: due, site_id: al.site_id == null ? null : Number(al.site_id), process: 'portfolio', impact_dimension: al.kind,
    treatment_plan: `Recommended action (PROPOSED): ${act}\nTrigger: ${al.trigger || ''}`.slice(0, 4000), source: { system: 'ppm_alert', id: String(al.key) } };
}

module.exports = { findExceptions, KINDS, MANAGEMENT_KINDS, ALL_KINDS, SEVERITY, RECOMMENDED_ACTION, COMMITMENT_KIND, findManagementAlerts, managementCoverage, commitmentFromAlert };
