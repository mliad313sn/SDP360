'use strict';
// PORTFOLIO LOT 6 (IT portfolio reconstruction spec §12, §33) — structured project dependencies. PURE: no I/O, no clock.
// A dependency row (table ppm_project_dependencies, migration 130) says "project A depends on" EITHER another portfolio
// project (predecessor_project_id) OR an external category (procurement, power, HSE approval, …) — exactly one of the
// two — with an owner, a status, a target date and a criticality. The legacy JSON portfolio_projects.depends_on stays
// READ-COMPATIBLE: the portfolio view lists its entries as source 'legacy' until tools/ppm/backfill-project-dependencies.js
// (dry run by default) has turned them into rows. Nothing here schedules anything: the task scheduler
// (services/ppm/scheduleEngine.js) is untouched; this is the project-to-project graph only (cycle check + flags).
//
// PROPOSED (a PMO decision, not approved): the external category list, the status and criticality vocabularies, and the
// data-quality flags (an external dependency without an owner, a dependency without a target date, overdue).

const EXTERNAL_CATEGORIES = Object.freeze(['procurement', 'network_infrastructure', 'civil_works', 'electrical_works', 'power', 'connectivity',
  'architecture_approval', 'cybersecurity_assessment', 'contract_approval', 'vendor_mobilization', 'hse_approval', 'other']);
const STATUSES = Object.freeze(['open', 'in_progress', 'met', 'blocked', 'cancelled']);
const CRITICALITY = Object.freeze(['low', 'medium', 'high', 'critical']);
const CLOSED = new Set(['met', 'cancelled']);

const bad = (msg, reason) => Object.assign(new Error(msg), { code: 'INVALID', reason, status: 400 });
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const txt = (v, max) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

/** Normalise a dependency body for project `projectId`. Throws INVALID with a reason code. */
function normalise(body, { projectId } = {}) {
  const b = body || {};
  const pred = b.predecessor_project_id == null || b.predecessor_project_id === '' ? null : Number(b.predecessor_project_id);
  const ext = txt(b.external_category, 40);
  if ((pred == null) === (ext == null)) throw bad('a dependency is EITHER on another project (predecessor_project_id) OR on an external category — exactly one', 'DEP_TARGET');
  if (pred != null && (!Number.isInteger(pred) || pred <= 0)) throw bad('predecessor_project_id must be a project id', 'DEP_TARGET');
  if (pred != null && projectId != null && pred === Number(projectId)) throw bad('a project cannot depend on itself', 'DEP_SELF');
  if (ext != null && !EXTERNAL_CATEGORIES.includes(ext)) throw bad('external_category must be ' + EXTERNAL_CATEGORIES.join(' | '), 'DEP_CATEGORY');
  const status = txt(b.status, 20) || 'open';
  if (!STATUSES.includes(status)) throw bad('status must be ' + STATUSES.join(' | '), 'DEP_STATUS');
  const criticality = txt(b.criticality, 20);
  if (criticality != null && !CRITICALITY.includes(criticality)) throw bad('criticality must be ' + CRITICALITY.join(' | ') + ' (empty = unknown)', 'DEP_CRITICALITY');
  const target_date = txt(b.target_date, 10);
  if (target_date != null && !isDay(target_date)) throw bad('target_date must be YYYY-MM-DD', 'DATE_INVALID');
  return { predecessor_project_id: pred, external_category: ext, description: txt(b.description, 2000), owner: txt(b.owner, 120), status, target_date, criticality };
}

/** Adjacency: dependent project id → Set of predecessor project ids (project edges only). */
function adjacency(edges) {
  const adj = new Map();
  for (const e of edges || []) {
    if (e == null || e.from == null || e.to == null) continue;
    const f = Number(e.from), t = Number(e.to);
    if (!adj.has(f)) adj.set(f, new Set());
    adj.get(f).add(t);
  }
  return adj;
}
/** True when adding from → to (from depends on to) closes a loop, i.e. `to` already (transitively) depends on `from`. */
function wouldCreateCycle(edges, from, to) {
  if (Number(from) === Number(to)) return true;
  const adj = adjacency(edges); const seen = new Set(); const stack = [Number(to)];
  while (stack.length) { const n = stack.pop(); if (n === Number(from)) return true; if (seen.has(n)) continue; seen.add(n); for (const m of adj.get(n) || []) stack.push(m); }
  return false;
}
/** Every elementary loop found by a DFS (each reported once, rotated to start at its smallest id). */
function findCycles(edges) {
  const adj = adjacency(edges); const out = []; const keys = new Set();
  const color = new Map(); const path = [];
  const visit = (n) => {
    color.set(n, 1); path.push(n);
    for (const m of adj.get(n) || []) {
      if (color.get(m) === 1) { const loop = path.slice(path.indexOf(m)); const min = Math.min(...loop); const i = loop.indexOf(min); const rot = loop.slice(i).concat(loop.slice(0, i)); const k = rot.join('>'); if (!keys.has(k)) { keys.add(k); out.push(rot); } }
      else if (!color.get(m)) visit(m);
    }
    path.pop(); color.set(n, 2);
  };
  for (const n of [...adj.keys()].sort((a, b) => a - b)) if (!color.get(n)) visit(n);
  return out;
}

/** Data-quality flags of one dependency (PROPOSED codes). today = YYYY-MM-DD. */
function dqFlags(d, { today } = {}) {
  const f = [];
  if (!d) return f;
  const open = !CLOSED.has(d.status);
  if (!d.owner) f.push(d.external_category ? 'DEP_EXTERNAL_NO_OWNER' : 'DEP_NO_OWNER');
  if (open && !d.target_date) f.push('DEP_NO_TARGET_DATE');
  if (open && d.target_date && today && d.target_date < today) f.push('DEP_OVERDUE');
  if (open && d.status === 'blocked') f.push('DEP_BLOCKED');
  return f;
}

/** The legacy depends_on JSON of a project → candidate rows (numbers / known keys → project; other text → external 'other'). */
function legacyEntries(project, { byId, byKey } = {}) {
  let raw = project && project.depends_on;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (_) { raw = raw.split(','); } }
  if (!Array.isArray(raw)) return [];
  const out = []; const seen = new Set();
  for (const v of raw) {
    if (v == null || String(v).trim() === '') continue;
    const s = String(v).trim();
    let pred = null;
    if (/^\d+$/.test(s) && (!byId || byId.has(Number(s)))) pred = Number(s);
    else if (byKey && byKey.has(s)) pred = byKey.get(s);
    const k = pred != null ? 'p' + pred : 'x' + s.toLowerCase();
    if (seen.has(k) || pred === Number(project.id)) continue; seen.add(k);
    out.push(pred != null ? { predecessor_project_id: pred, external_category: null, description: null } : { predecessor_project_id: null, external_category: 'other', description: s.slice(0, 2000) });
  }
  return out;
}
/** Dry-run plan for the backfill: the legacy entries of each project not already present as a structured row. */
function backfillPlan(projects, existing) {
  const byId = new Map((projects || []).map((p) => [Number(p.id), p]));
  const byKey = new Map((projects || []).filter((p) => p.key).map((p) => [String(p.key), Number(p.id)]));
  const have = new Set((existing || []).map((d) => `${d.project_id}|${d.predecessor_project_id != null ? 'p' + d.predecessor_project_id : 'x' + String(d.description || '').toLowerCase()}`));
  const plan = [];
  for (const p of projects || []) for (const e of legacyEntries(p, { byId, byKey })) {
    const k = `${Number(p.id)}|${e.predecessor_project_id != null ? 'p' + e.predecessor_project_id : 'x' + String(e.description || '').toLowerCase()}`;
    if (!have.has(k)) { have.add(k); plan.push({ project_id: Number(p.id), ...e, status: 'open', owner: null, target_date: null, criticality: null }); }
  }
  return plan;
}

/**
 * Portfolio view over the READABLE projects only: structured rows + legacy entries (not yet backfilled), edges between
 * readable projects, loops, flags. A predecessor the reader cannot read is shown as "another project" (no name).
 */
function portfolioView(projects, rows, { today } = {}) {
  const byId = new Map((projects || []).map((p) => [Number(p.id), p]));
  const byKey = new Map((projects || []).filter((p) => p.key).map((p) => [String(p.key), Number(p.id)]));
  const items = [];
  for (const r of rows || []) if (byId.has(Number(r.project_id))) items.push({ ...view(r, { byId, today }), source: 'structured' });
  const structured = new Set(items.map((i) => i.project_id));
  for (const p of projects || []) if (!structured.has(Number(p.id))) for (const e of legacyEntries(p, { byId, byKey })) items.push({ ...view({ id: null, project_id: Number(p.id), ...e, status: 'open' }, { byId, today }), source: 'legacy' });
  const edges = items.filter((i) => i.predecessor_project_id != null && byId.has(i.predecessor_project_id) && i.status !== 'cancelled').map((i) => ({ from: i.project_id, to: i.predecessor_project_id }));
  const by_code = {};
  for (const i of items) for (const c of i.flags) by_code[c] = (by_code[c] || 0) + 1;
  return { items, edges, cycles: findCycles(edges), flagged: items.filter((i) => i.flags.length).length, by_code };
}
/** One row as served (predecessor label only when readable). */
function view(r, { byId, today } = {}) {
  const pred = r.predecessor_project_id == null ? null : Number(r.predecessor_project_id);
  const pp = pred != null && byId ? byId.get(pred) : null;
  // P11 N-R5-4 — a predecessor the reader cannot read is "another project": neither its name NOR its id is served
  // (same rule as the loop message); predecessor_readable:false says a hidden project is there.
  return { id: r.id == null ? null : Number(r.id), project_id: Number(r.project_id), predecessor_project_id: pp || !byId ? pred : null, predecessor_label: pp ? `${pp.key || ''} — ${pp.name || ''}`.trim() : (pred != null ? null : undefined),
    predecessor_readable: pred == null ? null : !!pp, external_category: r.external_category || null, description: r.description || null, owner: r.owner || null,
    status: r.status || 'open', target_date: r.target_date || null, criticality: r.criticality || null, flags: dqFlags(r, { today }) };
}

module.exports = { EXTERNAL_CATEGORIES, STATUSES, CRITICALITY, normalise, wouldCreateCycle, findCycles, dqFlags, legacyEntries, backfillPlan, portfolioView, view, isDay };
