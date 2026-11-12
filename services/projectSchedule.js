'use strict';
// G11 — native PPM scheduling rules, pure (no I/O). Used by the governance store before a write and by the
// portfolio view to compute the plan. Dates are ISO 'YYYY-MM-DD' strings; days are calendar days.
//   dependencyProblem  — a dependency must exist, belong to the same project family and never form a cycle
//   criticalPath       — longest chain of tasks through finish-to-start dependencies (forward/backward pass)
//   resourceConflicts  — the same person booked above 100 % on overlapping days
//   varianceOf         — baseline vs forecast vs actual for one task or project
//   STAGES / stageGate — proposal → approval → in_progress ⇄ on_hold → closure, each gate with its rule

const AC = require('../public/lib/allocationContract');
const ENGINE = require('./ppm/scheduleEngine');
const DAY = 86400000;
const toMs = (d) => (d ? Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') : NaN);
const days = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY);

/**
 * @param {Array<{id:number, depends_on?:number[]}>} items  existing items (tasks or projects)
 * @param {number|null} id                                 the item being written (null when new)
 * @param {number[]} deps                                  its proposed dependencies
 * @returns {null|{code:string, error:string}}
 */
function dependencyProblem(items, id, deps) {
  const list = (deps || []).map(Number);
  const byId = new Map(items.map((x) => [Number(x.id), x]));
  if (id != null && list.includes(Number(id))) return { code: 'DEP_SELF', error: 'an item cannot depend on itself' };
  const missing = list.filter((d) => !byId.has(d));
  if (missing.length) return { code: 'DEP_MISSING', error: `unknown dependency id(s): ${missing.join(', ')}` };
  if (new Set(list).size !== list.length) return { code: 'DEP_DUPLICATE', error: 'a dependency is listed twice' };
  if (id == null) return null;
  // cycle: can we reach `id` again by walking the proposed dependencies?
  const graph = new Map(items.map((x) => [Number(x.id), (x.depends_on || []).map(Number)]));
  graph.set(Number(id), list);
  const seen = new Set();
  const stack = [...list];
  while (stack.length) {
    const n = stack.pop();
    if (n === Number(id)) return { code: 'DEP_CYCLE', error: 'this dependency would create a cycle' };
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of graph.get(n) || []) stack.push(m);
  }
  return null;
}

/**
 * W1-ENGINE — critical path over the task network, computed by the date-based engine (services/ppm/scheduleEngine.js):
 * working days (default Mon–Fri), entered dates honoured (manual = kept, auto = start-no-earlier-than), summary tasks
 * rolled up from their children, 0-day milestones, typed links with lag. Relative days (es / ef / length_days) are
 * WORKING days from the anchor (opts.anchor, else the earliest entered start). Null when the dependencies loop.
 * `path` = every critical leaf (total float <= 0) ordered by start — all critical chains, not one walk.
 * @param {Array<{id, depends_on?, start_date?, end_date?, duration_days?}>} tasks
 * @param {object} [opts] engine options (anchor, calendar, deadline, nearCriticalDays…)
 */
function criticalPath(tasks, opts = {}) {
  if (!tasks || !tasks.length) return { length_days: 0, path: [], slack: {}, es: {}, ef: {} };
  const r = ENGINE.schedule(tasks, opts);
  if (!r) return null;
  const slack = {}, es = {}, ef = {};
  for (const t of r.tasks) { slack[t.id] = t.total_float; es[t.id] = t.es; ef[t.id] = t.ef; }
  return { length_days: r.length_days, path: r.critical_path, slack, es, ef, schedule: r };
}

/**
 * Over-allocation: for each person, days where the sum of the KNOWN allocation_pct of their tasks exceeds 100.
 * F-PRODUCT-01: the rule is public/lib/allocationContract.js — the same module the pages load. An allocation that is
 * null, '', omitted or not a number is UNKNOWN (never 0 %, never 100 %); a number outside 0..100 is invalid and
 * never summed. Both are counted by resourceCoverage, which also lists the POSSIBLE conflicts they hide.
 * @param {Array<{id, owner?, start_date?, end_date?, allocation_pct?}>} tasks
 * R2-WB-04: `members` (project team, optional) — a task with an UNKNOWN allocation reads its owner's member allocation;
 * no member = today's output, unchanged.
 * @returns {Array<{owner, from, to, peak_pct, task_ids}>}
 */
function resourceConflicts(tasks, members) { return AC.conflicts(AC.withMembers(tasks || [], members)); }
/** @returns {{tasks, known, unknown, invalid, unassigned, undated, closed, invalid_task_ids, possible_conflicts}} */
function resourceCoverage(tasks, members) { return AC.coverage(AC.withMembers(tasks || [], members)); }

/**
 * R2-WB-02 — planned vs actual hours per task. planned = effort_hours (null when not entered); actual = the sum of the
 * task's time entries, NULL when the task has no entry at all (not measured — never 0; an entry of 0 h gives 0);
 * variance = actual − planned when both are known, else null.
 * @param {Array<{id, effort_hours?}>} tasks @param {Array<{task_id, hours}>} entries
 * @returns {Array<{task_id, planned, actual, variance, entries}>}
 */
function actualHours(tasks, entries) {
  const by = new Map();
  for (const e of entries || []) {
    const h = Number(e && e.hours); if (!e || !Number.isFinite(h)) continue;
    const k = Number(e.task_id), cur = by.get(k) || { sum: 0, n: 0 };
    cur.sum += h; cur.n += 1; by.set(k, cur);
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  return (tasks || []).map((t) => {
    const p = t.effort_hours == null || t.effort_hours === '' || !Number.isFinite(Number(t.effort_hours)) ? null : Number(t.effort_hours);
    const a = by.get(Number(t.id));
    const actual = a ? r2(a.sum) : null;
    return { task_id: Number(t.id), planned: p, actual, variance: p != null && actual != null ? r2(actual - p) : null, entries: a ? a.n : 0 };
  });
}

/** Baseline vs forecast vs actual. Missing dates give null (not measured), never 0. */
function varianceOf(x) {
  const forecast = x.actual_end || x.forecast_end || x.end_date || null;
  return {
    baseline_end: x.baseline_end || null,
    forecast_end: x.actual_end ? null : (x.forecast_end || x.end_date || null),
    actual_end: x.actual_end || null,
    finish_variance_days: x.baseline_end && forecast ? days(x.baseline_end, forecast) : null,
    start_variance_days: x.baseline_start && (x.actual_start || x.start_date) ? days(x.baseline_start, x.actual_start || x.start_date) : null,
  };
}

/**
 * A-14 — the text of a charter. A structured charter is a JSON object of fields (objective, scope_in, scope_out,
 * benefits, success, constraints…): its text is the non-empty field values joined with a space, so that a JSON
 * string of EMPTY fields (always longer than 20 characters) does not pass the approval gate. Any other value
 * (plain text, existing rows) is returned unchanged.
 */
function charterText(c) {
  if (c == null) return '';
  const raw = String(c);
  let o = null;
  if (/^\s*\{/.test(raw)) { try { o = JSON.parse(raw); } catch (_) { o = null; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return raw;
  return Object.values(o).filter((v) => v != null && typeof v !== 'object').map((v) => String(v).trim()).filter(Boolean).join(' ');
}

/**
 * A-14 / W1-ENGINE — the plan as the project page draws it: ONE scheduled date set (the engine's) drives the table,
 * the Gantt bars and the critical flags. Per task: es/ef (relative working days), es_date/ef_date (the scheduled dates),
 * ls_date/lf_date, slack = total float (negative when a deadline / must-finish constraint is breached), free_float,
 * critical (total float <= 0, same flag as the critical path), near_critical, summary + rollup, computed (true when the
 * drawn dates are not the entered dates), driver (why the start is where it is), duration_days (null = unknown),
 * assumed_duration (counted as 1 day) and baseline/forecast variance. Null when a cycle.
 * @param {Array} tasks
 * @param {{anchor?: string|null, deadline?: string|null}} opts  (+ any engine option)
 */
function scheduleView(tasks, opts = {}) {
  const list = tasks || [];
  const r = ENGINE.schedule(list, opts);
  if (!r) return null;
  const byId = new Map(list.map((t) => [Number(t.id), t]));
  return {
    anchor: r.anchor,
    length_days: r.length_days,
    project_finish: r.project_finish,
    deadline: r.deadline,
    critical_path: r.critical_path,
    warnings: r.warnings,
    tasks: r.tasks.map((x) => ({ ...x, slack: x.total_float, on_path: x.critical && !x.summary, variance: varianceOf(byId.get(x.id) || {}) })),
  };
}

// Stage gates. A gate passage is recorded (who, when, note) and never edited; the rule says what the project
// must carry before it may enter the stage. Approval is a named act: the approver cannot be the project owner.
const STAGES = Object.freeze(['proposal', 'approval', 'in_progress', 'on_hold', 'closure', 'closed']);
const GATES = Object.freeze({
  proposal: ['approval'],
  approval: ['in_progress', 'proposal'],
  in_progress: ['on_hold', 'closure'],
  on_hold: ['in_progress', 'closure'],
  closure: ['closed', 'in_progress'],
  closed: [],
});
/**
 * @param {object} project  { stage, owner, charter, sponsor, baseline_end, start_date, end_date }
 * @param {string} to
 * @param {{username?:string, full_name?:string}} actor
 * @param {{openTasks?:number, openRisksHigh?:number, note?:string}} ctx
 */
function stageGate(project, to, actor, ctx = {}) {
  const from = project.stage || 'proposal';
  if (!STAGES.includes(to)) return { code: 'STAGE_UNKNOWN', error: `unknown stage ${to}` };
  if (!(GATES[from] || []).includes(to)) return { code: 'STAGE_ORDER', error: `cannot go from ${from} to ${to}` };
  // the owner is free text: it may hold the username, the full name or the e-mail — any of them counts
  // one identity rule for the whole portfolio (services/portfolioAccess.ownerMatches)
  const isOwner = require('./portfolioAccess').ownerMatches(project, actor);
  if (to === 'approval' && !(charterText(project.charter).trim().length >= 20)) return { code: 'GATE_CHARTER', error: 'a charter (objective, scope, benefits — 20+ characters) is required before approval' };
  if (to === 'in_progress' && from === 'approval') {
    if (!project.sponsor) return { code: 'GATE_SPONSOR', error: 'a sponsor is required' };
    if (!project.start_date || !project.end_date || !project.baseline_end) return { code: 'GATE_BASELINE', error: 'start, end and baseline end dates are required (the baseline is frozen at approval)' };
    if (isOwner) return { code: 'GATE_SOD', error: 'the project owner cannot approve their own project' };
  }
  if (to === 'closure' && Number(ctx.openTasks) > 0) return { code: 'GATE_OPEN_TASKS', error: `${ctx.openTasks} task(s) still open` };
  if (to === 'closed' && Number(ctx.openRisksHigh) > 0) return { code: 'GATE_OPEN_RISKS', error: `${ctx.openRisksHigh} high risk(s) still open` };
  if ((to === 'on_hold' || (from === 'closure' && to === 'in_progress')) && !(ctx.note && String(ctx.note).trim().length >= 10)) return { code: 'GATE_REASON', error: 'a reason (10+ characters) is required' };
  return null;
}

module.exports = { actualHours, charterText, scheduleView, dependencyProblem, criticalPath, resourceConflicts, resourceCoverage, varianceOf, STAGES, GATES, stageGate, days };
