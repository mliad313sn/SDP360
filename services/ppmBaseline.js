'use strict';
// A-27 — versioned project baselines (PURE: no I/O, no clock). The store (services/governanceStore) captures a
// version at the approval gate (ppm_baseline_versions = '1') and writes a new one through the gated re-baseline
// action (ppm_rebaseline_enabled = '1'). A version holds DATES ONLY — never budget or spent.
//   snapshotPayload  — the frozen plan of a project: project dates, task dates, milestone dates
//   diffBaselines    — day shifts per task between two payloads (null when a side has no date)
//   rebaselineCheck  — who may re-baseline and when (committee member who is not the owner, reason >= 10, stage)

const { ownerMatches } = require('./portfolioAccess');

const DAY = 86400000;
const _iso = (v) => (v == null || v === '' ? null : (/^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null));
const _ms = (d) => Date.parse(d + 'T00:00:00Z');
/** b − a in days, or null when either date is missing. */
const shift = (a, b) => { const x = _iso(a), y = _iso(b); return x && y ? Math.round((_ms(y) - _ms(x)) / DAY) : null; };

const RE_BASELINE_STAGES = ['in_progress', 'on_hold'];
const MIN_REASON = 10;

function snapshotPayload(project, tasks, milestones) {
  const p = project || {};
  return {
    project: { start_date: _iso(p.start_date), end_date: _iso(p.end_date), baseline_start: _iso(p.baseline_start), baseline_end: _iso(p.baseline_end) },
    tasks: (tasks || []).map((t) => ({ id: Number(t.id), wbs_code: t.wbs_code == null ? null : String(t.wbs_code), name: t.name == null ? null : String(t.name),
      start_date: _iso(t.start_date), end_date: _iso(t.end_date), baseline_start: _iso(t.baseline_start), baseline_end: _iso(t.baseline_end),
      duration_days: t.duration_days == null || t.duration_days === '' ? null : Number(t.duration_days),
      depends_on: Array.isArray(t.depends_on) ? t.depends_on.map(Number) : [] })),
    milestones: (milestones || []).map((m) => ({ id: Number(m.id), name: m.name == null ? null : String(m.name), due_date: _iso(m.due_date), baseline_date: _iso(m.baseline_date) })),
  };
}

// the frozen date of a task in a payload: its baseline when set, else its planned date
const _bs = (t) => (t ? t.baseline_start || t.start_date || null : null);
const _be = (t) => (t ? t.baseline_end || t.end_date || null : null);

/**
 * Compare two payloads (a = earlier, b = later or the current plan). Positive shift = later in b.
 * @returns {{project:{start_shift_days,end_shift_days}, tasks:Array<{id,name,in_a,in_b,start_shift_days,end_shift_days}>, milestones:Array<{id,name,in_a,in_b,shift_days}>}}
 */
function diffBaselines(a, b) {
  const A = a || {}, B = b || {};
  const pa = A.project || {}, pb = B.project || {};
  const ids = (x) => (x || []).map((t) => Number(t.id));
  const byId = (x) => new Map((x || []).map((t) => [Number(t.id), t]));
  const ta = byId(A.tasks), tb = byId(B.tasks);
  const tasks = [...new Set([...ids(A.tasks), ...ids(B.tasks)])].map((id) => {
    const x = ta.get(id), y = tb.get(id);
    return { id, name: (y && y.name) || (x && x.name) || null, in_a: !!x, in_b: !!y, start_shift_days: shift(_bs(x), _bs(y)), end_shift_days: shift(_be(x), _be(y)) };
  });
  const ma = byId(A.milestones), mb = byId(B.milestones);
  const milestones = [...new Set([...ids(A.milestones), ...ids(B.milestones)])].map((id) => {
    const x = ma.get(id), y = mb.get(id);
    return { id, name: (y && y.name) || (x && x.name) || null, in_a: !!x, in_b: !!y, shift_days: shift(x && (x.baseline_date || x.due_date), y && (y.baseline_date || y.due_date)) };
  });
  return { project: { start_shift_days: shift(pa.baseline_start || pa.start_date, pb.baseline_start || pb.start_date), end_shift_days: shift(pa.baseline_end || pa.end_date, pb.baseline_end || pb.end_date) }, tasks, milestones };
}

/** null when the actor may re-baseline the project now; otherwise { code, error }. Role (committee) is checked by the route. */
function rebaselineCheck(project, actor, reason) {
  if (!project) return { code: 'NOT_FOUND', error: 'project not found' };
  if (!RE_BASELINE_STAGES.includes(project.stage)) return { code: 'STAGE', error: 'a re-baseline applies to an approved project (in progress or on hold)' };
  if (ownerMatches(project, actor)) return { code: 'GATE_SOD', error: 'the project owner cannot approve a re-baseline of their own project' };
  if (!(reason && String(reason).trim().length >= MIN_REASON)) return { code: 'GATE_REASON', error: `a reason (${MIN_REASON}+ characters) is required` };
  return null;
}

module.exports = { snapshotPayload, diffBaselines, rebaselineCheck, shift, RE_BASELINE_STAGES, MIN_REASON };
