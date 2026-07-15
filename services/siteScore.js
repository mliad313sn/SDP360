'use strict';
// Composite scoreboard score — spec §4.1. Pure, deterministic, no I/O.
// Six dimensions, fixed weights summing to exactly 1.0.

const clamp = (n) => Math.max(0, Math.min(100, n));
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

const DIMS = [
  ['reviews',        0.20, (m) => clamp((num(m.pvs_held) / (num(m.pvs_target) || 1)) * 100)],
  ['resolution_pct', 0.20, (m) => { const den = num(m.resolved) + num(m.open_issues); return den === 0 ? 100 : clamp((num(m.resolved) / den) * 100); }],
  ['overdue',        0.15, (m) => clamp(100 - Math.min(100, num(m.overdue_actions_count) * 15))],
  ['inspections',    0.15, (_m, i) => clamp(Math.min(100, num(i.inspections_done) * 100))],
  ['findings',       0.15, (_m, i) => clamp(100 - Math.min(100, num(i.findings_critical_major) * 20))],
  ['signoff_pct',    0.15, (m) => clamp(num(m.signoff_pct))],
];

const MOVE_TEXT = {
  reviews:        (m) => `Hold the ${Math.max(0, num(m.pvs_target) - num(m.pvs_held))} missing department PV(s) this month`,
  resolution_pct: (m) => `Close ${num(m.open_issues)} open issue(s) still standing`,
  overdue:        (m) => `Clear ${num(m.overdue_actions_count)} overdue action(s)`,
  inspections:    () => `Complete at least one site inspection this month`,
  findings:       (_m, i) => `Resolve ${num(i.findings_critical_major)} critical/major inspection finding(s)`,
  signoff_pct:    () => `Get outstanding PVs signed off`,
};

function computeSiteScore(meetings = {}, inspection = {}, previousComposite = null) {
  const dimensions = {};
  let composite = 0;
  const gaps = [];
  for (const [key, weight, fn] of DIMS) {
    const sub = clamp(fn(meetings, inspection));
    dimensions[key] = Math.round(sub);
    composite += weight * sub;
    gaps.push({ key, weight, gain: weight * (100 - sub) });
  }
  composite = Math.round(composite);
  const rag = composite >= 70 ? 'green' : composite >= 45 ? 'amber' : 'red';

  const two_moves = gaps
    .map((g, ix) => ({ ...g, ix }))
    .filter((g) => g.gain > 0)
    .sort((a, b) => (b.gain - a.gain) || (a.ix - b.ix))
    .slice(0, 2)
    .map((g) => ({ text: MOVE_TEXT[g.key](meetings, inspection), gain_pts: Math.round(g.gain) }));

  const trend_pts = (previousComposite === null || previousComposite === undefined)
    ? null : composite - Math.round(num(previousComposite));

  return { composite, rag, trend_pts, dimensions, two_moves };
}

module.exports = { computeSiteScore, DIMS };
