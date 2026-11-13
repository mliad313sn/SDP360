'use strict';
// W3-GOVERNANCE (PPM parity F1–F3 / T10) — the simplified project view: KPI cards, phase strip, top risks and next
// milestones, all DERIVED from the engines (services/ppm/scheduleEngine for dates and % complete, services/ppm/evm for
// budget burn, services/ppm/projectRag for the colour). PURE: no I/O, no clock. Nothing is re-computed differently
// here — tests/ppm-w3-pure.test.js recomputes every card from the source rows and the engines (parity).
// UNKNOWN is null ("—"), never 0.
//
// Phase strip: the native lifecycle has six stages; the strip groups them into four phases. The mapping is PROPOSED
// (the W0 matrix names Initiation → Feasibility → Planning → Execution → Closure; there is no feasibility stage in the
// data, so it is not invented):
//   Initiation = proposal · Planning = approval · Execution = in_progress, on_hold · Closure = closure, closed.

const ENGINE = require('./scheduleEngine');

const PHASES = Object.freeze([
  { key: 'initiation', label: 'Initiation', stages: ['proposal'] },
  { key: 'planning', label: 'Planning', stages: ['approval'] },
  { key: 'execution', label: 'Execution', stages: ['in_progress', 'on_hold'] },
  { key: 'closure', label: 'Closure', stages: ['closure', 'closed'] },
]);
const PHASE_MAPPING_STATUS = 'PROPOSED phase mapping (stages → phases), not a PMO-approved lifecycle';
const DONE = ['done', 'cancelled'];

/** The leaf tasks of a plan (a task with children is a summary). */
function leavesOf(tasks) {
  const parents = new Set((tasks || []).map((t) => (t.parent_id == null ? null : Number(t.parent_id))).filter((x) => x != null));
  return (tasks || []).filter((t) => t && t.id != null && !parents.has(Number(t.id)));
}

/** Work-weighted % complete of the whole plan — the engine's rollupProgress over the live leaves (cancelled excluded). */
function scheduleComplete(tasks, schedule) {
  const S = schedule && Array.isArray(schedule.tasks) ? new Map(schedule.tasks.map((r) => [Number(r.id), r])) : new Map();
  const lv = leavesOf(tasks).filter((t) => t.status !== 'cancelled').map((t) => ({ ...t, _duration: S.has(Number(t.id)) && !S.get(Number(t.id)).assumed_duration ? S.get(Number(t.id)).duration_days : null }));
  return ENGINE.rollupProgress(lv);
}

/** Working days from a to b on the project calendar (b later → positive). Null when a date is missing. */
function workingDaysBetween(a, b, calendar) {
  if (!a || !b) return null;
  const cal = ENGINE.makeCalendar(calendar || null);
  return cal.ord(ENGINE.toDay(b)) - cal.ord(ENGINE.toDay(a));
}

/** Forecast finish (engine) vs baseline finish, working days. Null when either is unknown. */
function slipWorkingDays(project, schedule, calendar) {
  const fin = (schedule && schedule.project_finish) || null;
  const base = project && project.baseline_end ? String(project.baseline_end).slice(0, 10) : null;
  return fin && base ? workingDaysBetween(base, fin, calendar) : null;
}

/** Highest P × I of an open risk or issue (the RAG risk input). 0 only when the register holds rows and none is open. */
function riskScore(risks) {
  const open = (risks || []).filter((r) => r.status === 'open' && ['risk', 'issue'].includes(r.kind || 'risk'));
  const scores = open.map((r) => Number(r.probability) * Number(r.impact)).filter(Number.isFinite);
  if (scores.length) return Math.max(...scores);
  return (risks || []).length ? 0 : null;
}

/** EVM per currency → budget-burn cards (money readers only; the caller passes evm = null otherwise). */
function budgetBurn(evm) {
  if (!evm || !Array.isArray(evm.currencies)) return null;
  return evm.currencies.map((c) => {
    const m = c.measures || c;
    const ac = m.ac == null ? null : m.ac, pv = m.pv == null ? null : m.pv;
    return { currency: c.currency, ac, pv, bac: m.bac == null ? null : m.bac, burn_vs_plan: ac != null && pv != null && pv !== 0 ? Math.round((ac / pv) * 1000) / 1000 : null };
  });
}

/** The worst (lowest) index across currencies, null when none is known. */
function worstIndex(evm, key) {
  if (!evm || !Array.isArray(evm.currencies)) return null;
  const v = evm.currencies.map((c) => { const i = c.indicators || c; return i[key]; }).filter((x) => x != null && Number.isFinite(Number(x))).map(Number);
  return v.length ? Math.min(...v) : null;
}

/**
 * @param {{project:object, tasks:object[], milestones:object[], risks:object[], schedule:object|null, evm:object|null,
 *          rag:object|null, gates:Object<string,object>|null, today:string, calendar?:object}} x
 */
function projectSummary({ project, tasks, milestones, risks, schedule, evm, rag, gates, today, calendar }) {
  const sc = scheduleComplete(tasks || [], schedule);
  const openRisks = (risks || []).filter((r) => r.status === 'open' && (r.kind || 'risk') === 'risk');
  const highRisks = openRisks.filter((r) => Number(r.probability) * Number(r.impact) >= 6);
  const blocked = leavesOf(tasks || []).filter((t) => t.status === 'blocked');
  const ms = (milestones || []).filter((m) => m.status !== 'done' && m.due_date).map((m) => ({ id: Number(m.id), name: m.name, due_date: String(m.due_date).slice(0, 10), baseline_date: m.baseline_date || null, owner: m.owner || null }))
    .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : a.id - b.id));
  const upcoming = ms.filter((m) => m.due_date >= today);
  const overdue = ms.filter((m) => m.due_date < today);
  const stage = (project && project.stage) || 'proposal';
  const curIdx = PHASES.findIndex((p) => p.stages.includes(stage));
  const phase_strip = PHASES.map((p, i) => {
    const gateTo = p.stages[0];
    const g = gates && gates[gateTo] ? gates[gateTo] : null;
    return {
      key: p.key, label: p.label, stages: p.stages,
      state: i < curIdx ? 'done' : i === curIdx ? 'current' : 'upcoming',
      pct_complete: p.key === 'execution' ? (i < curIdx ? 100 : i === curIdx ? sc.progress_pct : null) : (i < curIdx ? 100 : null),
      health: i === curIdx && rag ? rag.rag : null,
      gate: g ? { defined: !!g.defined, complete: !!g.complete, refusal: g.refusal ? g.refusal.code : null } : null,
      on_hold: p.key === 'execution' && stage === 'on_hold',
    };
  });
  const top_risks = (risks || []).filter((r) => r.status === 'open').map((r) => ({ id: Number(r.id), kind: r.kind || 'risk', title: r.title, probability: Number(r.probability), impact: Number(r.impact), score: Number(r.probability) * Number(r.impact), owner: r.owner || null }))
    .filter((r) => Number.isFinite(r.score)).sort((a, b) => b.score - a.score || a.id - b.id).slice(0, 5);
  return {
    cards: {
      rag: rag ? rag.rag : null,
      schedule_complete_pct: sc.progress_pct, schedule_complete_basis: sc.basis,
      forecast_finish: (schedule && schedule.project_finish) || null,
      baseline_finish: project && project.baseline_end ? String(project.baseline_end).slice(0, 10) : null,
      slip_working_days: slipWorkingDays(project, schedule, calendar),
      budget_burn: budgetBurn(evm),
      active_risks: openRisks.length, high_risks: highRisks.length, blocked_tasks: blocked.length,
      next_milestone: upcoming[0] || null, overdue_milestones: overdue.length,
    },
    phase_strip, phase_mapping_status: PHASE_MAPPING_STATUS,
    top_risks, next_milestones: upcoming.slice(0, 3),
  };
}

module.exports = { projectSummary, scheduleComplete, slipWorkingDays, riskScore, budgetBurn, worstIndex, workingDaysBetween, leavesOf, PHASES, PHASE_MAPPING_STATUS };
