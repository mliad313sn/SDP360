'use strict';
// W1-INTEGRITY / A-INT-1 (PPM parity W0, P0) — PURE integrity rules for a task / project / milestone write.
// No I/O: the store reads the rows and hands them in; every refusal is { code, error } (the store throws it as a
// 400 INVALID with `reason: code`, the route answers { error, code }).
//
// Rules (refused BEFORE the write, never repaired silently):
//   dates      a date field is YYYY-MM-DD (or a full ISO timestamp) AND a real calendar day — '2026-02-30', 'soon',
//              '31/12/2026' are refused (DATE_INVALID)
//   order      end before start is refused for each pair (start/end, baseline_start/baseline_end,
//              actual_start/actual_end) — same day is allowed (a 0-day item) (DATE_ORDER)
//   hierarchy  a task cannot be its own parent (PARENT_SELF), take a parent that does not exist (PARENT_NOT_FOUND)
//              or belongs to another project (PARENT_OTHER_PROJECT), nor make a loop (PARENT_CYCLE)
//   links      a task cannot depend on one of its ancestors or descendants (DEPENDS_ON_HIERARCHY): the summary
//              rolls its children up, a finish-to-start link between them is a contradiction (MS Project refuses it)
//
// Only what the write CHANGES is checked (incremental): a legacy row that already breaks a rule stays editable for
// its other fields (status, owner…) — `tools/pg/ppm-integrity-report.js` lists those rows for a person to fix.

const DATE_FIELDS = {
  task: ['start_date', 'end_date', 'baseline_start', 'baseline_end', 'forecast_end', 'actual_start', 'actual_end'],
  project: ['start_date', 'end_date', 'baseline_start', 'baseline_end', 'forecast_end', 'actual_start', 'actual_end'],
  milestone: ['due_date', 'baseline_date', 'done_at'],
};
const DATE_PAIRS = [['start_date', 'end_date'], ['baseline_start', 'baseline_end'], ['actual_start', 'actual_end']];
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIME_HEAD = /^[T ]\d{2}:\d{2}/;

/** True for a real calendar day (YYYY-MM-DD, optionally followed by a valid ISO time). */
function isValidDate(v) {
  if (typeof v !== 'string') return false;
  const t = v.trim();
  const m = ISO_DAY.exec(t.slice(0, 10));
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return false;
  const rest = t.slice(10);
  if (!rest) return true;
  // a full ISO timestamp is accepted (e.g. a done_at stamp); its time part must parse
  return ISO_TIME_HEAD.test(rest) && Number(rest.slice(1, 3)) <= 23 && Number(rest.slice(4, 6)) <= 59 && !Number.isNaN(Date.parse(t.replace(' ', 'T')));
}
const _day = (v) => String(v).trim().slice(0, 10);
const _p = (code, error, extra) => ({ code, error, ...(extra || {}) });

/**
 * Date problems of one write. `patch` = the normalised fields being written; `before` = the stored row (null for a
 * new row). Returns the first problem or null.
 */
function dateProblem(kind, patch, before = null) {
  const fields = DATE_FIELDS[kind]; if (!fields) return null;
  const p = patch || {};
  for (const f of fields) {
    if (p[f] === undefined || p[f] === null || p[f] === '') continue;
    if (!isValidDate(p[f])) return _p('DATE_INVALID', `${f} must be a real date (YYYY-MM-DD), got "${String(p[f]).slice(0, 40)}"`, { field: f });
  }
  const merged = { ...(before || {}), ...p };
  for (const [a, b] of DATE_PAIRS) {
    if (!fields.includes(a)) continue;
    if (p[a] === undefined && p[b] === undefined) continue;   // this write does not touch the pair
    const s = merged[a], e = merged[b];
    if (s == null || s === '' || e == null || e === '' || !isValidDate(s) || !isValidDate(e)) continue;
    if (_day(e) < _day(s)) return _p('DATE_ORDER', `${b} (${_day(e)}) is before ${a} (${_day(s)})`, { field: b });
  }
  return null;
}

/** Ids of the ancestors of `id` (parent, grandparent…), following `parentOf`; stops on a loop. */
function ancestors(id, parentOf) {
  const out = []; const seen = new Set([id]);
  let cur = parentOf.get(id);
  while (cur != null && !seen.has(cur)) { out.push(cur); seen.add(cur); cur = parentOf.get(cur); }
  return out;
}

/**
 * Hierarchy + link problems of a task write.
 *   task     { id (null for a new task), project_id, parent_id, depends_on[] } AS IT WOULD BE STORED
 *   rows     every task that may be involved: [{ id, project_id, parent_id }] (the project's tasks, plus the
 *            proposed parent row when it lives elsewhere)
 *   changed  { parent, deps } — which of the two this write changes (incremental rule); both true for a new task
 */
function hierarchyProblem(task, rows, changed = { parent: true, deps: true }) {
  const id = task.id == null ? null : Number(task.id);
  const pid = task.parent_id == null ? null : Number(task.parent_id);
  const byId = new Map((rows || []).map((r) => [Number(r.id), { id: Number(r.id), project_id: r.project_id == null ? null : Number(r.project_id), parent_id: r.parent_id == null ? null : Number(r.parent_id) }]));
  const parentOf = new Map();
  for (const r of byId.values()) parentOf.set(r.id, r.parent_id);
  if (id != null) parentOf.set(id, pid);   // the write as it would be stored
  if (changed.parent && pid != null) {
    if (id != null && pid === id) return _p('PARENT_SELF', 'a task cannot be its own parent');
    const parent = byId.get(pid);
    if (!parent) return _p('PARENT_NOT_FOUND', `parent task #${pid} does not exist`);
    if (task.project_id != null && parent.project_id !== Number(task.project_id)) return _p('PARENT_OTHER_PROJECT', `parent task #${pid} belongs to another project`);
    if (id != null && ancestors(pid, parentOf).concat([pid]).includes(id)) return _p('PARENT_CYCLE', `task #${pid} is under task #${id}: this parent would make a loop`);
  }
  if (changed.parent || changed.deps) {
    const deps = (task.depends_on || []).map(Number);
    const up = id != null ? ancestors(id, parentOf) : (pid != null ? [pid].concat(ancestors(pid, parentOf)) : []);
    const down = new Set();
    if (id != null) for (const r of parentOf.keys()) if (r !== id && ancestors(r, parentOf).includes(id)) down.add(r);
    const bad = deps.find((d) => up.includes(d) || down.has(d));
    if (bad != null) return _p('DEPENDS_ON_HIERARCHY', `task #${bad} is ${up.includes(bad) ? 'a parent' : 'a sub-task'} of this task: a task cannot depend on its own parent or sub-task`);
  }
  return null;
}

/**
 * Read-only diagnostic over stored rows (tools/pg/ppm-integrity-report.js). Never throws on bad data (a parent loop,
 * an unknown parent, a non-date string): every offending row is listed with its rule.
 *   input { projects:[…], tasks:[…], milestones:[…] } as stored
 */
function findIntegrityIssues({ projects = [], tasks = [], milestones = [] } = {}) {
  const out = [];
  const add = (entity, row, p) => out.push({ entity, id: Number(row.id), project_id: row.project_id == null ? (entity === 'project' ? Number(row.id) : null) : Number(row.project_id), code: p.code, detail: p.error });
  for (const r of projects) { const p = dateProblem('project', _onlyDates('project', r)); if (p) add('project', r, p); }
  for (const r of milestones) { const p = dateProblem('milestone', _onlyDates('milestone', r)); if (p) add('milestone', r, p); }
  const parentOf = new Map(tasks.map((t) => [Number(t.id), t.parent_id == null ? null : Number(t.parent_id)]));
  const byId = new Map(tasks.map((t) => [Number(t.id), t]));
  for (const t of tasks) {
    const dp = dateProblem('task', _onlyDates('task', t)); if (dp) add('task', t, dp);
    const id = Number(t.id), pid = t.parent_id == null ? null : Number(t.parent_id);
    if (pid != null) {
      if (pid === id) add('task', t, _p('PARENT_SELF', 'task is its own parent'));
      else if (!byId.has(pid)) add('task', t, _p('PARENT_NOT_FOUND', `parent task #${pid} does not exist`));
      else if (Number(byId.get(pid).project_id) !== Number(t.project_id)) add('task', t, _p('PARENT_OTHER_PROJECT', `parent task #${pid} belongs to project #${byId.get(pid).project_id}`));
      else {
        // a loop: walking up from this task comes back to it
        const seen = new Set(); let cur = pid; let loop = false;
        while (cur != null) { if (cur === id) { loop = true; break; } if (seen.has(cur)) break; seen.add(cur); cur = parentOf.get(cur); }
        if (loop) add('task', t, _p('PARENT_CYCLE', 'the parent chain of this task comes back to it'));
      }
    }
    let deps = t.depends_on;
    if (typeof deps === 'string') { try { deps = JSON.parse(deps); } catch (_) { deps = []; } }
    const up = ancestors(id, parentOf);
    const bad = (Array.isArray(deps) ? deps : []).map(Number).find((d) => up.includes(d) || ancestors(d, parentOf).includes(id));
    if (bad != null) add('task', t, _p('DEPENDS_ON_HIERARCHY', `depends on task #${bad}, its own parent or sub-task`));
  }
  return out;
}
function _onlyDates(kind, r) { const o = {}; for (const f of DATE_FIELDS[kind]) if (r[f] != null && r[f] !== '') o[f] = String(r[f]); return o; }

module.exports = { DATE_FIELDS, DATE_PAIRS, isValidDate, dateProblem, hierarchyProblem, ancestors, findIntegrityIssues };
