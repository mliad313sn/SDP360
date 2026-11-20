'use strict';
// PORTFOLIO LOT 6 (IT portfolio reconstruction spec §13) — 4-level risk exposure, residual risk, due date and the
// project exposure rollup, on the EXISTING register portfolio_risks (probability 1..3 × impact 1..3; migration 130 adds
// residual_probability, residual_impact, due_date). PURE: no I/O, no clock. No second risk register.
//
// PROPOSED (a PMO decision, not approved): the score → level mapping below (score = probability × impact, 1..9):
//   1–2 low · 3–4 medium · 6 high · 9 critical. Unknown probability or impact → level null (never "low").
// Project exposure = the highest level among its OPEN risks (kind risk / issue), residual when given, else inherent.
// P11 F-23 — this file is the ONE "high risk" rule of the portfolio: isHigh(r) (open, kind risk | issue, effective level
// residual-first high | critical; unknown score → not high, never "low") is used by the Lot 3 register
// (portfolioRegister), the Lot 4 alerts (ppmAlerts high_risk), portfolioEvidence.riskView (step-8 summary, deck), and
// since r6 F-27 the project page card (projectKpis high_risks) and the stage-gate count (governanceStore.gateCounts).
// P11 F-22 — a rollup with unknown-score risks does not claim a low / medium level: level null, level_at_least = the
// highest known level, partial = true. A known high / critical is never hidden by an unknown sibling.
const LEVELS = Object.freeze(['low', 'medium', 'high', 'critical']);
const RANK = { low: 1, medium: 2, high: 3, critical: 4 };
const MAPPING = Object.freeze({ status: 'PROPOSED', rule: 'score = probability × impact (1..3 each): 1–2 low, 3–4 medium, 6 high, 9 critical', source: 'services/ppm/riskExposure.js — IT portfolio spec §13 (PROPOSED, not approved)' });
const bad = (msg, reason) => Object.assign(new Error(msg), { code: 'INVALID', reason, status: 400 });
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const sc = (v) => (v == null || v === '' ? null : Number(v));

function level(probability, impact) {
  const p = sc(probability), i = sc(impact);
  if (!Number.isInteger(p) || !Number.isInteger(i) || p < 1 || p > 3 || i < 1 || i > 3) return null;
  const s = p * i;
  return s >= 9 ? 'critical' : s >= 6 ? 'high' : s >= 3 ? 'medium' : 'low';
}
/** Normalise a residual body {residual_probability, residual_impact, due_date}; '' / null = unknown. Throws INVALID. */
function normaliseResidual(body) {
  const b = body || {};
  const one = (k) => { if (b[k] == null || b[k] === '') return null; const n = Number(b[k]); if (!Number.isInteger(n) || n < 1 || n > 3) throw bad(`${k} must be 1..3 (empty = unknown)`, 'BAD_SCORE'); return n; };
  const due = b.due_date == null || b.due_date === '' ? null : String(b.due_date);
  if (due != null && !isDay(due)) throw bad('due_date must be YYYY-MM-DD', 'DATE_INVALID');
  return { residual_probability: one('residual_probability'), residual_impact: one('residual_impact'), due_date: due };
}
// P11 r6 F-28 — case-normalised; every terminal status (not only exactly 'closed') is not open. The writers store
// open | closed only (raid.js, governanceStore); the list covers legacy / imported text.
const TERMINAL = Object.freeze(['closed', 'mitigated', 'resolved', 'cancelled', 'canceled', 'done', 'retired']);
const isOpen = (r) => !TERMINAL.includes(String(r.status || 'open').trim().toLowerCase()) && r.deleted_at == null;
const inScope = (r) => String(r.kind || 'risk').trim().toLowerCase() !== 'assumption';
/** Effective level of one risk: residual when both residual scores are known, else inherent; null when unknown. */
const effective = (r) => level(r.residual_probability, r.residual_impact) || level(r.probability, r.impact);
/** P11 F-23 — the shared high-risk predicate: open, kind risk | issue, effective level high | critical. */
const isHigh = (r) => !!r && isOpen(r) && inScope(r) && ['high', 'critical'].includes(effective(r));
/** One risk row as served (no amount: the RAID amounts stay behind their own rule in raid.js). */
function view(r, { today } = {}) {
  const inherent = level(r.probability, r.impact), residual = level(r.residual_probability, r.residual_impact);
  const open = isOpen(r);
  return { id: Number(r.id), project_id: Number(r.project_id), kind: r.kind || 'risk', title: r.title, owner: r.owner || null, status: r.status || 'open', mitigation: r.mitigation || null,
    probability: sc(r.probability), impact: sc(r.impact), exposure: inherent, residual_probability: sc(r.residual_probability), residual_impact: sc(r.residual_impact), residual_exposure: residual,
    effective_exposure: residual || inherent, due_date: r.due_date || null, overdue: !!(open && r.due_date && today && r.due_date < today) };
}
/** Project rollup over its risks (assumptions ignored). level null when no open risk carries a known level. */
function rollup(risks, { today } = {}) {
  const vs = (risks || []).filter(inScope).map((r) => view(r, { today }));
  const open = vs.filter((v) => isOpen(v));
  const counts = { low: 0, medium: 0, high: 0, critical: 0, unknown: 0 };
  let top = null;
  for (const v of open) { const l = v.effective_exposure; if (!l) { counts.unknown += 1; continue; } counts[l] += 1; if (!top || RANK[l] > RANK[top]) top = l; }
  const partial = counts.unknown > 0;
  const lvl = !partial || top === 'high' || top === 'critical' ? top : null;
  return { level: lvl, level_at_least: top, partial, unknown: counts.unknown, open: open.length, counts, overdue: open.filter((v) => v.overdue).length, items: vs };
}
/** Portfolio rollup: per readable project + totals per level. */
function portfolio(projects, risks, { today } = {}) {
  const by = new Map(); for (const r of risks || []) { const k = Number(r.project_id); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const rows = (projects || []).map((p) => { const ru = rollup(by.get(Number(p.id)) || [], { today }); return { project_id: Number(p.id), key: p.key, name: p.name, site_id: p.site_id == null ? null : Number(p.site_id), level: ru.level, level_at_least: ru.level_at_least, partial: ru.partial, unknown: ru.unknown, open: ru.open, overdue: ru.overdue, counts: ru.counts, declared: p.risk_exposure || null }; });
  const totals = { low: 0, medium: 0, high: 0, critical: 0, unknown: 0 };
  for (const r of rows) totals[r.level || 'unknown'] += 1;
  return { rows, totals, mapping: MAPPING };
}
module.exports = { LEVELS, MAPPING, TERMINAL, level, effective, isOpen, isHigh, normaliseResidual, view, rollup, portfolio };
