'use strict';
// PORTFOLIO LOT 4 (IT portfolio reconstruction spec §14) — the decision agenda. PURE: no I/O, no clock (today passed in).
// Used by routes/governanceDecisionAgenda.js only while report_config ppm_decision_agenda_enabled = '1' (PROPOSED,
// default '0'). ADR: docs/ai-decisions/ADR-PORTFOLIO-LOT4-decision-agenda-alerts.md
//
// A project with "decision required" = yes or tbc (Lot 1 intake field) is on the agenda together with the decision
// records LINKED to it (decisions.project_id, migration 121 — the existing DEC-YYYY-NNN register, no parallel store).
// A project that has an open linked decision is on the agenda whatever its flag says.
// Ordering (PROPOSED): "required but not recorded" first, then projects with an overdue open decision, then by the
// next due date (unknown last). A null due date is never overdue. The intake switch off → UNKNOWN (no rows, a reason),
// never an empty "all clear".

const OPEN = ['open', 'in_progress', 'awaiting_confirmation'];   // services/decisionLifecycle OPEN_STATUSES
const CLOSED_STATUS = ['done', 'cancelled'];
const OUTCOMES = ['approved', 'rejected', 'deferred', 'approved_with_conditions', 'escalated'];   // PROPOSED vocabulary
const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const day = (v) => { const s = blank(v) ? null : String(v).slice(0, 10); return s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s ? s : null; };

function decisionView(d, today) {
  const due = day(d.due_date); const open = OPEN.includes(d.status);
  return { id: Number(d.id), ref: d.ref || null, title: d.title || null, owner: blank(d.owner) ? null : d.owner, authority: blank(d.authority) ? null : d.authority,
    due_date: due, status: d.status || null, outcome: blank(d.outcome) ? null : d.outcome, decided_at: day(d.decided_at), session_id: d.session_id == null ? null : Number(d.session_id),
    open, overdue: open ? (due ? due < today : null) : null };
}

/**
 * projects  the readable portfolio projects (route-filtered); decisions  the readable decisions (with project_id).
 * opts.today YYYY-MM-DD, opts.intake = ppm_intake_register_enabled, opts.siteName Map(site_id → name).
 */
function buildAgenda(projects, decisions, { today, intake = false, siteName = new Map() } = {}) {
  const T = day(today); if (!T) throw new Error('buildAgenda needs today (YYYY-MM-DD)');
  if (!intake) return { rows: [], summary: null, unknown_reason: 'INTAKE_DISABLED' };
  const byProject = new Map();
  for (const d of decisions || []) { if (d == null || d.project_id == null) continue; const k = Number(d.project_id); if (!byProject.has(k)) byProject.set(k, []); byProject.get(k).push(decisionView(d, T)); }
  const rows = [];
  for (const p of projects || []) {
    if (!p || p.deleted_at || CLOSED_STATUS.includes(p.status) || p.stage === 'closed') continue;
    const ds = (byProject.get(Number(p.id)) || []).sort((a, b) => (b.open - a.open) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) || a.id - b.id);
    const flag = p.decision_required === 'yes' || p.decision_required === 'tbc' ? p.decision_required : null;
    const open = ds.filter((d) => d.open);
    if (!flag && !open.length) continue;
    const dues = open.map((d) => d.due_date).filter(Boolean).sort();
    rows.push({ project_id: Number(p.id), ref: !blank(p.project_ref) ? p.project_ref : (p.key || null), name: p.name || null, site_id: p.site_id == null ? null : Number(p.site_id),
      site: p.site_id == null ? null : (siteName.get(Number(p.site_id)) || null), owner: blank(p.owner) ? null : p.owner, stage: p.stage || null, status: p.status || null,
      decision_required: flag, decisions: ds, open: open.length, overdue: open.filter((d) => d.overdue === true).length, next_due: dues[0] || null,
      not_recorded: flag === 'yes' && ds.length === 0 });
  }
  rows.sort((a, b) => (b.not_recorded - a.not_recorded) || ((b.overdue > 0) - (a.overdue > 0)) || String(a.next_due || '9999').localeCompare(String(b.next_due || '9999')) || String(a.ref || '').localeCompare(String(b.ref || '')));
  return {
    rows, unknown_reason: null,
    summary: { projects: rows.length, required_yes: rows.filter((r) => r.decision_required === 'yes').length, required_tbc: rows.filter((r) => r.decision_required === 'tbc').length,
      open_decisions: rows.reduce((a, r) => a + r.open, 0), overdue_decisions: rows.reduce((a, r) => a + r.overdue, 0), not_recorded: rows.filter((r) => r.not_recorded).length },
  };
}

/** The project-decision record fields (spec §14). Only the keys present are returned; blank = cleared (null). */
function normaliseRecord(b) {
  const bad = (m) => Object.assign(new Error(m), { code: 'INVALID', status: 400, expose: true });
  const o = b || {}; const out = {};
  if (o.authority !== undefined) out.authority = blank(o.authority) ? null : String(o.authority).trim().slice(0, 200);
  if (o.outcome !== undefined) { if (!blank(o.outcome) && !OUTCOMES.includes(String(o.outcome))) throw bad(`outcome must be ${OUTCOMES.join(' | ')}`); out.outcome = blank(o.outcome) ? null : String(o.outcome); }
  if (o.decided_at !== undefined) { if (!blank(o.decided_at) && !day(o.decided_at)) throw bad('decided_at must be YYYY-MM-DD'); out.decided_at = blank(o.decided_at) ? null : day(o.decided_at); }
  if (out.outcome && !out.decided_at) throw bad('an outcome needs decided_at (the decision date)');
  return out;
}

module.exports = { buildAgenda, normaliseRecord, decisionView, OUTCOMES, OPEN };
