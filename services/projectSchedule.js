'use strict';
// G11 — native PPM scheduling rules, pure (no I/O). Used by the governance store before a write and by the
// portfolio view to compute the plan. Dates are ISO 'YYYY-MM-DD' strings; days are calendar days.
//   dependencyProblem  — a dependency must exist, belong to the same project family and never form a cycle
//   criticalPath       — longest chain of tasks through finish-to-start dependencies (forward/backward pass)
//   resourceConflicts  — the same person booked above 100 % on overlapping days
//   varianceOf         — baseline vs forecast vs actual for one task or project
//   STAGES / stageGate — proposal → approval → in_progress ⇄ on_hold → closure, each gate with its rule

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
 * Critical path over tasks with a duration (end − start + 1 days, or effort_days when dates are missing).
 * Returns null when the graph cannot be scheduled (a cycle — should be refused at write time anyway).
 * @param {Array<{id, depends_on?, start_date?, end_date?, duration_days?}>} tasks
 */
function criticalPath(tasks) {
  if (!tasks.length) return { length_days: 0, path: [], slack: {} };
  const dur = (t) => {
    if (Number.isFinite(Number(t.duration_days)) && Number(t.duration_days) > 0) return Number(t.duration_days);
    const d = t.start_date && t.end_date ? days(t.start_date, t.end_date) + 1 : NaN;
    return Number.isFinite(d) && d > 0 ? d : 1;
  };
  const byId = new Map(tasks.map((t) => [Number(t.id), t]));
  const deps = (t) => (t.depends_on || []).map(Number).filter((d) => byId.has(d));
  // topological order (Kahn)
  const indeg = new Map(tasks.map((t) => [Number(t.id), deps(t).length]));
  const succ = new Map(tasks.map((t) => [Number(t.id), []]));
  for (const t of tasks) for (const d of deps(t)) succ.get(d).push(Number(t.id));
  const order = [];
  const q = [...indeg].filter(([, n]) => n === 0).map(([k]) => k).sort((a, b) => a - b);
  while (q.length) { const n = q.shift(); order.push(n); for (const s of succ.get(n)) { indeg.set(s, indeg.get(s) - 1); if (indeg.get(s) === 0) q.push(s); } }
  if (order.length !== tasks.length) return null;
  const es = new Map(), ef = new Map();
  for (const n of order) { const t = byId.get(n); const s = Math.max(0, ...deps(t).map((d) => ef.get(d))); es.set(n, s); ef.set(n, s + dur(t)); }
  const total = Math.max(...ef.values());
  const lf = new Map(), ls = new Map();
  for (const n of [...order].reverse()) { const f = succ.get(n).length ? Math.min(...succ.get(n).map((s) => ls.get(s))) : total; lf.set(n, f); ls.set(n, f - dur(byId.get(n))); }
  const slack = {}; for (const n of order) slack[n] = ls.get(n) - es.get(n);
  // walk the zero-slack chain from a start task
  const path = []; let cur = order.find((n) => slack[n] === 0 && es.get(n) === 0);
  while (cur != null) { path.push(cur); cur = succ.get(cur).filter((s) => slack[s] === 0 && es.get(s) === ef.get(cur)).sort((a, b) => a - b)[0]; }
  return { length_days: total, path, slack };
}

/**
 * Over-allocation: for each person, days where the sum of allocation_pct of their tasks exceeds 100.
 * @param {Array<{id, owner?, start_date?, end_date?, allocation_pct?}>} tasks
 * @returns {Array<{owner, from, to, peak_pct, task_ids}>}
 */
function resourceConflicts(tasks) {
  const byOwner = new Map();
  for (const t of tasks) {
    if (!t.owner || !t.start_date || !t.end_date || ['done', 'cancelled'].includes(t.status)) continue;
    const pct = Number.isFinite(Number(t.allocation_pct)) ? Number(t.allocation_pct) : 100;
    if (pct <= 0) continue;
    const k = String(t.owner).trim().toLowerCase();
    (byOwner.get(k) || byOwner.set(k, []).get(k)).push({ id: Number(t.id), owner: t.owner, s: toMs(t.start_date), e: toMs(t.end_date), pct });
  }
  const out = [];
  for (const list of byOwner.values()) {
    const points = [...new Set(list.flatMap((x) => [x.s, x.e + DAY]))].sort((a, b) => a - b);
    let open = null;
    for (let i = 0; i < points.length - 1; i++) {
      const at = points[i];
      const active = list.filter((x) => x.s <= at && at <= x.e);
      const load = active.reduce((a, x) => a + x.pct, 0);
      if (load > 100) {
        if (!open) open = { owner: list[0].owner, from: at, to: points[i + 1] - DAY, peak_pct: load, task_ids: new Set() };
        open.to = points[i + 1] - DAY; open.peak_pct = Math.max(open.peak_pct, load); active.forEach((x) => open.task_ids.add(x.id));
      } else if (open) { out.push(open); open = null; }
    }
    if (open) out.push(open);
  }
  return out.map((c) => ({ owner: c.owner, from: new Date(c.from).toISOString().slice(0, 10), to: new Date(c.to).toISOString().slice(0, 10), peak_pct: c.peak_pct, task_ids: [...c.task_ids].sort((a, b) => a - b) }));
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
  const me = String((actor && (actor.username || actor.full_name)) || '').trim().toLowerCase();
  const owner = String(project.owner || '').trim().toLowerCase();
  if (to === 'approval' && !(project.charter && String(project.charter).trim().length >= 20)) return { code: 'GATE_CHARTER', error: 'a charter (objective, scope, benefits — 20+ characters) is required before approval' };
  if (to === 'in_progress' && from === 'approval') {
    if (!project.sponsor) return { code: 'GATE_SPONSOR', error: 'a sponsor is required' };
    if (!project.start_date || !project.end_date || !project.baseline_end) return { code: 'GATE_BASELINE', error: 'start, end and baseline end dates are required (the baseline is frozen at approval)' };
    if (me && owner && me === owner) return { code: 'GATE_SOD', error: 'the project owner cannot approve their own project' };
  }
  if (to === 'closure' && Number(ctx.openTasks) > 0) return { code: 'GATE_OPEN_TASKS', error: `${ctx.openTasks} task(s) still open` };
  if (to === 'closed' && Number(ctx.openRisksHigh) > 0) return { code: 'GATE_OPEN_RISKS', error: `${ctx.openRisksHigh} high risk(s) still open` };
  if ((to === 'on_hold' || (from === 'closure' && to === 'in_progress')) && !(ctx.note && String(ctx.note).trim().length >= 10)) return { code: 'GATE_REASON', error: 'a reason (10+ characters) is required' };
  return null;
}

module.exports = { dependencyProblem, criticalPath, resourceConflicts, varianceOf, STAGES, GATES, stageGate, days };
