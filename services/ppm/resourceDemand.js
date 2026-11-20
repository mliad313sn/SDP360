'use strict';
// PORTFOLIO LOT 6 (IT portfolio reconstruction spec §17, §33) — project resource demand (table ppm_project_demand,
// migration 130) and the monthly load against configurable capacity. PURE: no I/O, no clock.
// A demand line = one skill: average FTE, peak FTE (numbers only — "keep categorical demand and numeric FTE separate"),
// a resource window (YYYY-MM … YYYY-MM), internal / external, a resource owner. This is DEMAND planning at portfolio
// level; the task-level resource levelling engine (services/ppm/resources.js) is not touched and not called.
//
// Monthly load per skill = Σ average FTE of the lines active that month (peak shown alongside as Σ peak FTE). A dated
// line without an average FTE is counted per cell (unknown_lines, partial) and makes the cell's RAG 'NA' unless the
// known lines alone are already over capacity (RED is then certain) — P11 F-22.
// Capacity = report_config ppm_capacity_fte (JSON {skill: fte, "*": fte for any other skill}); '' = UNKNOWN capacity →
// utilisation null and RAG 'NA' (never green). PROPOSED thresholds (public/lib/kpiRag.js policy 'ppm-capacity', on
// capacity ÷ demand): green ≥ 1.18 (≤ ~85 % utilised), amber ≥ 1.0 (85–100 %), red below (over capacity).
const KpiRag = require('../../public/lib/kpiRag');
const RAG_POLICY = 'ppm-capacity';
const SOURCING = Object.freeze(['internal', 'external']);
const MAX_LINES = 50, MAX_MONTHS = 60;
const bad = (msg, reason) => Object.assign(new Error(msg), { code: 'INVALID', reason, status: 400 });
const isMonth = (v) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const skillKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** FTE: a finite number ≥ 0 and ≤ 100, or null. A string such as "medium" is refused (FTE is numeric only). */
function fte(v, name) {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean' || (typeof v === 'string' && (v.trim() === '' || !/^[0-9.]+$/.test(v.trim()) || (v.match(/\./g) || []).length > 1))) throw bad(`${name} must be a number of FTE (e.g. 0.5) — a category belongs in the delivery effort field`, 'FTE_NUMERIC');
  const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 100) throw bad(`${name} must be between 0 and 100`, 'FTE_RANGE');
  return Math.round(n * 100) / 100;
}
function normalise(body) {
  const b = body || {};
  const skill = String(b.skill || '').trim().slice(0, 120);
  if (skill.length < 2) throw bad('a required skill is needed (e.g. Network engineer)', 'DEMAND_SKILL');
  const avg = fte(b.avg_fte, 'avg_fte'), peak = fte(b.peak_fte, 'peak_fte');
  if (avg != null && peak != null && peak < avg) throw bad('peak_fte cannot be below avg_fte', 'FTE_PEAK');
  const start = b.start_month == null || b.start_month === '' ? null : String(b.start_month);
  const finish = b.finish_month == null || b.finish_month === '' ? null : String(b.finish_month);
  if ((start != null && !isMonth(start)) || (finish != null && !isMonth(finish))) throw bad('start_month / finish_month must be YYYY-MM', 'DATE_INVALID');
  if (start && finish && finish < start) throw bad('finish_month is before start_month', 'DATE_ORDER');
  // P11 R5-5 — a window longer than the calendar can place is refused, never silently cut
  if (start && finish && monthSpan(start, finish) > MAX_MONTHS) throw bad(`a demand window covers at most ${MAX_MONTHS} months — split the line`, 'DEMAND_WINDOW');
  const sourcing = b.sourcing == null || b.sourcing === '' ? null : String(b.sourcing);
  if (sourcing != null && !SOURCING.includes(sourcing)) throw bad('sourcing must be internal | external (empty = unknown)', 'DEMAND_SOURCING');
  const t = (v, m) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, m));
  return { skill, avg_fte: avg, peak_fte: peak, start_month: start, finish_month: finish, sourcing, owner: t(b.owner, 120), notes: t(b.notes, 2000) };
}
/** Number of calendar months from start to finish, both included. */
function monthSpan(a, b) { const [ya, ma] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma) + 1; }
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
/** The months a line occupies (bounded). A line without a full window is not placed on the calendar (unknown). */
function monthsOf(line, shift = 0) {
  if (!isMonth(line.start_month) || !isMonth(line.finish_month)) return [];
  const out = []; let m = addMonths(line.start_month, shift); const end = addMonths(line.finish_month, shift);
  while (m <= end && out.length < MAX_MONTHS) { out.push(m); m = addMonths(m, 1); }
  return out;
}
/** report_config ppm_capacity_fte → {map, problems, configured}. */
function parseCapacity(raw) {
  if (raw == null || String(raw).trim() === '') return { map: {}, problems: [], configured: false };
  let o; try { o = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return { map: {}, problems: ['ppm_capacity_fte is not valid JSON — capacity is unknown'], configured: false }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { map: {}, problems: ['ppm_capacity_fte must be an object {skill: fte}'], configured: false };
  const map = {}; const problems = [];
  for (const [k, v] of Object.entries(o)) { const n = Number(v); if (k === '__proto__' || k === 'constructor') continue; if (!Number.isFinite(n) || n < 0) { problems.push(`capacity of "${k}" is not a number ≥ 0`); continue; } map[k === '*' ? '*' : skillKey(k)] = n; }
  return { map, problems, configured: Object.keys(map).length > 0 };
}
const capOf = (cap, skill) => (Object.prototype.hasOwnProperty.call(cap, skill) ? cap[skill] : Object.prototype.hasOwnProperty.call(cap, '*') ? cap['*'] : null);
/** Capacity evaluation of one cell: demand and capacity → {utilisation_pct, ratio, rag}. */
function evaluate(demand, capacity) {
  if (capacity == null || demand == null) return { utilisation_pct: null, rag: 'NA' };
  if (demand === 0) return { utilisation_pct: 0, rag: 'GREEN' };
  if (capacity === 0) return { utilisation_pct: null, rag: 'RED' };
  const ratio = capacity / demand;
  return { utilisation_pct: Math.round((demand / capacity) * 1000) / 10, rag: KpiRag.rag(ratio, RAG_POLICY) };
}
/**
 * Monthly load: lines [{project_id, skill, avg_fte, peak_fte, start_month, finish_month}] → per skill × month.
 * shifts: {project_id: months} (scenario), exclude: Set of project ids (scenario). Lines with no avg FTE count as unknown.
 */
function monthlyLoad(lines, { capacity = {}, shifts = {}, exclude = null } = {}) {
  const cells = new Map(); const unplaced = []; const truncated = []; const months = new Set();
  for (const l of lines || []) {
    if (exclude && exclude.has(Number(l.project_id))) continue;
    const ms = monthsOf(l, Number(shifts[Number(l.project_id)]) || 0);
    if (!ms.length || l.avg_fte == null) unplaced.push({ id: l.id == null ? null : Number(l.id), project_id: Number(l.project_id), skill: l.skill, reason: !ms.length ? 'no_window' : 'no_avg_fte' });
    if (!ms.length) continue;
    // P11 F-22: a dated line with no average FTE still occupies its months — as an UNKNOWN line of the cell, so the
    // cell's sum is a partial (lower-bound) figure and its RAG cannot be green or amber.
    // a line stored before the window limit (R5-5) is placed on its first MAX_MONTHS months and SAID to be cut
    if (monthSpan(l.start_month, l.finish_month) > MAX_MONTHS) truncated.push({ id: l.id == null ? null : Number(l.id), project_id: Number(l.project_id), skill: l.skill, months_placed: ms.length, months_requested: monthSpan(l.start_month, l.finish_month) });
    const sk = skillKey(l.skill);
    for (const m of ms) {
      months.add(m); const k = sk + '|' + m;
      const c = cells.get(k) || { skill: sk, month: m, avg_fte: 0, peak_fte: 0, peak_unknown: 0, unknown_lines: 0, projects: new Set() };
      if (l.avg_fte == null) c.unknown_lines += 1; else c.avg_fte += Number(l.avg_fte);
      if (l.peak_fte == null) c.peak_unknown += 1; else c.peak_fte += Number(l.peak_fte);
      c.projects.add(Number(l.project_id)); cells.set(k, c);
    }
  }
  const out = [...cells.values()].sort((a, b) => (a.skill < b.skill ? -1 : a.skill > b.skill ? 1 : a.month < b.month ? -1 : 1)).map((c) => {
    const cap = capOf(capacity, c.skill); let ev = evaluate(Math.round(c.avg_fte * 100) / 100, cap);
    // Known demand alone already over capacity → red whatever the unknown lines hold; otherwise a partial cell is unknown.
    if (c.unknown_lines && ev.rag !== 'RED') ev = { utilisation_pct: null, rag: 'NA' };
    return { skill: c.skill, month: c.month, avg_fte: Math.round(c.avg_fte * 100) / 100, peak_fte: c.peak_unknown ? null : Math.round(c.peak_fte * 100) / 100, capacity_fte: cap, ...ev,
      unknown_lines: c.unknown_lines, partial: c.unknown_lines > 0, projects: [...c.projects].sort((a, b) => a - b) };
  });
  return { months: [...months].sort(), cells: out, unplaced, truncated, over: out.filter((c) => c.rag === 'RED').length, policy: { name: RAG_POLICY, ...KpiRag.POLICIES[RAG_POLICY] } };
}
module.exports = { SOURCING, MAX_LINES, MAX_MONTHS, monthSpan, RAG_POLICY, normalise, fte, monthsOf, parseCapacity, evaluate, monthlyLoad, skillKey, addMonths, isMonth };
