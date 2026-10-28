'use strict';
// G-18 — PURE escalation dedup for the A01 / A02 commitment alerts (committee review 2026-10-28).
//
// An escalation is keyed by the condition, not by the run that saw it:
//   A01:<commitment id>                 serious (high / critical) commitment, not terminal, no accountable owner
//   A02:<commitment id>:<due date>      serious commitment past its due date, not awaiting verification, no approved exception
// The due date is part of the A02 key: moving the date (with a reason, the store enforces it) and then
// missing it again is a NEW episode; re-evaluating an unchanged overdue commitment is not.
// diff() compares the condition set now with the ledger and returns what to open, keep, clear and reopen.
// Nothing here sends anything — who is told, and how, is decision D-04.

const { seriousExposure } = require('./commitmentMetrics');

/** Conditions true now. rows = commitment rows (metricRows shape). */
function conditions(rows, asOf) {
  const ex = seriousExposure(rows, asOf);
  const byId = new Map((rows || []).map((r) => [Number(r.id), r]));
  const out = [];
  for (const id of ex.unowned_ids) { const r = byId.get(Number(id)); out.push({ key: `A01:${id}`, kind: 'A01', commitment_id: Number(id), site_id: r && r.site_id != null ? Number(r.site_id) : null }); }
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

module.exports = { conditions, diff };
