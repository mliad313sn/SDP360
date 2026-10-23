'use strict';
// Step 8 — the portfolio tree (programmes → objectives → projects → milestones → deliverables), table pf_nodes
// (db/postgres/reports/020_cockpit_portfolio.sql, shared with the cockpit). Validation lives here: a node's kind must
// fit under its parent's kind; dates are YYYY-MM-DD; an evidence metric must be a served dictionary key.

const { handle, newId } = require('../cockpit/store');

const KINDS = ['programme', 'objective', 'project', 'milestone', 'deliverable'];
const CHILD_OF = { programme: [null], objective: ['programme'], project: ['objective', 'programme'], milestone: ['project'], deliverable: ['milestone', 'project'] };
const STATUSES = ['not_started', 'on_track', 'at_risk', 'late', 'done', 'cancelled'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (_) { return d; } };

function row(r) {
  if (!r) return null;
  const num = (x) => (x == null ? null : Number(x));
  return { id: r.id, parent_id: r.parent_id || null, kind: r.kind, title: r.title, owner: r.owner || null, status: r.status,
    confidence: num(r.confidence), start_date: r.start_date || null, due_date: r.due_date || null, baseline_due: r.baseline_due || null,
    done_date: r.done_date || null, budget: num(r.budget), spent: num(r.spent), evidence_metric: r.evidence_metric || null,
    evidence_target: num(r.evidence_target), evidence_scope: r.evidence_scope || null, depends_on: parse(r.depends_on, []),
    risk: r.risk || null, incidents: parse(r.incidents, []), position: Number(r.position) || 0, updated_by: r.updated_by, updated_at: r.updated_at };
}

async function list() {
  const { H } = handle();
  return (await H.prepare(`SELECT * FROM pf_nodes ORDER BY position, title`).all()).map(row);
}
async function get(id) {
  const { H } = handle();
  return row(await H.prepare(`SELECT * FROM pf_nodes WHERE id = ?`).get(id));
}

/** Validate a node against the tree. Returns { errors, node }. */
async function validate(input, { existing, servedMetrics } = {}) {
  const d = input || {}, errors = [];
  const n = {};
  n.kind = KINDS.includes(d.kind) ? d.kind : (existing && existing.kind);
  if (!n.kind) errors.push('kind: one of ' + KINDS.join(', '));
  n.parent_id = d.parent_id === undefined ? (existing ? existing.parent_id : null) : (d.parent_id || null);
  const parent = n.parent_id ? await get(n.parent_id) : null;
  if (n.parent_id && !parent) errors.push('parent_id: unknown node');
  if (n.kind && !CHILD_OF[n.kind].includes(parent ? parent.kind : null)) errors.push(`a ${n.kind} goes under ${CHILD_OF[n.kind].map(k => k || 'the root').join(' or ')}`);
  if (existing && n.parent_id) {   // no cycle
    let p = parent;
    while (p) { if (p.id === existing.id) { errors.push('parent_id: a node cannot be under itself'); break; } p = p.parent_id ? await get(p.parent_id) : null; }
  }
  const pick = (k, f) => (d[k] === undefined ? (existing ? existing[k] : null) : f(d[k]));
  n.title = pick('title', v => str(v, 160));
  if (!n.title) errors.push('title: empty');
  if (/[<>]/.test(n.title || '')) errors.push('title: HTML is not allowed');
  n.owner = pick('owner', v => str(v, 80) || null);
  n.status = pick('status', v => (STATUSES.includes(v) ? v : 'not_started')) || 'not_started';
  n.confidence = pick('confidence', v => (v === '' || v == null ? null : Math.max(0, Math.min(100, Math.round(Number(v)) || 0))));
  for (const k of ['start_date', 'due_date', 'baseline_due', 'done_date']) {
    n[k] = pick(k, v => (v ? str(v, 10) : null));
    if (n[k] && !DATE_RE.test(n[k])) errors.push(`${k}: YYYY-MM-DD`);
  }
  if (n.start_date && n.due_date && n.start_date > n.due_date) errors.push('start_date after due_date');
  if (!n.baseline_due && n.due_date) n.baseline_due = n.due_date;   // the first due date becomes the baseline
  if (n.status === 'done' && !n.done_date) n.done_date = new Date().toISOString().slice(0, 10);
  for (const k of ['budget', 'spent']) n[k] = pick(k, v => (v === '' || v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : (errors.push(`${k}: a number`), null))));
  n.evidence_metric = pick('evidence_metric', v => str(v, 80) || null);
  if (n.evidence_metric && servedMetrics && !servedMetrics.has(n.evidence_metric)) errors.push(`evidence_metric: ${n.evidence_metric} is not a served dictionary key`);
  n.evidence_target = pick('evidence_target', v => (v === '' || v == null ? null : Number(v)));
  n.evidence_scope = pick('evidence_scope', v => str(v, 20).toUpperCase() || null);
  n.depends_on = pick('depends_on', v => (Array.isArray(v) ? v.map(x => str(x, 40)).filter(Boolean).slice(0, 20) : []));
  n.risk = pick('risk', v => str(v, 600) || null);
  n.incidents = pick('incidents', v => (Array.isArray(v) ? v.map(x => str(x, 40)).filter(Boolean).slice(0, 20) : []));
  n.position = pick('position', v => Number(v) || 0) || 0;
  return { errors, node: n };
}

/** Update node `id`, or create it (new id, or the given id with { create: true } — imports keep stable ids). */
async function save(id, n, by, opts = {}) {
  const { H } = handle();
  const t = new Date().toISOString();
  const nid = id || newId('N');
  const vals = [n.parent_id, n.kind, n.title, n.owner, n.status, n.confidence, n.start_date, n.due_date, n.baseline_due, n.done_date, n.budget, n.spent,
    n.evidence_metric, n.evidence_target, n.evidence_scope, JSON.stringify(n.depends_on || []), n.risk, JSON.stringify(n.incidents || []), n.position, by || null, t];
  if (id && !opts.create) {
    await H.prepare(`UPDATE pf_nodes SET parent_id=?, kind=?, title=?, owner=?, status=?, confidence=?, start_date=?, due_date=?, baseline_due=?, done_date=?, budget=?, spent=?,
      evidence_metric=?, evidence_target=?, evidence_scope=?, depends_on=?, risk=?, incidents=?, position=?, updated_by=?, updated_at=? WHERE id = ?`).run(...vals, id);
  } else {
    await H.prepare(`INSERT INTO pf_nodes (parent_id, kind, title, owner, status, confidence, start_date, due_date, baseline_due, done_date, budget, spent,
      evidence_metric, evidence_target, evidence_scope, depends_on, risk, incidents, position, updated_by, updated_at, id) VALUES (${new Array(22).fill('?').join(', ')})`).run(...vals, nid);
  }
  return get(nid);
}

async function remove(id) {
  const { H } = handle();
  const child = await H.prepare(`SELECT id FROM pf_nodes WHERE parent_id = ? LIMIT 1`).get(id);
  if (child) return { ok: false, error: 'This node has children: move or delete them first.' };
  await H.prepare(`DELETE FROM pf_nodes WHERE id = ?`).run(id);
  return { ok: true };
}

module.exports = { KINDS, CHILD_OF, STATUSES, list, get, validate, save, remove };
