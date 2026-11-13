'use strict';
// B5 (goal programme P7, REQ B4) — change-request impact SIMULATED before approval. PURE: no I/O, no clock.
// ADR: docs/ai-decisions/ADR-P7B-timesheets-cr-simulation.md.
//
// A change request may carry TASK CHANGES (task_changes_json, migration 102): a list of
//   { task_id, duration_days?, start_date?, end_date?, depends_on?, effort_hours? }
// on EXISTING tasks of its project. simulate() runs the W1 date engine (services/ppm/scheduleEngine.schedule — the same
// engine as the project page: working days, entered start = SNET, summary rollup, typed links) TWICE: on the current
// plan and on a COPY with the changes applied. Nothing is written to the plan or the baseline here.
//
//   schedule impact  finish before → after, delta in calendar days and in working days, the critical path before /
//                    after (and whether it changed), the tasks whose early dates move, deadline breach. A change that
//                    creates a dependency cycle → { ok:false, reason:'CYCLE' } (never a guess).
//   cost impact      only where the data exists: Δ effort hours × the task's hourly rate (ppm_task_evm.cost_rate, the
//                    W1-EVM field) in its currency, summed PER CURRENCY (never across). The new effort is the stated
//                    effort_hours, else (duration change) the engine's W = D × U × h/day (recalc, task type). Unknown
//                    effort, or a task with Δ hours and no rate → that cost impact is UNKNOWN (null) with the reason —
//                    never 0. No task change touching effort → cost delta 0 is NOT claimed: by_currency is [] and
//                    status 'no_effort_change'.
// Every result carries `computed_on` = the plan fingerprint (task count + max updated stamp) given by the caller, so a
// stale simulation can be told apart.

const ENGINE = require('./scheduleEngine');

const DAY = 86400000;
const ALLOWED = ['duration_days', 'start_date', 'end_date', 'depends_on', 'effort_hours'];
const bad = (reason, error) => Object.assign(new Error(error), { code: 'INVALID', reason, status: 400 });
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

/**
 * Validate + normalise task changes against the project's live task ids. Returns [] for null/empty input.
 * @param {any} raw  array (or JSON string) of changes
 * @param {Set<number>|number[]} taskIds  live task ids of the project
 */
function normaliseTaskChanges(raw, taskIds) {
  if (raw == null || raw === '') return [];
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch (_) { throw bad('BAD_TASK_CHANGES', 'task_changes must be a JSON list'); } }
  if (!Array.isArray(list)) throw bad('BAD_TASK_CHANGES', 'task_changes must be a list');
  if (list.length > 200) throw bad('BAD_TASK_CHANGES', 'at most 200 task changes');
  const ids = new Set([...(taskIds || [])].map(Number));
  const seen = new Set();
  return list.map((c) => {
    const id = Number(c && c.task_id);
    if (!Number.isInteger(id) || !ids.has(id)) throw bad('UNKNOWN_TASK', `task ${c && c.task_id} is not a live task of this project`);
    if (seen.has(id)) throw bad('BAD_TASK_CHANGES', `task ${id} is listed twice`);
    seen.add(id);
    const out = { task_id: id };
    for (const k of Object.keys(c)) if (k !== 'task_id' && !ALLOWED.includes(k)) throw bad('BAD_TASK_CHANGES', `field ${k} cannot be changed by a change request`);
    if (c.duration_days !== undefined) { const d = num(c.duration_days); if (d == null || d < 0) throw bad('BAD_TASK_CHANGES', 'duration_days must be a number ≥ 0'); out.duration_days = d; }
    if (c.effort_hours !== undefined) { const h = num(c.effort_hours); if (h == null || h < 0) throw bad('BAD_TASK_CHANGES', 'effort_hours must be a number ≥ 0'); out.effort_hours = h; }
    for (const k of ['start_date', 'end_date']) if (c[k] !== undefined) { if (c[k] !== null && !isDay(String(c[k]))) throw bad('BAD_TASK_CHANGES', `${k} must be YYYY-MM-DD`); out[k] = c[k] == null ? null : String(c[k]); }
    if (c.depends_on !== undefined) {
      if (!Array.isArray(c.depends_on) || c.depends_on.some((x) => !ids.has(Number(x)) || Number(x) === id)) throw bad('BAD_TASK_CHANGES', 'depends_on must list other live tasks of this project');
      out.depends_on = c.depends_on.map(Number);
    }
    if (Object.keys(out).length === 1) throw bad('BAD_TASK_CHANGES', `task ${id}: nothing to change`);
    return out;
  });
}

/** The plan copy with the changes applied (pure; the input is not touched). */
function applyChanges(tasks, changes) {
  const by = new Map((changes || []).map((c) => [Number(c.task_id), c]));
  return (tasks || []).map((t) => {
    const c = by.get(Number(t.id)); if (!c) return { ...t };
    const n = { ...t };
    for (const k of ALLOWED) if (c[k] !== undefined) n[k] = Array.isArray(c[k]) ? [...c[k]] : c[k];
    if (c.depends_on !== undefined) delete n.dependency_links;   // a stated list replaces the typed links of that task
    // a stated duration with no stated end lets the engine compute the end (an AUTO task keeps its start as SNET)
    if (c.duration_days !== undefined && c.end_date === undefined && (t.schedule_mode || 'auto') !== 'manual') n.end_date = null;
    return n;
  });
}

const calDays = (a, b) => (a && b ? Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY) : null);

/** New effort of one changed task: stated → that; duration changed → engine recalc; else unchanged. null = unknown. */
function newEffort(t, c, hoursPerDay) {
  if (c.effort_hours !== undefined) return c.effort_hours;
  if (c.duration_days !== undefined) {
    const r = ENGINE.recalc({ ...t, duration_days: c.duration_days }, 'duration', { hoursPerDay });
    return r.problem ? null : num(r.effort_hours);
  }
  return num(t.effort_hours);
}

/**
 * @param {{tasks:Array, changes:Array, project?:{start_date?, finish_deadline?}, evmFields?:Object, hoursPerDay?:number, fingerprint?:string|null}} a
 * @returns {object} the simulation (stored on the change request as simulation_json)
 */
function simulate({ tasks = [], changes = [], project = {}, evmFields = {}, hoursPerDay = 8, fingerprint = null } = {}) {
  const opts = { anchor: project.start_date || null, deadline: project.finish_deadline || null, hoursPerDay };
  const live = (tasks || []).filter((t) => t && t.id != null);
  const base = { method: 'scheduleEngine.schedule on the current plan and on a copy with the task changes (W1 date engine, working days)', computed_on: fingerprint, changes: changes.length };
  if (!changes.length) return { ok: true, ...base, status: 'no_task_change', schedule: null, cost: { status: 'no_task_change', by_currency: [], unknown: [] } };
  const before = ENGINE.schedule(live, opts);
  const copy = applyChanges(live, changes);
  const after = ENGINE.schedule(copy, opts);
  if (!before) return { ok: false, ...base, reason: 'CYCLE_BEFORE', error: 'the current plan has a dependency cycle: the impact cannot be computed' };
  if (!after) return { ok: false, ...base, reason: 'CYCLE', error: 'these changes create a dependency cycle' };
  const rowsB = new Map(before.tasks.map((r) => [r.id, r])), rowsA = new Map(after.tasks.map((r) => [r.id, r]));
  const moved = [];
  for (const [id, a] of rowsA) {
    const b = rowsB.get(id); if (!b) continue;
    if (b.es_date !== a.es_date || b.ef_date !== a.ef_date) moved.push({ task_id: id, start_before: b.es_date, start_after: a.es_date, finish_before: b.ef_date, finish_after: a.ef_date, finish_delta_days: calDays(b.ef_date, a.ef_date) });
  }
  const cpB = before.critical_path, cpA = after.critical_path;
  const finishDelta = calDays(before.project_finish, after.project_finish);
  const dl = opts.deadline ? String(opts.deadline).slice(0, 10) : null;
  const schedule = {
    finish_before: before.project_finish, finish_after: after.project_finish,
    finish_delta_days: finishDelta,
    finish_delta_working_days: before.project_finish && after.project_finish ? after.length_days - before.length_days : null,
    critical_path_before: cpB, critical_path_after: cpA,
    critical_path_changed: cpB.length !== cpA.length || cpB.some((x, i) => x !== cpA[i]),
    newly_critical: cpA.filter((x) => !cpB.includes(x)),
    moved_tasks: moved.sort((x, y) => x.task_id - y.task_id),
    deadline: dl, deadline_breached_after: dl && after.project_finish ? after.project_finish > dl : null,
    warnings_after: after.warnings,
  };

  // ── cost: Δ hours × hourly rate, per currency, only where known ──────────────────────────────────────────────
  const byId = new Map(live.map((t) => [Number(t.id), t]));
  const cur = new Map(), unknown = []; let touched = 0;
  for (const c of changes) {
    if (c.effort_hours === undefined && c.duration_days === undefined) continue;
    touched += 1;
    const t = byId.get(Number(c.task_id));
    const h0 = num(t.effort_hours), h1 = newEffort(t, c, hoursPerDay);
    if (h0 == null || h1 == null) { unknown.push({ task_id: c.task_id, reason: 'effort_unknown' }); continue; }
    const dh = h1 - h0; if (dh === 0) continue;
    const f = evmFields[c.task_id] || evmFields[String(c.task_id)] || {};
    const rate = num(f.cost_rate), ccy = f.cost_currency && /^[A-Z]{3}$/.test(f.cost_currency) ? f.cost_currency : null;
    if (rate == null || !ccy) { unknown.push({ task_id: c.task_id, reason: 'no_hourly_rate', delta_hours: r2(dh) }); continue; }
    const e = cur.get(ccy) || { currency: ccy, delta: 0, delta_hours: 0, tasks: 0 };
    e.delta += dh * rate; e.delta_hours += dh; e.tasks += 1; cur.set(ccy, e);
  }
  const by_currency = [...cur.values()].map((e) => ({ ...e, delta: r2(e.delta), delta_hours: r2(e.delta_hours) })).sort((a, b) => a.currency.localeCompare(b.currency));
  const cost = touched === 0 ? { status: 'no_effort_change', by_currency: [], unknown: [] }
    : { status: unknown.length ? 'partly_unknown' : 'computed', by_currency, unknown, delta_known: unknown.length === 0,
      basis: 'Δ effort hours × ppm_task_evm.cost_rate (W1-EVM), per currency, never summed across currencies — non certifié' };
  return { ok: true, ...base, status: 'computed', schedule, cost };
}

/** Days a change request moves the baseline end when applied: the typed impact wins; else the simulated finish delta. */
function effectiveDatesImpact(cr) {
  if (cr && cr.impact_dates_days != null) return Number(cr.impact_dates_days);
  const s = cr && cr.simulation;
  return s && s.ok && s.schedule && Number.isInteger(s.schedule.finish_delta_days) && s.schedule.finish_delta_days !== 0 ? s.schedule.finish_delta_days : null;
}

module.exports = { normaliseTaskChanges, applyChanges, simulate, effectiveDatesImpact, ALLOWED };
