'use strict';
// A5 (P6) — decision cycle time, PURE. metric governance.decision_cycle_days (status DRAFT — the two decision KPIs
// are a committee choice, F-DATA-11; nothing here is certified).
//
//   start   = the decision's created_at (recorded in a session = proposed to the register)
//   end     = its FIRST move to 'done' in the hash-chained ledger (ppm_events, new_value 'done'); a legacy done decision
//             without any ledger row falls back to decisions.closed_at — the row says which source was used.
//   window  = decisions ADOPTED (end) inside [from, to] (inclusive, ISO dates); no window = every adopted decision.
//   value   = mean of (end − start) in days, one decimal. median and n travel with it.
// No adopted decision in the window → value null (UNKNOWN), never 0. A row whose dates cannot be read is excluded and
// counted in `unreadable` (never a 0-day cycle).

const DAY_MS = 86400000;
const _ms = (v) => { if (v == null || v === '') return null; const t = v instanceof Date ? v.getTime() : Date.parse(String(v)); return Number.isFinite(t) ? t : null; };
const _day = (t) => new Date(t).toISOString().slice(0, 10);

/** rows: [{ id, ref, created_at, adopted_at, adopted_source }] (store.decisionCycleRows). */
function cycle(rows, { from = null, to = null } = {}) {
  const per = []; let unreadable = 0;
  for (const r of rows || []) {
    if (r.adopted_at == null) continue;                       // not adopted (yet): not part of the population
    const a = _ms(r.created_at), b = _ms(r.adopted_at);
    if (a == null || b == null || b < a) { unreadable++; continue; }
    const d = _day(b);
    if ((from && d < from) || (to && d > to)) continue;
    per.push({ id: r.id, ref: r.ref, days: Math.round((b - a) / DAY_MS * 10) / 10, adopted_on: d, source: r.adopted_source || null });
  }
  if (!per.length) return { value: null, median: null, n: 0, unreadable, state: 'UNKNOWN', decisions: [] };
  const xs = per.map((p) => p.days).sort((x, y) => x - y);
  const mean = Math.round(xs.reduce((t, x) => t + x, 0) / xs.length * 10) / 10;
  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2 * 10) / 10;
  return { value: mean, median, n: per.length, unreadable, state: 'measured', decisions: per };
}

module.exports = { cycle };
