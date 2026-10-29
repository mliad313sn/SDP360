'use strict';
// Step 8 — PURE portfolio computations: objective evidence from a resolved metric (generalises
// services/roadmapEvidence to any KPI of the dictionary), schedule slippage, Gantt rows with
// dependencies, risk exposure, and the monthly portfolio roll-up. No I/O; dates are ISO strings.

const DAY = 864e5;
const days = (a, b) => (a && b) ? Math.round((new Date(b) - new Date(a)) / DAY) : null;

/** value vs target → evidence % (capped 0..100); null when not measurable. hib=false means lower is better. */
function evidencePct(value, target, hib = true) {
  if (value == null || target == null || !Number.isFinite(Number(value)) || !Number.isFinite(Number(target))) return null;
  const v = Number(value), t = Number(target);
  if (hib) return t === 0 ? null : Math.max(0, Math.min(100, Math.round(v / t * 100)));
  if (v === 0) return 100;
  return Math.max(0, Math.min(100, Math.round(t / v * 100)));
}

/** Objective view: evidence (auto from metric, else manual progress), slip vs target date, confidence. */
function objectiveView(o, { metric = null, projects = [], now = new Date() } = {}) {
  const auto = metric ? evidencePct(metric.value, o.evidence_target, o.evidence_hib !== false) : null;
  const projDone = projects.length ? Math.round(projects.reduce((a, p) => a + (Number(p.progress_pct) || 0), 0) / projects.length) : null;
  const evidence_pct = auto != null ? auto : (o.progress_pct != null ? Number(o.progress_pct) : projDone);
  const latestEnd = projects.map(p => p.end_date).filter(Boolean).sort().pop() || null;
  const slip_days = o.target_date && latestEnd ? Math.max(0, days(o.target_date, latestEnd)) : null;
  const overdue = o.target_date && new Date(o.target_date) < now && (evidence_pct == null || evidence_pct < 100);
  return { id: o.id, key: o.key, name: o.name, status: o.status, confidence: o.confidence, weight: o.weight, target_date: o.target_date,
    evidence_pct, evidence_source: auto != null ? 'metric' : (o.progress_pct != null ? 'manual' : (projDone != null ? 'projects' : 'none')),
    metric: metric ? { key: metric.key, value: metric.value, unit: metric.unit, window: metric.window && metric.window.label, as_of: metric.as_of } : null, slip_days, overdue: !!overdue };
}

/** Gantt rows: one per project (+ its milestones), with slippage vs baseline and dependency alerts. */
function ganttRows(projects, milestones = [], { now = new Date() } = {}) {
  const byId = new Map(projects.map(p => [Number(p.id), p]));
  return projects.map(p => {
    const ms = milestones.filter(m => Number(m.project_id) === Number(p.id));
    const slip = p.baseline_end && p.end_date ? Math.max(0, days(p.baseline_end, p.end_date)) : 0;
    const late = p.end_date && new Date(p.end_date) < now && !['done', 'cancelled'].includes(p.status);
    const deps = (p.depends_on || []).map(Number).map(id => byId.get(id)).filter(Boolean);
    const blocked_by = deps.filter(d => d.end_date && p.start_date && d.end_date > p.start_date && !['done', 'cancelled'].includes(d.status)).map(d => d.key);
    const alerts = [];
    if (slip > 0) alerts.push(`slipped ${slip} d vs baseline`);
    if (late) alerts.push(`end date passed (${days(p.end_date, now.toISOString().slice(0, 10))} d ago)`);
    if (blocked_by.length) alerts.push(`depends on unfinished ${blocked_by.join(', ')}`);
    const msLate = ms.filter(m => m.due_date && !m.done_at && new Date(m.due_date) < now).length;
    if (msLate) alerts.push(`${msLate} milestone(s) overdue`);
    return { id: p.id, key: p.key, name: p.name, owner: p.owner, status: p.status, confidence: p.confidence, start: p.start_date, end: p.end_date, baseline_end: p.baseline_end, progress_pct: p.progress_pct,
      slip_days: slip, late: !!late, budget: p.budget, spent: p.spent, currency: p.currency || null, stage: p.stage || null, rfi_id: p.rfi_id == null ? null : p.rfi_id, depends_on: deps.map(d => d.key), alerts, milestones: ms.map(m => ({ id: m.id, name: m.name, status: m.status, due: m.due_date, baseline: m.baseline_date, done_at: m.done_at, late: !!(m.due_date && !m.done_at && new Date(m.due_date) < now) })) };
  });
}

/** Risk exposure = probability × impact (1..3 each → 1..9); open only. */
function riskView(r) { return { ...r, exposure: Number(r.probability) * Number(r.impact), severity: Number(r.probability) * Number(r.impact) >= 6 ? 'high' : Number(r.probability) * Number(r.impact) >= 3 ? 'medium' : 'low' }; }

/** Monthly roll-up per programme: weighted evidence, objectives with auto evidence (the ≥ 50 % acceptance), late projects, high risks, budget. */
function portfolioSummary({ programmes, objectiveViews, gantt, risks }) {
  return programmes.map(pr => {
    const objs = objectiveViews.filter(o => o.programme_id === pr.id);
    const w = objs.reduce((a, o) => a + (Number(o.weight) || 1), 0);
    const scored = objs.filter(o => o.evidence_pct != null);
    const weighted = scored.length ? Math.round(scored.reduce((a, o) => a + o.evidence_pct * (Number(o.weight) || 1), 0) / scored.reduce((a, o) => a + (Number(o.weight) || 1), 0)) : null;
    const projs = gantt.filter(g => objs.some(o => o.id === g.objective_id));
    const open = risks.filter(r => r.status === 'open' && projs.some(p => p.id === r.project_id)).map(riskView);
    return { programme: pr.key, name: pr.name, objectives: objs.length, auto_evidence: objs.filter(o => o.evidence_source === 'metric').length, auto_evidence_pct: objs.length ? Math.round(objs.filter(o => o.evidence_source === 'metric').length / objs.length * 100) : null,
      weighted_evidence_pct: weighted, weight_total: w, projects: projs.length, late_projects: projs.filter(p => p.late || p.slip_days > 0).length, high_risks: open.filter(r => r.severity === 'high').length,
      ...moneyRollup(projs) };
  });
}

/**
 * G12 — money roll-up per currency. Amounts in different currencies are never added together: `budget` and
 * `spent` are set only when every costed project uses one currency; otherwise they are null and the
 * per-currency totals say why. A project with no budget is not counted as 0 (budget_unknown).
 */
function moneyRollup(projs) {
  const by = {};
  let unknown = 0;
  for (const p of projs) {
    if (p.budget == null && p.spent == null) { unknown++; continue; }
    const c = p.currency || 'USD';
    const b = by[c] || (by[c] = { budget: 0, spent: 0, projects: 0 });
    b.budget += Number(p.budget) || 0; b.spent += Number(p.spent) || 0; b.projects++;
  }
  const cur = Object.keys(by);
  const one = cur.length === 1 ? by[cur[0]] : null;
  return { budget: one ? one.budget : null, spent: one ? one.spent : null, currency: one ? cur[0] : null, currency_mixed: cur.length > 1, budget_by_currency: by, budget_unknown: unknown };
}

module.exports = { moneyRollup, evidencePct, objectiveView, ganttRows, riskView, portfolioSummary };
