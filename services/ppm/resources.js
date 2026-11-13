'use strict';
// W2-ENGINE — resource pool maths (PURE: no I/O, no clock): work contours, rate tables A–E with effective dates,
// time-phased work and cost per assignment, over-allocation detection, and resource LEVELLING (delay-only,
// priority-based) that explains every move. Levelling NEVER writes: it returns a proposal (delays in working days +
// one explanation per moved task); the route stores it only on an explicit "apply" with the proposal fingerprint.
//
// Data contract
//   resource   { id, name, kind: work|material|cost, max_units_pct (NULL = 100), calendar_id }
//   rate row   { resource_id, rate_table A–E, effective_from YYYY-MM-DD, standard_rate, overtime_rate, cost_per_use, currency }
//   assignment { task_id, resource_id, units_pct (material: quantity), work_hours (NULL = units × duration × h/day),
//                contour, rate_table (default A), cost_amount + cost_currency (cost resources) }
//   schedule   the result of services/ppm/scheduleEngine.schedule (tasks[].es_date / ef_date / duration_days)
// Money: every cost is per currency ({ USD: 1234.5 }), never summed across currencies; an unknown rate gives a NULL
// cost (never 0). The routes strip every cost for readers without the money right.
//
// Contours: relative weights per tenth of the task duration. The shapes are MS-Project-like, NOT MS-Project's
// certified tables, and the work is spread over the scheduled duration (MS-Project stretches a fixed-units task
// instead) — both documented in ADR-W2-ENGINE. Work is distributed in whole minutes (largest remainder), so the
// time-phased hours always add up to the assignment's work exactly.
const ENGINE = require('./scheduleEngine');

const CONTOURS = Object.freeze({
  flat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  back_loaded: [10, 15, 25, 50, 50, 75, 75, 100, 100, 100],
  front_loaded: [100, 100, 100, 75, 75, 50, 50, 25, 15, 10],
  double_peak: [25, 50, 100, 50, 25, 25, 50, 100, 50, 25],
  early_peak: [25, 50, 100, 100, 75, 50, 35, 25, 15, 10],
  late_peak: [10, 15, 25, 35, 50, 75, 100, 100, 50, 25],
  bell: [10, 20, 40, 80, 100, 100, 80, 40, 20, 10],
  turtle: [25, 50, 75, 100, 100, 100, 100, 75, 50, 25],
});
const CONTOUR_NAMES = Object.freeze(Object.keys(CONTOURS));
const RATE_TABLES = Object.freeze(['A', 'B', 'C', 'D', 'E']);
const RESOURCE_KINDS = Object.freeze(['work', 'material', 'cost']);
const DO_NOT_LEVEL = 1000;
const DEFAULT_PRIORITY = 500;

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (x) => Math.round(x * 100) / 100;

/** The weight of each of D working days for a contour (segment of the day's midpoint). */
function contourWeights(contour, D) {
  const w = CONTOURS[contour] || CONTOURS.flat;
  const out = [];
  for (let k = 0; k < D; k++) out.push(w[Math.min(9, Math.floor(((k + 0.5) * 10) / D))]);
  return out;
}
/** Split `hours` over the weights in whole minutes (largest remainder) — the parts add up exactly. */
function spread(hours, weights) {
  const total = Math.round(hours * 60);
  const sw = weights.reduce((a, b) => a + b, 0);
  if (!(sw > 0) || weights.length === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sw);
  const fl = raw.map(Math.floor);
  let rest = total - fl.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - fl[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let j = 0; j < order.length && rest > 0; j++, rest--) fl[order[j][1]]++;
  return fl.map((m) => m / 60);
}

/** The rate row in force on `day` for one resource and table (latest effective_from ≤ day), or null. */
function rateAt(rates, resourceId, table, day) {
  let best = null;
  for (const r of rates || []) {
    if (Number(r.resource_id) !== Number(resourceId) || (r.rate_table || 'A') !== (table || 'A')) continue;
    if (r.effective_from && day && String(r.effective_from) > String(day)) continue;
    if (!best || String(r.effective_from || '') > String(best.effective_from || '')) best = r;
  }
  return best;
}

/** Working days of a scheduled row in a calendar (the days a leaf task occupies). */
function taskDays(row, cal) {
  if (!row || row.summary || !row.es_date || !row.ef_date || !(row.duration_days > 0)) return [];
  const s = ENGINE.toDay(row.es_date), e = ENGINE.toDay(row.ef_date), out = [];
  for (let d = s; d <= e; d++) if (cal.isWork(d)) out.push(ENGINE.isoOf(d));
  return out;
}

/**
 * Time-phase one assignment: [{day, hours}] for a work resource (null hours when the work is unknown).
 * @returns {{days:Array<{day,hours}>, work_hours:number|null, work_source:'entered'|'units'|null}}
 */
function timephase(a, row, cal, { hoursPerDay = 8 } = {}) {
  const days = taskDays(row, cal);
  let W = num(a.work_hours), src = W == null ? null : 'entered';
  if (W == null) { const u = num(a.units_pct); if (u != null && days.length) { W = r2((u / 100) * days.length * hoursPerDay); src = 'units'; } }
  if (W == null) return { days: days.map((d) => ({ day: d, hours: null })), work_hours: null, work_source: null };
  const parts = spread(W, contourWeights(a.contour, days.length));
  return { days: days.map((d, i) => ({ day: d, hours: Math.round(parts[i] * 10000) / 10000 })), work_hours: W, work_source: src };
}

/**
 * Cost of one assignment, per currency. Work: Σ day hours × standard rate in force that day + cost per use (rate in
 * force on the first day). Material: quantity × standard rate + cost per use. Cost resource: its entered amount.
 * Returns { by_currency: {CUR: n} | null, unknown_reason }.
 */
function assignmentCost(a, resource, rates, tp, firstDay) {
  const kind = (resource && resource.kind) || 'work';
  const add = (m, cur, v) => { m[cur] = r2((m[cur] || 0) + v); };
  if (kind === 'cost') {
    const amt = num(a.cost_amount);
    return amt == null || !a.cost_currency ? { by_currency: null, unknown_reason: 'no cost amount entered' } : { by_currency: { [a.cost_currency]: r2(amt) }, unknown_reason: null };
  }
  const table = a.rate_table || 'A';
  const first = rateAt(rates, a.resource_id, table, firstDay);
  if (!first) return { by_currency: null, unknown_reason: `no rate in table ${table}` };
  const m = {};
  if (kind === 'material') {
    const q = num(a.units_pct);
    if (q == null || num(first.standard_rate) == null) return { by_currency: null, unknown_reason: 'quantity or unit rate unknown' };
    add(m, first.currency, q * Number(first.standard_rate));
  } else {
    if (!tp || tp.work_hours == null) return { by_currency: null, unknown_reason: 'work unknown' };
    for (const d of tp.days) {
      const r = rateAt(rates, a.resource_id, table, d.day);
      if (!r || num(r.standard_rate) == null) return { by_currency: null, unknown_reason: `no standard rate on ${d.day}` };
      add(m, r.currency, d.hours * Number(r.standard_rate));
    }
  }
  if (num(first.cost_per_use) != null) add(m, first.currency, Number(first.cost_per_use));
  return { by_currency: m, unknown_reason: null };
}

/** Capacity in hours of a work resource on one day (0 on a non-working day of its calendar). */
const capacityOn = (res, cal, day, hoursPerDay) => (cal.isWork(ENGINE.toDay(day)) ? ((num(res.max_units_pct) ?? 100) / 100) * hoursPerDay : 0);

/**
 * Loads + over-allocations of the WORK resources from a schedule.
 * @param {{schedule, assignments, resources, calendarOf:(taskId)=>cal, resourceCalendarOf:(resource)=>cal, hoursPerDay}} p
 * @returns {{loads:Object<string,Object<string,number>>, overallocations:Array<{resource_id, day, load_hours, capacity_hours, over_hours, task_ids}>, timephased:Object<string,object>}}
 */
function resourceLoads(p) {
  const hpd = Number(p.hoursPerDay) > 0 ? Number(p.hoursPerDay) : 8;
  const rows = new Map((p.schedule && p.schedule.tasks ? p.schedule.tasks : []).map((t) => [Number(t.id), t]));
  const res = new Map((p.resources || []).map((r) => [Number(r.id), r]));
  const loads = {}, who = {}, timephased = {};
  for (const a of p.assignments || []) {
    const r = res.get(Number(a.resource_id)); const row = rows.get(Number(a.task_id));
    if (!r || !row || row.summary) continue;
    const tp = timephase(a, row, p.calendarOf(Number(a.task_id)), { hoursPerDay: hpd });
    timephased[`${a.task_id}:${a.resource_id}`] = tp;
    if ((r.kind || 'work') !== 'work') continue;
    const L = (loads[r.id] = loads[r.id] || {}), W = (who[r.id] = who[r.id] || {});
    for (const d of tp.days) { if (d.hours == null) continue; L[d.day] = r2((L[d.day] || 0) + d.hours); (W[d.day] = W[d.day] || []).push(Number(a.task_id)); }
  }
  const overallocations = [];
  for (const [rid, L] of Object.entries(loads)) {
    const r = res.get(Number(rid)), cal = p.resourceCalendarOf(r);
    for (const day of Object.keys(L).sort()) {
      const cap = r2(capacityOn(r, cal, day, hpd));
      if (L[day] > cap + 1e-6) overallocations.push({ resource_id: Number(rid), day, load_hours: L[day], capacity_hours: cap, over_hours: r2(L[day] - cap), task_ids: [...new Set(who[rid][day])].sort((a, b) => a - b) });
    }
  }
  return { loads, overallocations, timephased };
}

/**
 * Levelling, delay-only and priority-based (serial schedule, iterated with the CPM so links and constraints hold).
 * Never moves: a summary, a manual or started task (actual start / % > 0), an MSO / MFO task, a priority-1000 task.
 * Order of service on a contended day: priority (high first) → total float (low first) → early start → id.
 * @param {{tasks, scheduleOpts, assignments, resources, calendarSpecOf:(taskId)=>spec, resourceCalendarOf:(resource)=>cal,
 *          priorityOf:(taskId)=>number, hoursPerDay?, clearExisting?:boolean, maxIterations?:number, horizonDays?:number}} p
 * Iterated at most maxIterations (default 20) times: `converged` false means the last pass still moved a task — the
 * proposal is still valid (delay-only, links kept) but more over-allocations may be solvable by levelling again.
 * @returns {{ok, delays:Object<string,number>, moves:Array, pushed:Array, unresolved:Array, remaining_overallocations:Array,
 *            iterations:number, converged:boolean, before:object, after:object}}
 */
function level(p) {
  const hpd = Number(p.hoursPerDay) > 0 ? Number(p.hoursPerDay) : 8;
  const maxIt = Number(p.maxIterations) > 0 ? Number(p.maxIterations) : 20;
  const horizon = Number(p.horizonDays) > 0 ? Number(p.horizonDays) : 1500;
  const tasks = p.tasks || [];
  const byId = new Map(tasks.map((t) => [Number(t.id), t]));
  const start = {};
  for (const t of tasks) { const v = p.clearExisting ? 0 : num(t.leveling_delay_days); if (v > 0) start[t.id] = Math.round(v); }
  const delays = { ...start };
  const calOf = (id) => ENGINE.makeCalendar(p.calendarSpecOf(Number(id)));
  const res = new Map((p.resources || []).filter((r) => (r.kind || 'work') === 'work').map((r) => [Number(r.id), r]));
  const asgByTask = new Map();
  for (const a of p.assignments || []) { if (!res.has(Number(a.resource_id))) continue; if (!asgByTask.has(Number(a.task_id))) asgByTask.set(Number(a.task_id), []); asgByTask.get(Number(a.task_id)).push(a); }
  const pri = (id) => { const v = num(p.priorityOf(Number(id))); return v == null ? DEFAULT_PRIORITY : v; };
  const preds = new Map();
  for (const t of tasks) { let d = t.depends_on; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { d = []; } } preds.set(Number(t.id), (Array.isArray(d) ? d : []).map(Number)); }
  const run = () => ENGINE.schedule(tasks, { ...p.scheduleOpts, levelingDelays: { ...delays, ...Object.fromEntries(tasks.filter((t) => !(t.id in delays)).map((t) => [t.id, 0])) } });
  const before = ENGINE.schedule(tasks, { ...p.scheduleOpts, levelingDelays: Object.fromEntries(tasks.map((t) => [t.id, start[t.id] || 0])) });
  if (!before) return { ok: false, error: 'the dependency network has a cycle' };
  const reasons = {}; const unresolved = new Map(); const stuck = new Set(); const lastStart = new Map();
  // order of service, FIXED for the whole run (so a task never chases another): priority (high first) → start in the
  // unlevelled plan → total float (low first) → id. A task served earlier keeps its capacity; a later one waits.
  const bRow0 = new Map(before.tasks.map((t) => [Number(t.id), t]));
  const rank = (id) => { const r = bRow0.get(id) || {}; return [-pri(id), String(r.es_date || ''), r.total_float ?? 0, id]; };
  const cmp = (x, y) => { const a = rank(x), b = rank(y); return a[0] - b[0] || a[1].localeCompare(b[1]) || a[2] - b[2] || a[3] - b[3]; };
  // …and never before its own predecessors (a successor served first would chase its predecessor's delays forever):
  // a priority-ordered topological order. A link to / from a summary binds every leaf under it.
  const parentOf = new Map(tasks.map((t) => [Number(t.id), t.parent_id == null ? null : Number(t.parent_id)]));
  const kids = new Map(); for (const [id, pa] of parentOf) if (pa != null) { if (!kids.has(pa)) kids.set(pa, []); kids.get(pa).push(id); }
  const leavesOf = (id, acc = []) => { const k = kids.get(id); if (!k || !k.length) acc.push(id); else for (const c of k) leavesOf(c, acc); return acc; };
  const servedSet = new Set(asgByTask.keys());
  const before2 = new Map([...servedSet].map((id) => [id, new Set()]));
  for (const id of servedSet) for (let a = id; a != null; a = parentOf.get(a)) for (const pr of preds.get(a) || []) for (const l of leavesOf(pr)) if (servedSet.has(l) && l !== id) before2.get(id).add(l);
  const serviceOrder = []; const done = new Set(); const pending = [...servedSet].sort(cmp);
  while (pending.length) {
    const k = pending.findIndex((id) => [...before2.get(id)].every((x) => done.has(x)));
    const id = pending.splice(k < 0 ? 0 : k, 1)[0];   // k < 0 only through a summary loop the CPM already ignores
    serviceOrder.push(id); done.add(id);
  }
  const why = (id, top) => {
    const a = rank(id), b = rank(top);
    if (a[0] !== b[0]) return `lower priority (${pri(id)}) than task #${top} (${pri(top)})`;
    if (a[1] !== b[1]) return `same priority, task #${top} starts earlier in the unlevelled plan (${b[1]} vs ${a[1]})`;
    if (a[2] !== b[2]) return `same priority and start, more total float (${a[2]} d) than task #${top} (${b[2]} d)`;
    return `same priority, start and float, higher id than task #${top}`;
  };
  let sched = before, it = 0, converged = false;
  const loadsOf = (s) => resourceLoads({ schedule: s, assignments: p.assignments, resources: p.resources, calendarOf: calOf, resourceCalendarOf: p.resourceCalendarOf, hoursPerDay: hpd });
  for (; it < maxIt; it++) {
    if (it > 0) {
      sched = run(); if (!sched) return { ok: false, error: 'the dependency network has a cycle' };
      // a delay the engine did not turn into a later start (a constraint or an actual pins the task) is withdrawn and the
      // task is reported, so the proposal never grows a delay that moves nothing
      for (const [id, prev] of lastStart) {
        const now = (sched.tasks.find((x) => x.id === id) || {}).es_date;
        if (now != null && now <= prev.es) { delays[id] = prev.delay; stuck.add(id); unresolved.set(id, { task_id: id, reason: 'a constraint pins the task: a levelling delay does not move it' }); }
      }
      lastStart.clear();
    }
    if (!loadsOf(sched).overallocations.length) { converged = true; break; }
    const rows = new Map(sched.tasks.map((t) => [Number(t.id), t]));
    const order = serviceOrder.map((id) => rows.get(id)).filter((r) => r && !r.summary && r.es_date);
    const placed = new Map();   // resource → day → {hours, tasks:[ids]}
    const shiftNow = new Map();   // task → working days it moved in THIS pass (own delay + inherited push), so successors follow at once
    let changed = false;
    const fits = (dayHours) => { for (const [rid, dd] of dayHours) { const r = res.get(rid), rc = p.resourceCalendarOf(r); const P = placed.get(rid); for (const [day, h] of dd) { const used = P && P.get(day) ? P.get(day).hours : 0; if (used + h > capacityOn(r, rc, day, hpd) + 1e-6) return { rid, day, used }; } } return null; };
    const demand = (row, shift) => {
      const cal = calOf(row.id), D = row.duration_days || 0, s0 = cal.ord(ENGINE.toDay(row.es_date)) + shift;
      const shifted = { ...row, es_date: ENGINE.isoOf(cal.dayOf(s0)), ef_date: ENGINE.isoOf(cal.finishOf(s0 + D) - 1) };
      const m = new Map();
      for (const a of asgByTask.get(Number(row.id))) {
        const tp = timephase(a, shifted, cal, { hoursPerDay: hpd });
        const dd = m.get(Number(a.resource_id)) || new Map();
        for (const d of tp.days) if (d.hours != null) dd.set(d.day, (dd.get(d.day) || 0) + d.hours);
        m.set(Number(a.resource_id), dd);
      }
      return m;
    };
    const place = (id, dh) => { for (const [rid, dd] of dh) { if (!placed.has(rid)) placed.set(rid, new Map()); const P = placed.get(rid); for (const [day, h] of dd) { const c = P.get(day) || { hours: 0, tasks: [] }; c.hours += h; c.tasks.push(id); P.set(day, c); } } };
    for (const row of order) {
      const t = byId.get(Number(row.id));
      // a predecessor moved this pass: start the search where the CPM will put it (exact for FS/SS on one calendar;
      // the next pass re-runs the CPM and corrects any approximation)
      const push = preds.get(Number(row.id)).reduce((a, x) => Math.max(a, shiftNow.get(x) || 0), 0);
      const d0 = demand(row, push);
      const c0 = fits(d0);
      const fixed = row.mode === 'manual' || t.actual_start || t.actual_end || num(t.progress_pct) > 0 || ['MSO', 'MFO', 'ALAP'].includes(String(t.constraint_type || '').toUpperCase()) || pri(row.id) >= DO_NOT_LEVEL || stuck.has(Number(row.id));
      if (!c0 || fixed) { place(Number(row.id), d0); if (push) shiftNow.set(Number(row.id), push); continue; }
      // alone, does it ever fit? (demand above the resource's capacity cannot be solved by a delay)
      const alone = [...d0].some(([rid, dd]) => { const r = res.get(rid), rc = p.resourceCalendarOf(r); return [...dd].some(([day, h]) => h > capacityOn(r, rc, day, hpd) + 1e-6); });
      if (alone) { unresolved.set(Number(row.id), { task_id: Number(row.id), reason: 'its own demand exceeds the resource\'s max units on a working day — a delay cannot solve it' }); place(Number(row.id), d0); if (push) shiftNow.set(Number(row.id), push); continue; }
      let s = 1, d = null;
      for (; s <= horizon; s++) { d = demand(row, push + s); if (!fits(d)) break; }
      if (s > horizon) { unresolved.set(Number(row.id), { task_id: Number(row.id), reason: `no free capacity within ${horizon} working days` }); place(Number(row.id), d0); if (push) shiftNow.set(Number(row.id), push); continue; }
      const comp = placed.get(c0.rid).get(c0.day).tasks;
      const top = comp.slice().sort(cmp)[0];
      const rule = why(Number(row.id), top);
      const r = res.get(c0.rid);
      (reasons[row.id] = reasons[row.id] || []).push({ iteration: it + 1, resource_id: c0.rid, resource_name: r.name || null, day: c0.day, load_hours: r2(c0.used + d0.get(c0.rid).get(c0.day)), capacity_hours: r2(capacityOn(r, p.resourceCalendarOf(r), c0.day, hpd)), competing: comp.map((x) => ({ task_id: x, priority: pri(x) })), delayed_working_days: s, rule });
      lastStart.set(Number(row.id), { es: row.es_date, delay: delays[row.id] || 0 });
      delays[row.id] = (delays[row.id] || 0) + s; shiftNow.set(Number(row.id), push + s); changed = true;
      place(Number(row.id), d);
    }
    if (!changed) { converged = true; break; }
  }
  const after = run();
  const bRows = new Map(before.tasks.map((t) => [Number(t.id), t]));
  const moves = [], pushed = [];
  for (const t of after.tasks) {
    const b = bRows.get(Number(t.id)); if (!b || t.summary) continue;
    const own = (delays[t.id] || 0) - (start[t.id] || 0);
    if (own > 0) moves.push({ task_id: Number(t.id), name: byId.get(Number(t.id)).name || null, from_start: b.es_date, to_start: t.es_date, from_finish: b.ef_date, to_finish: t.ef_date, leveling_delay_days: delays[t.id], added_delay_days: own, reasons: reasons[t.id] || [] });
    else if (b.es_date !== t.es_date) pushed.push({ task_id: Number(t.id), from_start: b.es_date, to_start: t.es_date, reason: 'a predecessor was delayed by levelling (links and constraints respected)' });
  }
  const outDelays = {};
  for (const t of tasks) if ((delays[t.id] || 0) !== (num(t.leveling_delay_days) || 0)) outDelays[t.id] = delays[t.id] || 0;
  return { ok: true, delays: outDelays, moves, pushed, unresolved: [...unresolved.values()], remaining_overallocations: loadsOf(after).overallocations, iterations: Math.min(it + 1, maxIt), converged, before: { project_finish: before.project_finish }, after: { project_finish: after.project_finish }, schedule: after };
}

module.exports = { CONTOURS, CONTOUR_NAMES, RATE_TABLES, RESOURCE_KINDS, DO_NOT_LEVEL, DEFAULT_PRIORITY, contourWeights, spread, rateAt, taskDays, timephase, assignmentCost, capacityOn, resourceLoads, level };
