'use strict';
// ── Truncation guard (Step 1, 2026-10-19; shared since P11 F-01/F-03, 2026-11-19) ─────────────
// Every full-replace / reconcile sync downloads the WHOLE source view and then deletes local rows
// absent from the download. A truncated or partial export therefore cascades into a mass delete.
// Before any delete, refuse a fetch that is smaller than the local table by more than
// `tolerancePct` (default 20 %, env SYNC_TRUNCATION_TOLERANCE_PCT, clamped 0..90). The error is
// marked transient so the runner retries later instead of applying it. A first run (stored = 0)
// and any growth are always accepted.
function assertNotTruncated(job, fetched, stored, tolerancePct = Number(process.env.SYNC_TRUNCATION_TOLERANCE_PCT || 20)) {
  const tol = Math.max(0, Math.min(90, Number(tolerancePct) || 0)) / 100;
  if (stored > 0 && fetched < stored * (1 - tol)) {
    const e = new Error(`${job}: fetched ${fetched} rows but ${stored} are stored (−${Math.round(100 - fetched / stored * 100)} %) — export looks truncated, refusing to reconcile`);
    e.transient = true; e.truncation = true;
    throw e;
  }
}

module.exports = { assertNotTruncated };
