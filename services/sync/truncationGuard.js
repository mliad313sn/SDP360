'use strict';
// ── Truncation guard (Step 1, 2026-10-19; shared since P11 F-01/F-03, 2026-11-19) ─────────────
// Every full-replace / reconcile sync downloads the WHOLE source view and then deletes local rows
// absent from the download. A truncated or partial export therefore cascades into a mass delete.
// Before any delete, refuse a fetch that is smaller than the baseline by more than
// `tolerancePct` (default 20 %, env SYNC_TRUNCATION_TOLERANCE_PCT, clamped 0..90). The error is
// marked transient so the runner retries later instead of applying it. A first run (stored = 0)
// and any growth are always accepted.
//
// P11 round 2 N-02 — the baseline is no longer the CURRENT local count alone. Comparing only to
// what is stored let successive partial exports, each inside the tolerance, ratchet a table down
// without limit (100 → 81 → 66 → 54 …). The baseline is now max(stored, anchor), where the anchor
// is the last count the source CONFIRMED (see nextAnchor): a lossy run never lowers it, so the
// cumulative loss since the last confirmed count is bounded by the tolerance.
function _anchorOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function assertNotTruncated(job, fetched, stored, tolerancePct = Number(process.env.SYNC_TRUNCATION_TOLERANCE_PCT || 20), opts = {}) {
  const tol = Math.max(0, Math.min(90, Number(tolerancePct) || 0)) / 100;
  const anchor = _anchorOrNull(opts && opts.anchor);   // null = never anchored → stored-only baseline
  // stored = 0 = first run / rebuild: always accepted (nothing to delete).
  const baseline = stored > 0 ? (anchor == null ? stored : Math.max(stored, anchor)) : 0;
  if (baseline > 0 && fetched < baseline * (1 - tol)) {
    const vs = baseline > stored ? `${stored} are stored, last confirmed count ${baseline}` : `${stored} are stored`;
    const e = new Error(`${job}: fetched ${fetched} rows but ${vs} (−${Math.round(100 - fetched / baseline * 100)} %) — export looks truncated, refusing to reconcile`);
    e.transient = true; e.truncation = true;
    throw e;
  }
}

// Anchor after an ACCEPTED run. A run that lost nothing count-wise (fetched ≥ stored) confirms the
// source size: the anchor becomes `fetched` (so a genuine shrink is accepted once two consecutive
// exports agree on the lower count). A run that deleted rows never lowers the anchor.
function nextAnchor(prevAnchor, fetched, stored) {
  if (fetched >= stored) return fetched;
  const prev = _anchorOrNull(prevAnchor);
  return prev == null ? stored : Math.max(prev, stored);
}

// Read the anchor, check, and return a commit function to call AFTER the reconcile succeeded.
// `store` = { get(key) → number|null, set(key, n) }; absent / failing store → stored-only guard
// (never blocks a sync because the anchor table is unreachable).
async function guardWithAnchor(job, fetched, stored, store, tolerancePct) {
  let anchor = null;
  if (store && typeof store.get === 'function') {
    try { anchor = await store.get(job); } catch (e) { console.warn(`[sync] truncation anchor read failed for ${job}: ${e.message}`); }
  }
  assertNotTruncated(job, fetched, stored, tolerancePct, { anchor });
  return async () => {
    if (!store || typeof store.set !== 'function') return;
    try { await store.set(job, nextAnchor(anchor, fetched, stored)); } catch (e) { console.warn(`[sync] truncation anchor write failed for ${job}: ${e.message}`); }
  };
}

module.exports = { assertNotTruncated, nextAnchor, guardWithAnchor };
