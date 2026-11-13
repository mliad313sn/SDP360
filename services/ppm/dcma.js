'use strict';
// W3-GOVERNANCE (PPM parity T11) — DCMA 14-point schedule quality check. PURE: no I/O, no clock, no database.
// ADR: docs/ai-decisions/ADR-W3-GOVERNANCE-executive-governance.md.
//
// Input: the project's task rows (the same rows the W1 engine reads) + the engine's schedule() result, the status date,
// the project deadline. Output: 14 points, each { id, name, metric, threshold, value, count, of, pass, details }.
// A point that cannot be measured from the data held is value = null, pass = null with the reason in `basis` —
// never "pass" and never 0. In particular, while the W2 data model is not merged:
//   • leads / lags / relationship types need `dependency_links` on at least one task → null otherwise;
//   • hard constraints need the `constraint_type` field to exist on the rows → null otherwise;
//   • resources need `assignments` or `resource_ids` on at least one task (W2 resource pool) → null otherwise
//     (a free-text owner is not resource loading);
//   • missed tasks and BEI need baseline finishes (baseline_end) → null when no task carries one;
//   • CPLI needs a project deadline → null without one.
// Thresholds are the published DCMA 14-point values (5 %, 44 working days, FS ≥ 90 %, CPLI / BEI ≥ 0.95); they are a
// reference method, not a PMO policy, and the result is a quality indicator, not an approval.

const ENGINE = require('./scheduleEngine');

const HARD = ['MSO', 'MFO', 'SNLT', 'FNLT'];
const DONE = ['done', 'cancelled'];
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
const day = (v) => (isDay(v) ? v.slice(0, 10) : null);
const has = (rows, k) => rows.some((t) => Object.prototype.hasOwnProperty.call(t, k));
function linksOf(t) {
  let v = t.dependency_links;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = null; } }
  return Array.isArray(v) ? v : [];
}
function depsOf(t) {
  let v = t.depends_on;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = []; } }
  return (Array.isArray(v) ? v : []).map(Number).filter(Number.isFinite);
}

/**
 * @param {{tasks:object[], schedule:object|null, statusDate:string, deadline?:string|null, calendar?:object|null,
 *          criticalTestDays?:number}} input
 */
function dcma14({ tasks, schedule, statusDate, deadline = null, calendar = null, criticalTestDays = 600 }) {
  const rows = (tasks || []).filter((t) => t && t.id != null);
  const parents = new Set(rows.map((t) => (t.parent_id == null ? null : Number(t.parent_id))).filter((x) => x != null));
  const leaves = rows.filter((t) => !parents.has(Number(t.id)));
  const open = leaves.filter((t) => !DONE.includes(t.status));
  const S = schedule && Array.isArray(schedule.tasks) ? new Map(schedule.tasks.map((r) => [Number(r.id), r])) : null;
  const sd = day(statusDate);
  const cal = ENGINE.makeCalendar(calendar);
  const wdBetween = (a, b) => cal.ord(ENGINE.toDay(b)) - cal.ord(ENGINE.toDay(a));
  const points = [];
  const point = (id, name, metric, threshold, o) => points.push({ id, name, metric, threshold, value: o.value === undefined ? null : o.value, count: o.count == null ? null : o.count, of: o.of == null ? null : o.of, pass: o.value == null ? null : o.pass, basis: o.basis || null, details: o.details || [] });
  const ratioPoint = (id, name, threshold, hits, of, maxPct, basis) => {
    const v = pct(hits.length, of);
    point(id, name, '% of incomplete tasks', '≤ ' + maxPct + ' %', { value: v, count: hits.length, of, pass: v != null && v <= maxPct, basis: v == null ? (basis || 'no incomplete task') : null, details: hits.map(Number) });
  };

  // all links, with their type and lag (FS lag 0 when only depends_on is held)
  const linkData = has(rows, 'dependency_links');
  const links = [];
  for (const t of rows) {
    const L = new Map(linksOf(t).map((l) => [Number(l.id), l]));
    for (const p of depsOf(t)) { const l = L.get(p) || {}; links.push({ from: p, to: Number(t.id), type: String(l.type || 'FS').toUpperCase(), lag: Number.isFinite(Number(l.lag)) ? Number(l.lag) : 0 }); }
  }
  const succ = new Set(links.map((l) => l.from)), pred = new Set(links.map((l) => l.to));

  // 1 Logic — incomplete tasks missing a predecessor or a successor (the first / last task of a chain are expected to
  // miss one side each: DCMA counts them; a project with one open start and one open finish passes at ≥ 40 tasks)
  ratioPoint(1, 'Logic', '', open.filter((t) => !pred.has(Number(t.id)) || !succ.has(Number(t.id))).map((t) => t.id), open.length, 5);
  // 2 Leads (negative lag)
  if (!linkData) point(2, 'Leads', 'links with a negative lag', '0', { basis: 'no link type / lag data held (dependency_links) — not measurable' });
  else { const h = links.filter((l) => l.lag < 0); point(2, 'Leads', 'links with a negative lag', '0', { value: h.length, count: h.length, of: links.length, pass: h.length === 0, details: h.map((l) => l.to) }); }
  // 3 Lags (positive lag)
  if (!linkData) point(3, 'Lags', '% of links with a positive lag', '≤ 5 %', { basis: 'no link type / lag data held (dependency_links) — not measurable' });
  else { const h = links.filter((l) => l.lag > 0); const v = pct(h.length, links.length); point(3, 'Lags', '% of links with a positive lag', '≤ 5 %', { value: v, count: h.length, of: links.length, pass: v != null && v <= 5, basis: v == null ? 'no link' : null, details: h.map((l) => l.to) }); }
  // 4 Relationship types (FS share)
  if (!linkData) point(4, 'Relationship types', '% of links that are finish-to-start', '≥ 90 %', { basis: 'no link type data held (dependency_links) — not measurable' });
  else { const fs = links.filter((l) => l.type === 'FS'); const v = pct(fs.length, links.length); point(4, 'Relationship types', '% of links that are finish-to-start', '≥ 90 %', { value: v, count: fs.length, of: links.length, pass: v != null && v >= 90, basis: v == null ? 'no link' : null, details: links.filter((l) => l.type !== 'FS').map((l) => l.to) }); }
  // 5 Hard constraints
  if (!has(rows, 'constraint_type')) point(5, 'Hard constraints', '% of incomplete tasks', '≤ 5 %', { basis: 'no constraint data held (constraint_type) — not measurable' });
  else ratioPoint(5, 'Hard constraints', '', open.filter((t) => HARD.includes(String(t.constraint_type || '').toUpperCase())).map((t) => t.id), open.length, 5);
  // 6 High float (> 44 working days) · 7 Negative float — from the engine
  if (!S) { point(6, 'High float', '% of incomplete tasks', '≤ 5 %', { basis: 'no schedule (dependency cycle or no dates)' }); point(7, 'Negative float', 'incomplete tasks with negative float', '0', { basis: 'no schedule (dependency cycle or no dates)' }); }
  else {
    const fl = open.map((t) => S.get(Number(t.id))).filter((r) => r && r.total_float != null);
    ratioPoint(6, 'High float', '', fl.filter((r) => r.total_float > 44).map((r) => r.id), fl.length, 5, 'no float computed');
    const neg = fl.filter((r) => r.total_float < 0);
    point(7, 'Negative float', 'incomplete tasks with negative float', '0', { value: fl.length ? neg.length : null, count: neg.length, of: fl.length, pass: neg.length === 0, basis: fl.length ? null : 'no float computed', details: neg.map((r) => r.id) });
  }
  // 8 High duration (> 44 working days) — the baseline duration when held, else the planned one
  {
    const dur = (t) => { const bs = day(t.baseline_start), be = day(t.baseline_end); if (bs && be) return wdBetween(bs, be) + 1; const r = S && S.get(Number(t.id)); return r && r.duration_days != null ? r.duration_days : (Number.isFinite(Number(t.duration_days)) && t.duration_days !== null && t.duration_days !== '' ? Number(t.duration_days) : null); };
    const known = open.filter((t) => dur(t) != null);
    ratioPoint(8, 'High duration', '', known.filter((t) => dur(t) > 44).map((t) => t.id), known.length, 5, 'no duration known');
  }
  // 9 Invalid dates — forecast before the status date without an actual, or an actual after the status date
  if (!sd) point(9, 'Invalid dates', 'tasks with invalid forecast or actual dates', '0', { basis: 'no status date' });
  else {
    const bad = [];
    for (const t of leaves) {
      const r = S && S.get(Number(t.id));
      const as = day(t.actual_start), af = day(t.actual_end);
      if ((as && as > sd) || (af && af > sd)) { bad.push(t.id); continue; }
      if (DONE.includes(t.status)) continue;
      const es = r ? r.es_date : day(t.start_date), ef = r ? r.ef_date : day(t.end_date);
      if ((es && es < sd && !as) || (ef && ef < sd && !af)) bad.push(t.id);
    }
    point(9, 'Invalid dates', 'tasks with invalid forecast or actual dates', '0', { value: bad.length, count: bad.length, of: leaves.length, pass: bad.length === 0, details: bad.map(Number) });
  }
  // 10 Resources (W2 resource pool)
  if (!has(rows, 'assignments') && !has(rows, 'resource_ids')) point(10, 'Resources', 'incomplete tasks with duration and no resource', '0', { basis: 'no resource assignment data held (W2 resource pool) — not measurable' });
  else {
    const assigned = (t) => (Array.isArray(t.assignments) && t.assignments.length > 0) || (Array.isArray(t.resource_ids) && t.resource_ids.length > 0);
    const h = open.filter((t) => { const r = S && S.get(Number(t.id)); const d = r ? r.duration_days : Number(t.duration_days); return Number(d) > 0 && !assigned(t); });
    point(10, 'Resources', 'incomplete tasks with duration and no resource', '0', { value: h.length, count: h.length, of: open.length, pass: h.length === 0, details: h.map((t) => Number(t.id)) });
  }
  // 11 Missed tasks · 14 BEI — need baseline finishes due by the status date
  const due = sd ? leaves.filter((t) => day(t.baseline_end) && day(t.baseline_end) <= sd) : [];
  const anyBaseline = leaves.some((t) => day(t.baseline_end));
  const finishedOn = (t) => day(t.actual_end) || (t.status === 'done' ? day(t.end_date) : null);
  if (!sd || !anyBaseline) point(11, 'Missed tasks', '% of tasks due by the baseline that finished late or not at all', '≤ 5 %', { basis: !sd ? 'no status date' : 'no baseline finish held — not measurable' });
  else {
    const missed = due.filter((t) => { if (t.status === 'cancelled') return false; const f = finishedOn(t); return !f || f > day(t.baseline_end); });
    const v = pct(missed.length, due.length);
    point(11, 'Missed tasks', '% of tasks due by the baseline that finished late or not at all', '≤ 5 %', { value: v, count: missed.length, of: due.length, pass: v != null && v <= 5, basis: v == null ? 'no task due by the baseline yet' : null, details: missed.map((t) => Number(t.id)) });
  }
  // 12 Critical path test — lengthen one incomplete critical task; the finish must move by the same working days
  if (!S || !schedule.project_finish) point(12, 'Critical path test', 'finish moves with a delayed critical task', 'passes', { basis: 'no schedule (dependency cycle or no dates)' });
  else {
    const crit = (schedule.critical_path || []).map(Number).find((id) => { const t = rows.find((x) => Number(x.id) === id); return t && !DONE.includes(t.status) && !parents.has(id); });
    if (crit == null) point(12, 'Critical path test', 'finish moves with a delayed critical task', 'passes', { basis: 'no incomplete critical task' });
    else {
      const r = S.get(crit);
      const probe = rows.map((t) => (Number(t.id) === crit ? { ...t, duration_days: (r && r.duration_days != null ? r.duration_days : 0) + criticalTestDays, end_date: null, schedule_mode: 'auto' } : t));
      const s2 = ENGINE.schedule(probe, { anchor: schedule.anchor, deadline, calendar });
      const moved = s2 && s2.project_finish ? wdBetween(schedule.project_finish, s2.project_finish) : null;
      point(12, 'Critical path test', 'working days the finish moved for a ' + criticalTestDays + '-day delay', '= ' + criticalTestDays, { value: moved, count: moved, of: criticalTestDays, pass: moved === criticalTestDays, basis: moved == null ? 'the probe could not be scheduled' : null, details: [crit] });
    }
  }
  // 13 CPLI = (critical path length + total float to the deadline) / critical path length
  const dl = day(deadline);
  if (!S || !schedule.project_finish || !sd || !dl) point(13, 'CPLI', 'critical path length index', '≥ 0.95', { basis: !dl ? 'no project deadline — not measurable' : 'no schedule or no status date' });
  else {
    const cpl = wdBetween(sd, schedule.project_finish) + 1;
    const tf = wdBetween(schedule.project_finish, dl);
    const v = cpl > 0 ? Math.round(((cpl + tf) / cpl) * 1000) / 1000 : null;
    point(13, 'CPLI', 'critical path length index', '≥ 0.95', { value: v, pass: v != null && v >= 0.95, basis: v == null ? 'the remaining critical path is empty' : null, details: [] });
  }
  // 14 BEI = tasks finished / tasks due by the baseline (finished at any date, as DCMA counts it)
  if (!sd || !anyBaseline) point(14, 'BEI', 'baseline execution index', '≥ 0.95', { basis: !sd ? 'no status date' : 'no baseline finish held — not measurable' });
  else {
    const done = leaves.filter((t) => t.status === 'done' && (finishedOn(t) ? finishedOn(t) <= sd : true)).length;
    const v = due.length ? Math.round((done / due.length) * 1000) / 1000 : null;
    point(14, 'BEI', 'baseline execution index', '≥ 0.95', { value: v, count: done, of: due.length, pass: v != null && v >= 0.95, basis: v == null ? 'no task due by the baseline yet' : null, details: [] });
  }

  const measured = points.filter((p) => p.pass != null);
  return { points, summary: { measured: measured.length, passed: measured.filter((p) => p.pass).length, failed: measured.filter((p) => !p.pass).length, not_measurable: points.length - measured.length }, status_date: sd, method: 'DCMA 14-point assessment (published thresholds; a quality indicator, not an approval)' };
}

module.exports = { dcma14, HARD };
