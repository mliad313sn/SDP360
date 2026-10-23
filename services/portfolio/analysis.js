'use strict';
// Step 8 — what the portfolio SAYS: effective status (a due date passed without delivery = late), drift against the
// baseline, schedule alerts (late, dependency conflict, child beyond its parent, budget overrun), progress of each
// branch, automatic evidence from the KPI dictionary, and the governance indicators of the committee.
// Pure except evidence(), which reads the dictionary through the metrics dispatch (never a second formula).

const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const CLOSED = ['done', 'cancelled'];

function effectiveStatus(n, today) {
  if (CLOSED.includes(n.status)) return n.status;
  if (n.due_date && n.due_date < today) return 'late';
  return n.status;
}
function drift(n) { return n.due_date && n.baseline_due ? days(n.baseline_due, n.due_date) : null; }

function index(nodes) {
  const byId = new Map(nodes.map(n => [n.id, n])), kids = new Map();
  for (const n of nodes) { const k = n.parent_id || ''; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(n); }
  return { byId, kids };
}

/** Share of delivered milestones + deliverables under a node (null when it has none). */
function progressOf(node, idx) {
  let total = 0, done = 0;
  const walk = (n) => { for (const c of idx.kids.get(n.id) || []) { if (c.kind === 'milestone' || c.kind === 'deliverable') { if (c.status !== 'cancelled') { total++; if (c.status === 'done') done++; } } walk(c); } };
  walk(node);
  return total ? done / total : null;
}

/** Every alert of the tree at `today`. */
function alerts(nodes, today) {
  const idx = index(nodes), out = [];
  for (const n of nodes) {
    const st = effectiveStatus(n, today);
    if (st === 'late' && n.kind !== 'programme') out.push({ id: n.id, kind: 'late', text: `« ${n.title} » : échéance du ${n.due_date} dépassée` });
    const dr = drift(n);
    if (dr != null && dr > 14 && !CLOSED.includes(n.status)) out.push({ id: n.id, kind: 'slip', text: `« ${n.title} » : glissement de ${dr} jours par rapport à la date initiale` });
    const parent = n.parent_id && idx.byId.get(n.parent_id);
    if (parent && parent.due_date && n.due_date && n.due_date > parent.due_date) out.push({ id: n.id, kind: 'beyond-parent', text: `« ${n.title} » finit après « ${parent.title} » (${n.due_date} > ${parent.due_date})` });
    for (const depId of n.depends_on || []) {
      const dep = idx.byId.get(depId);
      if (!dep) { out.push({ id: n.id, kind: 'dependency', text: `« ${n.title} » dépend d'un élément supprimé` }); continue; }
      if (dep.status !== 'done' && dep.due_date && n.start_date && dep.due_date > n.start_date) out.push({ id: n.id, kind: 'dependency', text: `« ${n.title} » commence le ${n.start_date} mais dépend de « ${dep.title} » prévu le ${dep.due_date}` });
    }
    if (n.budget != null && n.spent != null && n.spent > n.budget) out.push({ id: n.id, kind: 'budget', text: `« ${n.title} » : dépense ${n.spent} au-delà du budget ${n.budget}` });
  }
  return out;
}

/** Evidence of every node that has an evidence metric. deps = { metrics, sites, targets, month }. */
async function evidence(nodes, deps) {
  const D = require('../metrics/dispatch'), registry = require('../metrics/registry');
  const window = D.resolveWindow({ month: deps.month });
  const out = {};
  for (const n of nodes) {
    if (!n.evidence_metric) continue;
    const def = registry.get(n.evidence_metric) || {};
    const site = n.evidence_scope && n.evidence_scope !== 'GROUP' ? (deps.sites || []).find(s => s.code === n.evidence_scope) : null;
    try {
      const r = site ? await D.computeMetric(n.evidence_metric, { site, window, targets: deps.targets }, deps.metrics)
        : await D.computeGroupMetric(n.evidence_metric, { sites: deps.sites, window, targets: deps.targets }, deps.metrics);
      const value = r && r.status === 200 ? r.value : null;
      const lower = def.direction === 'lower';
      const met = value == null || n.evidence_target == null ? null : (lower ? value <= n.evidence_target : value >= n.evidence_target);
      out[n.id] = { metric: n.evidence_metric, scope: site ? site.code : 'GROUP', value, target: n.evidence_target, unit: def.unit || '', met, month: deps.month };
    } catch (e) { out[n.id] = { metric: n.evidence_metric, error: String(e.message || e).slice(0, 160) }; }
  }
  return out;
}

/**
 * Governance indicators over [from, to]:
 *  milestones on time (delivered by their due date, among those due in the window), mean drift of milestones,
 *  request → decision delay, evidence coverage of objectives, adoption by role (distinct people acting).
 */
function governance({ nodes, rfis, logRows, users, from, to, today }) {
  const ms = nodes.filter(n => n.kind === 'milestone' && n.status !== 'cancelled');
  const due = ms.filter(n => n.due_date && n.due_date >= from && n.due_date <= to && n.due_date <= today);
  const onTime = due.filter(n => n.status === 'done' && n.done_date && n.done_date <= n.due_date);
  const drifts = ms.map(drift).filter(x => x != null);
  const decided = (rfis || []).filter(r => r.decided_at && r.decided_at.slice(0, 10) >= from && r.decided_at.slice(0, 10) <= to);
  const delays = decided.map(r => days(r.submitted_at.slice(0, 10), r.decided_at.slice(0, 10)));
  const objectives = nodes.filter(n => n.kind === 'objective');
  const roleOf = new Map((users || []).map(u => [String(u.username).toLowerCase(), [...new Set([u.role, ...(u.roles || [])].filter(Boolean))]]));
  const byRole = {};
  for (const r of logRows || []) {
    const a = String(r.actor || '').toLowerCase();
    if (!a || a === 'system' || a === 'anonymous') continue;
    for (const role of roleOf.get(a) || ['(inconnu)']) (byRole[role] = byRole[role] || new Set()).add(a);
  }
  const mean = (xs) => (xs.length ? Math.round(10 * xs.reduce((s, x) => s + x, 0) / xs.length) / 10 : null);
  return {
    window: { from, to },
    milestones_on_time: { due: due.length, on_time: onTime.length, pct: due.length ? Math.round(1000 * onTime.length / due.length) / 10 : null },
    mean_drift_days: mean(drifts),
    rfi_to_decision_days: { decided: decided.length, mean: mean(delays) },
    rfis_open: (rfis || []).filter(r => !['decided', 'rejected', 'done'].includes(r.status)).length,
    evidence_coverage: { objectives: objectives.length, with_evidence: objectives.filter(o => o.evidence_metric).length,
      pct: objectives.length ? Math.round(1000 * objectives.filter(o => o.evidence_metric).length / objectives.length) / 10 : null },
    adoption_by_role: Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, v.size]).sort((a, b) => b[1] - a[1])),
  };
}

module.exports = { effectiveStatus, drift, progressOf, alerts, evidence, governance, index };
