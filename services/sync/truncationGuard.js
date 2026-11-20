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
// alternating, growing-by-one or repeated partial exports — only fetched ≥ anchor or a confirmed shrink move it).
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
// P11 r3 F-14 / N-02r — the anchor used to follow any run with fetched ≥ stored. But `stored` had already been
// lowered by the previous lossy run, so ALTERNATING partial exports (1000 → 810 → 820 → 660 …), a partial export
// growing by one row per run (81, 82, 83 …) or the SAME partial export repeated (a deterministic row cap:
// 81, 81, 66, 66 …) each walked the anchor down without limit. The anchor now moves:
//   UP or STAYS  when fetched ≥ anchor (growth, or the source confirmed the anchored size);
//   DOWN         NEVER automatically. Counts cannot tell a genuine shrink from a source stuck on a cap, so a lower
//                count is only RECORDED as the pending candidate (pending, agree = consecutive runs that reported it).
//                Only an operator lowers it (tools/sync/confirm-shrink.js). P11 r4: SYNC_TRUNCATION_SHRINK_CONFIRMATIONS
//                = N ≥ 2 (SRE policy, PROPOSED) used to lower the anchor by itself after N agreeing exports, which let a
//                repeated row cap (81, 81, 66, 66 …) re-open the ratchet. It now only ADDS a requirement: the operator
//                can confirm the pending candidate only once N consecutive runs reported it. It never weakens the anchor.
// A run more than the tolerance below the anchor is refused by assertNotTruncated and never reaches here, so the
// cumulative loss since the last confirmed count stays bounded by the tolerance.
function shrinkConfirmations(env = process.env) {
  const n = Math.round(Number(env.SYNC_TRUNCATION_SHRINK_CONFIRMATIONS));
  return Number.isFinite(n) && n >= 2 ? n : 0;   // 0 = operator confirmation only
}

function _state(prev) {
  if (prev != null && typeof prev === 'object') {
    const agree = Number(prev.agree);
    return { anchor: _anchorOrNull(prev.anchor), pending: _anchorOrNull(prev.pending), agree: Number.isFinite(agree) && agree > 0 ? agree : 0 };
  }
  return { anchor: _anchorOrNull(prev), pending: null, agree: 0 };   // legacy: a bare number = the anchor
}

// `confirmations` is accepted for backward compatibility and deliberately ignored: no count of agreeing runs lowers
// the anchor on its own (P11 r4).
// eslint-disable-next-line no-unused-vars
function nextAnchorState(prev, fetched, stored, opts = {}) {
  const p = _state(prev);
  // Never anchored: the first confirmed count is what was stored before this run (or this run if it is larger).
  const anchor = p.anchor == null ? Math.max(stored, 0) : p.anchor;
  if (fetched >= anchor) return { anchor: fetched, pending: null, agree: 0 };
  const agree = p.pending === fetched ? p.agree + 1 : 1;
  return { anchor, pending: fetched, agree };
}

/**
 * Operator confirmation of a genuine shrink: the anchor becomes `count` (default: the pending candidate).
 * Refused: a count ABOVE the current anchor (P11 r4 — a typo there would block every later sync; a growth needs no
 * confirmation, the next run raises the anchor itself), and — when the SRE policy SYNC_TRUNCATION_SHRINK_CONFIRMATIONS
 * = N is set — the pending candidate before N consecutive runs reported it.
 */
function confirmShrink(prev, count, { confirmations = shrinkConfirmations() } = {}) {
  const p = _state(prev);
  const n = count == null ? p.pending : _anchorOrNull(count);
  if (n == null || n < 0) throw new Error('confirmShrink: no pending count recorded — pass the confirmed count explicitly');
  const m = Math.round(n);
  if (p.anchor != null && m > p.anchor) {
    throw new Error(`confirmShrink: ${m} is above the current anchor ${p.anchor} — a shrink confirmation can only lower it (check for a typo)`);
  }
  if (confirmations >= 2 && p.pending != null && m === p.pending && p.agree < confirmations) {
    throw new Error(`confirmShrink: the pending count ${m} was reported by ${p.agree} run(s); the policy requires ${confirmations} consecutive runs (SYNC_TRUNCATION_SHRINK_CONFIRMATIONS)`);
  }
  return { anchor: m, pending: null, agree: 0 };
}

/** The anchor count after an accepted run (see nextAnchorState). */
function nextAnchor(prev, fetched, stored, opts) { return nextAnchorState(prev, fetched, stored, opts).anchor; }

function _logSync(opts, action, job, details) {
  try {
    const log = (opts && opts.logEvent) || require('../../reports-db').logEvent;
    if (typeof log === 'function') log({ category: 'sync', action, target: job, details, risk: 1 });
  } catch (_) { /* a dead log never breaks a sync */ }
}

// Read the anchor state, check, and return a commit function to call AFTER the reconcile succeeded.
// `store` = { get(key) → {anchor,pending,agree}|number|null, set(key, state) }.
// P11 r4 — an UNREADABLE anchor store fails CLOSED for shrinks: the read failure is logged to the system log
// (category `sync`, risk) and the run is checked with a 0 % tolerance against what is stored, so growth and
// unchanged counts still sync but no row is deleted until the anchor can be read again (the refusal is transient,
// the runner retries). Without a store at all (callers that never wired one) the stored-only guard applies.
async function guardWithAnchor(job, fetched, stored, store, tolerancePct, opts = {}) {
  let prev = null; let readFailed = false;
  if (store && typeof store.get === 'function') {
    try { prev = await store.get(job); } catch (e) {
      readFailed = true;
      console.warn(`[sync] truncation anchor read failed for ${job}: ${e.message} — refusing any shrink this run`);
      _logSync(opts, 'sync_truncation_anchor_unreadable', job, { error: e.message, fetched, stored });
    }
  }
  if (readFailed && stored > 0 && fetched < stored) {
    const e = new Error(`${job}: fetched ${fetched} rows but ${stored} are stored and the truncation anchor could not be read — refusing to delete until it can`);
    e.transient = true; e.truncation = true;
    throw e;
  }
  assertNotTruncated(job, fetched, stored, tolerancePct, { anchor: _state(prev).anchor });
  return async () => {
    if (!store || typeof store.set !== 'function' || readFailed) return;
    try { await store.set(job, nextAnchorState(prev, fetched, stored)); } catch (e) {
      console.warn(`[sync] truncation anchor write failed for ${job}: ${e.message}`);
      _logSync(opts, 'sync_truncation_anchor_write_failed', job, { error: e.message });
    }
  };
}

module.exports = { assertNotTruncated, nextAnchor, nextAnchorState, confirmShrink, shrinkConfirmations, guardWithAnchor };
