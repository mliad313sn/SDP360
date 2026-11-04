'use strict';
// A-27 — catalogue rule A11: PPM exceptions (PURE: no I/O; `today` is passed in). Read by
// GET /api/governance/portfolio/exceptions (the Friday queue on the cockpit) and by the nightly
// tools/governance/ppm-alerts.js (armed off: ppm_alerts_enabled = '0').
// A null or unknown date is NEVER overdue; a project closed or cancelled raises nothing.
//   task_overdue       end_date < today, status not done / cancelled
//   task_blocked       status blocked and not updated for more than blockedDays
//   unowned_task       open task without owner on an in_progress project
//   unowned_milestone  open milestone without owner on an in_progress project
//   milestone_overdue  due_date < today, not done
//   dependency_blocked an open task whose predecessor is late or blocked
//   baseline_slip      project finish later than its baseline by more than slipDays (projectSchedule.varianceOf)
//   capacity_overload  one item per conflict, only when a capacity grid is passed
const { varianceOf } = require('./projectSchedule');

const KINDS = ['task_overdue', 'task_blocked', 'unowned_task', 'unowned_milestone', 'milestone_overdue', 'dependency_blocked', 'baseline_slip', 'capacity_overload'];
const DONE = ['done', 'cancelled'];
const _iso = (v) => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const _ms = (d) => Date.parse(d + 'T00:00:00Z');
const _blank = (v) => v == null || String(v).trim() === '';

function findExceptions(view, { today, blockedDays = 5, slipDays = 10, capacity = null } = {}) {
  const T = _iso(today); if (!T) throw new Error('findExceptions needs today (YYYY-MM-DD)');
  const v = view || {};
  const projects = new Map((v.projects || []).map((p) => [Number(p.id), p]));
  const live = (p) => !!p && p.stage !== 'closed' && !DONE.includes(p.status);
  const out = [];
  const add = (kind, entity, id, p, owner, message, since) => out.push({ key: `${kind}:${entity}:${id}`, kind, entity, entity_id: id, project_id: p ? Number(p.id) : null, project_key: p ? p.key || null : null, site_id: p && p.site_id != null ? Number(p.site_id) : null, owner: _blank(owner) ? null : String(owner), message, since: since || null });
  const tasks = (v.tasks || []).filter((t) => live(projects.get(Number(t.project_id))));
  const byId = new Map(tasks.map((t) => [Number(t.id), t]));
  const isLate = (t) => !!t && !DONE.includes(t.status) && !!_iso(t.end_date) && _iso(t.end_date) < T;
  const isBlocked = (t) => !!t && t.status === 'blocked';
  for (const t of tasks) {
    const p = projects.get(Number(t.project_id)); const open = !DONE.includes(t.status); const who = t.owner || p.owner;
    const label = `${p.key || '#' + p.id} · ${t.wbs_code ? t.wbs_code + ' ' : ''}${t.name}`;
    if (isLate(t)) add('task_overdue', 'task', Number(t.id), p, who, `${label}: due ${_iso(t.end_date)}, not done`, _iso(t.end_date));
    if (isBlocked(t)) {
      const since = _iso(t.updated_at);
      if (since && (_ms(T) - _ms(since)) / 86400000 > Number(blockedDays)) add('task_blocked', 'task', Number(t.id), p, who, `${label}: blocked since ${since}`, since);
    }
    if (open && p.stage === 'in_progress' && _blank(t.owner)) add('unowned_task', 'task', Number(t.id), p, p.owner, `${label}: no owner`, null);
    if (open) {
      const pre = (Array.isArray(t.depends_on) ? t.depends_on : []).map((d) => byId.get(Number(d))).filter((x) => isLate(x) || isBlocked(x));
      if (pre.length) add('dependency_blocked', 'task', Number(t.id), p, who, `${label}: waits on ${pre.map((x) => (x.wbs_code || '#' + x.id) + (isBlocked(x) ? ' (blocked)' : ' (late)')).join(', ')}`, null);
    }
  }
  for (const m of v.milestones || []) {
    const p = projects.get(Number(m.project_id)); if (!live(p)) continue;
    const done = m.status === 'done' || !!m.done_at; if (done) continue;
    const label = `${p.key || '#' + p.id} · ◆ ${m.name}`;
    const due = _iso(m.due_date);
    if (due && due < T) add('milestone_overdue', 'milestone', Number(m.id), p, m.owner || p.owner, `${label}: due ${due}, not done`, due);
    if (p.stage === 'in_progress' && _blank(m.owner)) add('unowned_milestone', 'milestone', Number(m.id), p, p.owner, `${label}: no owner`, null);
  }
  for (const p of projects.values()) {
    if (!live(p)) continue;
    const d = varianceOf(p).finish_variance_days;
    if (d != null && d > Number(slipDays)) add('baseline_slip', 'project', Number(p.id), p, p.owner, `${p.key || '#' + p.id} ${p.name || ''}: finish ${d} d later than its baseline (${_iso(p.baseline_end)})`.replace(/\s+/g, ' '), _iso(p.baseline_end));
  }
  if (Array.isArray(capacity)) for (const c of capacity) {
    const who = String(c.owner || '').trim(); if (!who) continue;
    out.push({ key: `capacity_overload:person:${who.toLowerCase()}:${_iso(c.from) || ''}`, kind: 'capacity_overload', entity: 'person', entity_id: who.toLowerCase(), project_id: null, project_key: null, site_id: null, owner: who, message: `${who}: booked at ${c.peak_pct} % from ${_iso(c.from)} to ${_iso(c.to)}`, since: _iso(c.from) });
  }
  return out.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || String(a.key).localeCompare(String(b.key)));
}

module.exports = { findExceptions, KINDS };
