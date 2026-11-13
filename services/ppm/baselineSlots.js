'use strict';
// W2-ENGINE — the 11 baselines (Baseline, Baseline1..Baseline10) and the 10 interim plans of MS-Project (PURE).
// A slot is a snapshot of the SCHEDULED plan (services/ppm/scheduleEngine dates, not the typed dates) saved once and
// never edited (table ppm_baseline_slots, append-only — migration 105). It sits NEXT TO the A-27 approved baseline
// (portfolio_baselines, the governance gate): a slot is a comparison point for the schedule, it never moves the
// approved baseline and never feeds earned value. A baseline slot keeps dates + duration + work + cost (cost is
// shown to money readers only); an interim plan keeps start / finish only (as in MS-Project).
const KINDS = Object.freeze(['baseline', 'interim']);
const DAY = 86400000;
const MIN_REASON = 3;

function slotName(kind, slot) {
  if (kind === 'baseline') return Number(slot) === 0 ? 'Baseline' : `Baseline${Number(slot)}`;
  return `Interim${Number(slot)}`;
}
/** null when (kind, slot) is a valid slot, else an error string. */
function slotProblem(kind, slot) {
  if (!KINDS.includes(kind)) return 'kind must be baseline | interim';
  const s = Number(slot);
  if (!Number.isInteger(s)) return 'slot must be an integer';
  if (kind === 'baseline' && (s < 0 || s > 10)) return 'a baseline slot is 0 (Baseline) to 10 (Baseline10)';
  if (kind === 'interim' && (s < 1 || s > 10)) return 'an interim plan slot is 1 to 10';
  return null;
}
/**
 * @param {string} kind
 * @param {object} schedule   scheduleEngine.schedule result
 * @param {{tasks:Array, workByTask?:Object<number,number|null>, costByTask?:Object<number,object|null>}} extra
 */
function slotPayload(kind, schedule, extra = {}) {
  const meta = new Map((extra.tasks || []).map((t) => [Number(t.id), t]));
  const tasks = (schedule && schedule.tasks ? schedule.tasks : []).map((r) => {
    const t = meta.get(Number(r.id)) || {};
    const base = { id: Number(r.id), name: t.name == null ? null : String(t.name), wbs_code: t.wbs_code == null ? null : String(t.wbs_code), summary: !!r.summary, start: r.es_date, finish: r.ef_date };
    if (kind === 'interim') return base;
    const w = extra.workByTask && Object.prototype.hasOwnProperty.call(extra.workByTask, r.id) ? extra.workByTask[r.id] : (t.effort_hours == null || t.effort_hours === '' ? null : Number(t.effort_hours));
    return { ...base, duration_days: r.duration_days == null ? null : Number(r.duration_days), work_hours: w == null ? null : Number(w), cost: extra.costByTask ? extra.costByTask[r.id] ?? null : null };
  });
  return { kind, project: { start: schedule ? schedule.anchor : null, finish: schedule ? schedule.project_finish : null }, tasks };
}
const shift = (a, b) => (a && b ? Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY) : null);
/** Variances of the current plan against a slot (positive = later / more). Null when a side is unknown. */
function slotVariance(slotPayloadObj, currentPayload) {
  const A = new Map(((slotPayloadObj && slotPayloadObj.tasks) || []).map((t) => [t.id, t]));
  const B = new Map(((currentPayload && currentPayload.tasks) || []).map((t) => [t.id, t]));
  const ids = [...new Set([...A.keys(), ...B.keys()])].sort((x, y) => x - y);
  return {
    project_finish_variance_days: shift(slotPayloadObj && slotPayloadObj.project.finish, currentPayload && currentPayload.project.finish),
    tasks: ids.map((id) => {
      const a = A.get(id), b = B.get(id);
      return { id, in_slot: !!a, in_current: !!b, start_variance_days: shift(a && a.start, b && b.start), finish_variance_days: shift(a && a.finish, b && b.finish),
        work_variance_hours: a && b && a.work_hours != null && b.work_hours != null ? Math.round((b.work_hours - a.work_hours) * 100) / 100 : null };
    }),
  };
}
/** The payload with every cost removed (readers without the money right). */
function stripCost(p) { return p ? { ...p, tasks: (p.tasks || []).map(({ cost, ...t }) => t) } : p; }

module.exports = { KINDS, MIN_REASON, slotName, slotProblem, slotPayload, slotVariance, stripCost };
