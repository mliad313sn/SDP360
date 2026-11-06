'use strict';
// G-18 — PURE escalation dedup for the A01 / A02 commitment alerts (committee review 2026-10-28).
//
// An escalation is keyed by the condition, not by the run that saw it:
//   A01:<commitment id>                 serious (high / critical) commitment, not terminal, no accountable owner
//   A01:<commitment id>:due             (E-R02, only with opts.missingDueDate) serious commitment, not terminal, no due date
//                                       and no approved (unexpired) exception — a separate episode from the missing owner
//   A02:<commitment id>:<due date>      serious commitment past its due date, not awaiting verification, no approved exception
// The due date is part of the A02 key: moving the date (with a reason, the store enforces it) and then
// missing it again is a NEW episode; re-evaluating an unchanged overdue commitment is not.
// diff() compares the condition set now with the ledger and returns what to open, keep, clear and reopen.
// Nothing here sends anything — who is told, and how, is decision D-04.

const { seriousExposure } = require('./commitmentMetrics');
const { TERMINAL } = require('./commitmentLifecycle');

const _str = (v) => String(v == null ? '' : v).trim();
/** Serious, open commitments with no due date and no exception still in force (E-R02, A01 completion). */
function missingDueIds(rows, asOf) {
  const day = String(asOf instanceof Date ? asOf.toISOString() : (asOf || new Date().toISOString())).slice(0, 10);
  const excused = (r) => _str(r.exception_approved_by) && (!r.exception_expires_at || String(r.exception_expires_at).slice(0, 10) >= day);
  return (rows || []).filter((r) => ['high', 'critical'].includes(_str(r.severity).toLowerCase()) && !TERMINAL.includes(r.status)
    && !_str(r.due_date) && !excused(r)).map((r) => r.id);
}

/** Conditions true now. rows = commitment rows (metricRows shape). opts.missingDueDate = report_config a01_missing_due_date. */
function conditions(rows, asOf, opts = {}) {
  const ex = seriousExposure(rows, asOf);
  const byId = new Map((rows || []).map((r) => [Number(r.id), r]));
  const out = [];
  for (const id of ex.unowned_ids) { const r = byId.get(Number(id)); out.push({ key: `A01:${id}`, kind: 'A01', commitment_id: Number(id), site_id: r && r.site_id != null ? Number(r.site_id) : null }); }
  if (opts.missingDueDate) for (const id of missingDueIds(rows, asOf)) { const r = byId.get(Number(id)); out.push({ key: `A01:${id}:due`, kind: 'A01', reason: 'no_due_date', commitment_id: Number(id), site_id: r && r.site_id != null ? Number(r.site_id) : null }); }
  for (const id of ex.overdue_ids) { const r = byId.get(Number(id)); out.push({ key: `A02:${id}:${String(r.due_date).slice(0, 10)}`, kind: 'A02', commitment_id: Number(id), site_id: r && r.site_id != null ? Number(r.site_id) : null }); }
  return out;
}

/**
 * @param {Array} current  conditions() now
 * @param {Array} ledger   rows of commitment_escalations ({ key, cleared_at })
 * @returns {{ open:Array, reopen:Array, keep:string[], clear:string[] }}
 *   open   — new keys never seen: raise once
 *   reopen — keys seen before, cleared, true again: raise once more (episodes + 1)
 *   keep   — still true and already open: raise NOTHING (the dedup)
 *   clear  — open in the ledger, no longer true
 */
function diff(current, ledger) {
  const led = new Map((ledger || []).map((r) => [r.key, r]));
  const now = new Set();
  const out = { open: [], reopen: [], keep: [], clear: [] };
  for (const c of current || []) {
    if (now.has(c.key)) continue;
    now.add(c.key);
    const l = led.get(c.key);
    if (!l) out.open.push(c);
    else if (l.cleared_at) out.reopen.push(c);
    else out.keep.push(c.key);
  }
  for (const [k, l] of led) if (!l.cleared_at && !now.has(k)) out.clear.push(k);
  return out;
}

module.exports = { conditions, diff, missingDueIds };
