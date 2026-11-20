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
// is the last count the source CONFIRMED (see nextAnchorState): a lossy run never lowers it, so the
// cumulative loss since the last confirmed count is bounded by the tolerance (P11 r3 F-14: including
// alternating partial exports — only fetched ≥ anchor or two agreeing exports move it).
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

// Anchor state after an ACCEPTED run: { anchor, pending, agree }.
// P11 r3 F-14 — the anchor used to follow any run with fetched ≥ stored. But `stored` had already been
// lowered by the previous lossy run, so ALTERNATING partial exports (1000 → 810 → 820 → 660 …) each
// "lost nothing" against the stored count and walked the anchor down without limit. The anchor now moves:
//   UP or STAYS  when fetched ≥ anchor (growth, or the source confirmed the anchored size);
//   DOWN         only when CONFIRMATIONS consecutive accepted exports agree on the SAME lower count
//                (a genuine shrink). A run below the anchor that does not agree with the previous one only
//                becomes the new pending candidate; it never lowers the anchor.
// A run more than the tolerance below the anchor is refused by assertNotTruncated and never reaches here.
const CONFIRMATIONS = 2;

function _state(prev) {
  if (prev != null && typeof prev === 'object') {
    const agree = Number(prev.agree);
    return { anchor: _anchorOrNull(prev.anchor), pending: _anchorOrNull(prev.pending), agree: Number.isFinite(agree) && agree > 0 ? agree : 0 };
  }
  return { anchor: _anchorOrNull(prev), pending: null, agree: 0 };   // legacy: a bare number = the anchor
}

function nextAnchorState(prev, fetched, stored) {
  const p = _state(prev);
  // Never anchored: the first confirmed count is what was stored before this run (or this run if it is larger).
  const anchor = p.anchor == null ? Math.max(stored, 0) : p.anchor;
  if (fetched >= anchor) return { anchor: fetched, pending: null, agree: 0 };
  const agree = p.pending === fetched ? p.agree + 1 : 1;
  if (agree >= CONFIRMATIONS) return { anchor: fetched, pending: null, agree: 0 };
  return { anchor, pending: fetched, agree };
}

/** The anchor count after an accepted run (see nextAnchorState). */
function nextAnchor(prev, fetched, stored) { return nextAnchorState(prev, fetched, stored).anchor; }

// Read the anchor state, check, and return a commit function to call AFTER the reconcile succeeded.
// `store` = { get(key) → {anchor,pending,agree}|number|null, set(key, state) }; absent / failing store →
// stored-only guard (never blocks a sync because the anchor table is unreachable).
async function guardWithAnchor(job, fetched, stored, store, tolerancePct) {
  let prev = null;
  if (store && typeof store.get === 'function') {
    try { prev = await store.get(job); } catch (e) { console.warn(`[sync] truncation anchor read failed for ${job}: ${e.message}`); }
  }
  assertNotTruncated(job, fetched, stored, tolerancePct, { anchor: _state(prev).anchor });
  return async () => {
    if (!store || typeof store.set !== 'function') return;
    try { await store.set(job, nextAnchorState(prev, fetched, stored)); } catch (e) { console.warn(`[sync] truncation anchor write failed for ${job}: ${e.message}`); }
  };
}

module.exports = { assertNotTruncated, nextAnchor, nextAnchorState, guardWithAnchor, CONFIRMATIONS };
