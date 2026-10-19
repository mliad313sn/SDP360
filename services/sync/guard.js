'use strict';
// Step 1 (SDP-DASH-2.0) — deletion guard for the Zoho reconciliations.
//
// The ticket, change, CAB and survey syncs download the WHOLE view, then delete every local
// row whose id is not in the download ("reconciliation"). A truncated or half-empty export
// therefore turns straight into a mass deletion. This guard refuses a reconciliation that
// would remove more than `tolerancePct` of the local rows (and more than `minRows`): nothing
// is deleted, the run fails loudly, the sync alerts fire. Upserts already done are kept.
//
// Pure: no I/O. The tolerance comes from SYNC_TRUNCATION_TOLERANCE_PCT (default 20 %).

const DEFAULT_TOLERANCE_PCT = 20;
const DEFAULT_MIN_ROWS = 5;

class TruncationGuardError extends Error {
  constructor(table, local, toDelete, tolerancePct) {
    super(`Reconciliation of ${table} refused: it would delete ${toDelete} of ${local} rows ` +
      `(> ${tolerancePct} %). The export looks truncated — nothing was deleted.`);
    this.name = 'TruncationGuardError';
    this.code = 'TRUNCATION_GUARD';
    this.table = table;
    this.local = local;
    this.toDelete = toDelete;
    this.tolerancePct = tolerancePct;
    this.transient = false;   // retrying the same export would trip again
  }
}

function tolerancePct(env = process.env) {
  const v = Number(env && env.SYNC_TRUNCATION_TOLERANCE_PCT);
  return Number.isFinite(v) && v > 0 && v <= 100 ? v : DEFAULT_TOLERANCE_PCT;
}

/** @returns {null|{local,toDelete,tolerancePct}} null when the deletion is acceptable. */
function checkDeletion({ local, toDelete, tolerancePct: tol = DEFAULT_TOLERANCE_PCT, minRows = DEFAULT_MIN_ROWS }) {
  const L = Math.max(0, Number(local) || 0);
  const D = Math.max(0, Number(toDelete) || 0);
  if (D <= minRows || L === 0) return null;
  if (D > (L * tol) / 100) return { local: L, toDelete: D, tolerancePct: tol };
  return null;
}

/** Throws TruncationGuardError when the deletion exceeds the tolerance. */
function assertDeletionAllowed(table, local, toDelete, opts = {}) {
  const tol = opts.tolerancePct != null ? opts.tolerancePct : tolerancePct();
  const v = checkDeletion({ local, toDelete, tolerancePct: tol, minRows: opts.minRows });
  if (v) throw new TruncationGuardError(table, v.local, v.toDelete, v.tolerancePct);
}

module.exports = { checkDeletion, assertDeletionAllowed, tolerancePct, TruncationGuardError,
  DEFAULT_TOLERANCE_PCT, DEFAULT_MIN_ROWS };
