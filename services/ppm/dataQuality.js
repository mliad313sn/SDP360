'use strict';
// PORTFOLIO LOT 2 (IT portfolio reconstruction spec §20, §4.3) — the data-quality engine. PURE: no I/O, no clock, no
// config read. The caller passes the project row (with the Lot 1 intake fields when ppm_intake_register_enabled = '1'),
// its risks, and whether the reader may see money. Used by routes/governance.js only while report_config
// ppm_data_quality_enabled = '1' (shadow: score + checks shown, nothing refused) and, for the proposal → approval gate,
// while ppm_dq_gate_enforced = '1'. Both switches PROPOSED, default '0'. ADR: docs/ai-decisions/ADR-PORTFOLIO-LOT2-data-quality.md
//
// EVERYTHING BELOW THAT DECIDES WHAT "GOOD DATA" MEANS IS PROPOSED (a PMO decision, not approved):
//   - the required set (the 18 field checks of spec §20 — every one counts as required);
//   - which checks are BLOCKING (an invalid schedule and a missing accountable IT owner, the two examples of spec §20.2);
//   - how an explicit value state counts: 'na' (not applicable) and 'none_known' answer the question → completed;
//     'tbc' (to be confirmed, also the reference-list code 'tbc' of budget status / decision required) does NOT;
//   - a zero budget counts as missing (spec §20 "budget missing or zero") unless its status is "not budgeted";
//     a zero resource demand (average and peak FTE both 0) counts as missing;
//   - the DQ RAG bands (public/lib/kpiRag.js policy 'ppm-data-quality': green 100, amber 80–99, red < 80).
//
// FIVE readings of a field, never collapsed (Lot 1 value-state convention):
//   blank        no value, no state                    → not completed ('blank')
//   zero         a numeric 0                           → kept as measured; incomplete for budget / FTE ('zero')
//   tbc          to be confirmed                       → not completed, distinct from blank ('tbc')
//   na           not applicable                        → completed ('na')
//   none_known   we looked, there is none (deps/risks) → completed ('none_known')
// plus 'unavailable' = the column is not on the row (intake switch off): UNKNOWN, never counted as missing nor as
// complete, and the score is then null (never 0, never green) — spec rule "a number with no source is unknown".
//
// SCORE (spec §20.1) = completed required fields ÷ total required fields × 100, floored (99.4 never reads 100).
// SITE SCORE = Σ completed ÷ Σ required over the site's projects that have a score (never a mean of percentages).

const KpiRag = require('../../public/lib/kpiRag');

const RAG_POLICY = 'ppm-data-quality';
/** The 19 checks of spec §20, in its order. kind field = counts in the score; kind validity = blocking-only check. */
const CHECKS = Object.freeze([
  { key: 'name_missing', field: 'name', kind: 'field' },
  { key: 'business_need_missing', field: 'business_need', kind: 'field' },
  { key: 'business_value_missing', field: 'expected_value', kind: 'field' },
  { key: 'sponsor_missing', field: 'sponsor', kind: 'field' },
  { key: 'it_owner_missing', field: 'owner', kind: 'field', blocking: true },
  { key: 'priority_missing', field: 'priority', kind: 'field' },
  { key: 'start_date_missing', field: 'start_date', kind: 'field' },
  { key: 'end_date_missing', field: 'end_date', kind: 'field' },
  { key: 'budget_missing_or_zero', field: 'budget', kind: 'field', money: true },
  { key: 'budget_status_missing', field: 'budget_status', kind: 'field', money: true },
  { key: 'dependencies_missing', field: 'dependencies', kind: 'field' },
  { key: 'key_risks_missing', field: 'risks', kind: 'field' },
  { key: 'decision_required_missing', field: 'decision_required', kind: 'field' },
  { key: 'status_missing', field: 'status', kind: 'field' },
  { key: 'delivery_effort_missing', field: 'delivery_effort', kind: 'field' },
  { key: 'resource_demand_missing_or_zero', field: 'resource_demand', kind: 'field' },
  { key: 'risk_exposure_missing', field: 'risk_exposure', kind: 'field' },
  { key: 'delivery_lead_missing', field: 'delivery_lead', kind: 'field' },
  { key: 'dates_invalid', field: 'schedule', kind: 'validity', blocking: true },
]);
/** Spec §4.3 submission checklist, each item bound to the checks that must be complete. */
const CHECKLIST = Object.freeze([
  { key: 'business_problem', checks: ['business_need_missing'], field: 'business_need' },
  { key: 'measurable_value', checks: ['business_value_missing'], field: 'expected_value' },
  { key: 'business_sponsor', checks: ['sponsor_missing'], field: 'business_sponsor' },
  { key: 'it_owner', checks: ['it_owner_missing'], field: 'it_owner' },
  { key: 'priority', checks: ['priority_missing'], field: 'priority' },
  { key: 'planned_dates', checks: ['start_date_missing', 'end_date_missing', 'dates_invalid'], field: 'start_date' },
  { key: 'budget_estimate', checks: ['budget_missing_or_zero'], field: 'budget' },
  { key: 'budget_status', checks: ['budget_status_missing'], field: 'budget_status' },
  { key: 'dependencies', checks: ['dependencies_missing'], field: 'dependencies' },
  { key: 'key_risks', checks: ['key_risks_missing'], field: 'risks' },
  { key: 'decision_requirement', checks: ['decision_required_missing'], field: 'decision_required' },
  { key: 'project_status', checks: ['status_missing'], field: 'status' },
  { key: 'delivery_effort', checks: ['delivery_effort_missing'], field: 'delivery_effort' },
  { key: 'resource_requirement', checks: ['resource_demand_missing_or_zero'], field: 'avg_fte' },
  { key: 'risk_exposure', checks: ['risk_exposure_missing'], field: 'risk_exposure' },
  { key: 'delivery_lead', checks: ['delivery_lead_missing'], field: 'delivery_lead' },
]);
const NEED_PARTS = ['current_situation', 'impact', 'problem', 'required_outcome'];

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
const parse = (v, d) => { if (v == null) return d; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (_) { return d; } };
/** A real calendar day YYYY-MM-DD (a timestamp is read by its date part). */
function isDay(v) {
  const s = String(v == null ? '' : v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : NaN));

/** State of one plain field: complete | blank | tbc | na | unavailable. */
function plainState(p, col, states, { listTbc = false } = {}) {
  if (!(col in p)) return 'unavailable';
  const v = p[col];
  if (!blank(v)) return listTbc && String(v).trim() === 'tbc' ? 'tbc' : 'complete';
  const s = states[col];
  return s === 'tbc' ? 'tbc' : s === 'na' ? 'na' : 'blank';
}

function stateOf(check, p, states, risks) {
  switch (check.key) {
    case 'business_need_missing': {
      if (!('business_need' in p)) return 'unavailable';
      const n = parse(p.business_need, null);
      if (n && typeof n === 'object' && NEED_PARTS.some((k) => !blank(n[k]))) return 'complete';
      return states.business_need === 'tbc' ? 'tbc' : states.business_need === 'na' ? 'na' : 'blank';
    }
    case 'it_owner_missing': {
      // the accountable owner: a 'not applicable' owner is no owner (PROPOSED)
      if (!('owner' in p)) return 'unavailable';
      if (!blank(p.owner)) return 'complete';
      return states.owner === 'tbc' ? 'tbc' : 'blank';
    }
    case 'budget_missing_or_zero': {
      if (!('budget' in p)) return 'unavailable';
      const b = num(p.budget);
      if (b == null) return states.budget === 'tbc' ? 'tbc' : states.budget === 'na' ? 'na' : 'blank';
      if (Number.isNaN(b)) return 'blank';
      if (b === 0) return p.budget_status === 'not_budgeted' ? 'complete' : 'zero';
      return 'complete';
    }
    case 'budget_status_missing': return plainState(p, 'budget_status', states, { listTbc: true });
    case 'decision_required_missing': return plainState(p, 'decision_required', states, { listTbc: true });
    case 'dependencies_missing': {
      if (!('depends_on' in p) && !('value_states' in p)) return 'unavailable';
      if (!blank(parse(p.depends_on, []))) return 'complete';
      return states.dependencies === 'none_known' ? 'none_known' : 'blank';
    }
    case 'key_risks_missing': {
      if (!Array.isArray(risks)) return 'unavailable';
      if (risks.some((r) => (r.kind == null || r.kind === 'risk') && !r.deleted_at)) return 'complete';
      return states.risks === 'none_known' ? 'none_known' : 'blank';
    }
    case 'resource_demand_missing_or_zero': {
      if (!('avg_fte' in p) && !('peak_fte' in p)) return 'unavailable';
      const a = num(p.avg_fte), k = num(p.peak_fte);
      if ((a != null && a > 0) || (k != null && k > 0)) return 'complete';
      if (a === 0 || k === 0) return 'zero';
      const s = states.avg_fte || states.peak_fte;
      return s === 'tbc' ? 'tbc' : s === 'na' ? 'na' : 'blank';
    }
    case 'dates_invalid': {
      if (!('start_date' in p) && !('end_date' in p)) return 'unavailable';
      const s = p.start_date, e = p.end_date;
      if (!blank(s) && !isDay(s)) return 'invalid';
      if (!blank(e) && !isDay(e)) return 'invalid';
      if (blank(s) || blank(e)) return 'not_applicable';   // the two "missing" checks report the gap
      return String(s).slice(0, 10) > String(e).slice(0, 10) ? 'invalid' : 'complete';
    }
    default: return plainState(p, check.field, states);
  }
}
const COMPLETE = new Set(['complete', 'na', 'none_known']);

/**
 * Evaluate one project.
 *   project  the project row as the routes read it (value_states parsed or JSON)
 *   opts.risks  the project's RAID rows (array) — absent = unknown
 *   opts.money  false → the reader may not see money: the budget checks are left out of the evaluation entirely
 *               (scope 'without_budget'), so neither the amount nor its emptiness leaks
 * Returns { score, rag, completed, required, blocking: [keys], checks: [...], checklist: [...], scope, unknown_reason }.
 */
function evaluate(project, opts = {}) {
  const p = project || {};
  const states = parse(p.value_states, {}) || {};
  const money = opts.money !== false;
  const risks = Array.isArray(opts.risks) ? opts.risks.filter((r) => r.project_id == null || Number(r.project_id) === Number(p.id)) : opts.risks;
  const checks = [];
  for (const c of CHECKS) {
    if (c.money && !money) continue;
    const state = stateOf(c, p, states, risks);
    const complete = state === 'unavailable' || state === 'not_applicable' ? null : c.kind === 'validity' ? state === 'complete' : COMPLETE.has(state);
    const blocking = !!c.blocking && (c.kind === 'validity' ? state === 'invalid' : complete === false);
    checks.push({ key: c.key, field: c.field, kind: c.kind, required: c.kind === 'field', state, complete, blocking, blocking_rule: !!c.blocking });
  }
  const fields = checks.filter((c) => c.kind === 'field');
  const unknown = fields.filter((c) => c.complete === null);
  const required = fields.length;
  const completed = fields.filter((c) => c.complete === true).length;
  const blocking = checks.filter((c) => c.blocking).map((c) => c.key);
  // spec rule: a number with no source is unknown — one unreadable required field and the score is null
  const score = unknown.length || !required ? null : Math.floor((completed * 100) / required);
  return {
    score, completed: unknown.length ? null : completed, required: unknown.length ? null : required,
    rag: ragOf(score, blocking.length > 0), blocking, checks,
    checklist: checklistOf(checks), scope: money ? 'all' : 'without_budget',
    unknown_reason: unknown.length ? 'FIELDS_UNAVAILABLE' : null, unavailable: unknown.map((c) => c.field),
  };
}

/** RAG of a score: a blocking error overrides to RED (spec §20.2); no score → 'NA' (unknown, never green). */
function ragOf(score, hasBlocking) {
  if (hasBlocking) return 'RED';
  if (score == null) return 'NA';
  return KpiRag.rag(score, RAG_POLICY);
}

/** Spec §4.3 — each item done (true), not done (false) or unknown (null: a bound check unavailable / hidden). */
function checklistOf(checks) {
  const by = Object.fromEntries(checks.map((c) => [c.key, c]));
  return CHECKLIST.map((it) => {
    const bound = it.checks.map((k) => by[k]);
    if (bound.some((c) => !c)) return { key: it.key, field: it.field, checks: it.checks, done: null, hidden: true };
    const relevant = bound.filter((c) => c.state !== 'not_applicable');
    const done = relevant.some((c) => c.complete === false) ? false : relevant.some((c) => c.complete === null) ? null : true;
    return { key: it.key, field: it.field, checks: it.checks, done };
  });
}

/**
 * Site data-quality scores. Σ completed ÷ Σ required over the projects of the site that have a score — never a mean
 * of the project percentages. A project without a score is counted in unknown_projects; no scored project → null.
 *   rows  [{ site_id, dq }] (dq = evaluate() output)
 */
function siteScores(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const k = r.site_id == null ? null : Number(r.site_id);
    if (!by.has(k)) by.set(k, { site_id: k, projects: 0, scored_projects: 0, unknown_projects: 0, blocking_projects: 0, completed: 0, required: 0 });
    const s = by.get(k);
    s.projects += 1;
    if (r.dq && r.dq.blocking && r.dq.blocking.length) s.blocking_projects += 1;
    if (!r.dq || r.dq.score == null) { s.unknown_projects += 1; continue; }
    s.scored_projects += 1; s.completed += r.dq.completed; s.required += r.dq.required;
  }
  return [...by.values()].map((s) => {
    const score = s.required ? Math.floor((s.completed * 100) / s.required) : null;
    return { ...s, completed: s.scored_projects ? s.completed : null, required: s.scored_projects ? s.required : null, score, rag: ragOf(score, false) };
  }).sort((a, b) => (a.site_id == null) - (b.site_id == null) || (a.site_id || 0) - (b.site_id || 0));
}

/** The portfolio `dq` block: one compact entry per project + the site scores + the PROPOSED policy. */
function portfolioBlock(projects, risks, opts = {}) {
  const evals = (projects || []).map((p) => ({ id: p.id, site_id: p.site_id, dq: evaluate(p, { risks: (risks || []).filter((r) => Number(r.project_id) === Number(p.id)), money: opts.money }) }));
  return {
    proposed: true, policy: policy(),
    projects: Object.fromEntries(evals.map((e) => [e.id, { score: e.dq.score, rag: e.dq.rag, completed: e.dq.completed, required: e.dq.required, blocking: e.dq.blocking,
      missing: e.dq.checks.filter((c) => c.complete === false).map((c) => c.key), scope: e.dq.scope, unknown_reason: e.dq.unknown_reason }])),
    sites: siteScores(evals),
  };
}

/** The PROPOSED policy the numbers rest on (shown next to every score). */
function policy() {
  const p = KpiRag.POLICIES[RAG_POLICY];
  return { status: 'PROPOSED', rag_policy: RAG_POLICY, green: p.green, amber: p.amber,
    blocking_checks: CHECKS.filter((c) => c.blocking).map((c) => c.key), required_checks: CHECKS.filter((c) => c.kind === 'field').map((c) => c.key),
    completed_states: [...COMPLETE], note: 'Required set, blocking checks, value-state counting and RAG bands are PROPOSED — a PMO decision, not approved policy.' };
}

/** proposal → approval gate refusal when a blocking check fails, else null (the caller decides whether it is enforced). */
function gateRefusal(project, opts = {}) {
  const dq = evaluate(project, { risks: opts.risks, money: true });
  if (!dq.blocking.length) return null;
  return { code: 'GATE_DATA_QUALITY', error: `blocking data-quality errors must be fixed before approval: ${dq.blocking.join(', ')}`, blocking: dq.blocking };
}

module.exports = { CHECKS, CHECKLIST, RAG_POLICY, evaluate, ragOf, checklistOf, siteScores, portfolioBlock, policy, gateRefusal, isDay };
