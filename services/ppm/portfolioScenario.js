'use strict';
// PORTFOLIO LOT 6 (IT portfolio reconstruction spec §33 "portfolio scenario planning") — READ-ONLY what-if at portfolio
// level, the portfolio counterpart of the change-request simulation (services/ppm/crSimulation.js, task level). PURE.
// A scenario = shift some projects by N months and/or leave some out; the answer compares baseline vs scenario for
//   (1) the monthly resource load against capacity (services/ppm/resourceDemand.monthlyLoad — the same function), and
//   (2) the project dependencies (services/ppm/structuredDependencies): a dependent that would START before its
//       predecessor ENDS, after the shifts. Nothing is ever written: no project date, no baseline, no demand line changes.
const RD = require('./resourceDemand');
const MAX_SHIFTS = 50, MAX_ABS_MONTHS = 24;
const bad = (msg, reason) => Object.assign(new Error(msg), { code: 'INVALID', reason, status: 400 });

function normalise(body, readableIds) {
  const b = body || {}; const ok = new Set((readableIds || []).map(Number));
  const shifts = {}; const exclude = new Set();
  const list = Array.isArray(b.shifts) ? b.shifts : [];
  if (list.length > MAX_SHIFTS) throw bad(`at most ${MAX_SHIFTS} shifts`, 'SCENARIO_SIZE');
  for (const s of list) {
    const id = Number(s && s.project_id), mo = Number(s && s.months);
    if (!ok.has(id)) throw bad('a shifted project is not in your portfolio', 'SCENARIO_PROJECT');
    if (!Number.isInteger(mo) || Math.abs(mo) > MAX_ABS_MONTHS) throw bad(`months must be an integer between -${MAX_ABS_MONTHS} and ${MAX_ABS_MONTHS}`, 'SCENARIO_MONTHS');
    shifts[id] = mo;
  }
  const ex = Array.isArray(b.exclude) ? b.exclude : [];
  if (ex.length > MAX_SHIFTS) throw bad(`at most ${MAX_SHIFTS} excluded projects`, 'SCENARIO_SIZE');
  for (const x of ex) { const id = Number(x); if (!ok.has(id)) throw bad('an excluded project is not in your portfolio', 'SCENARIO_PROJECT'); exclude.add(id); }
  return { shifts, exclude };
}
const shiftDay = (d, months) => { if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null; const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + months, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); return `${t.toISOString().slice(0, 8)}${String(Math.min(dd, last)).padStart(2, '0')}`; };
/** Dependency conflicts: dependent starts before its predecessor ends (both dates known, after shifts). */
function conflicts(projects, edges, { shifts = {}, exclude = new Set() } = {}) {
  const by = new Map((projects || []).map((p) => [Number(p.id), p]));
  const out = [];
  for (const e of edges || []) {
    if (exclude.has(e.from) || exclude.has(e.to)) continue;
    const a = by.get(e.from), b = by.get(e.to); if (!a || !b) continue;
    const start = shiftDay(a.start_date, shifts[e.from] || 0), predEnd = shiftDay(b.end_date, shifts[e.to] || 0);
    if (start && predEnd && start < predEnd) out.push({ project_id: e.from, predecessor_project_id: e.to, start, predecessor_end: predEnd });
  }
  return out;
}
function simulate({ projects = [], lines = [], edges = [], capacity = {}, scenario }) {
  const base = RD.monthlyLoad(lines, { capacity });
  const scen = RD.monthlyLoad(lines, { capacity, shifts: scenario.shifts, exclude: scenario.exclude });
  const bc = conflicts(projects, edges, {}), sc = conflicts(projects, edges, scenario);
  return { read_only: true, baseline: { over_capacity_cells: base.over, dependency_conflicts: bc.length, cells: base.cells }, scenario: { over_capacity_cells: scen.over, dependency_conflicts: sc.length, cells: scen.cells, conflicts: sc },
    delta: { over_capacity_cells: scen.over - base.over, dependency_conflicts: sc.length - bc.length }, shifts: scenario.shifts, excluded: [...scenario.exclude] };
}
module.exports = { MAX_SHIFTS, MAX_ABS_MONTHS, normalise, conflicts, simulate, shiftDay };
