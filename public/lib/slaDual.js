/* A7 — "Stop flattering the SLA": ONE definition of the open-and-breached count and of the dual
 * compliance rate, shared by the browser (public/lib/dashboard-shared.js → Helpdesk tiles, scorecard)
 * and the server (reports-db SQL mirrors the same predicate, services/slaDefinition.js).
 *
 * Two compliance rates, always shown with their definition:
 *   closed_only — "closed tickets only" / « tickets clôturés uniquement »: the ITSM doctrine rate used
 *                 since 2026-06-02 (CLAUDE.md "KPI denominator doctrine"). An open ticket already past
 *                 its target is invisible to it — which is what flatters the figure.
 *   incl_open   — "incl. open tickets past target" / « y compris tickets ouverts hors délai »: the same
 *                 closed population PLUS every open ticket already past its target, counted as a failure
 *                 (in the denominator AND as a violation).
 *
 * Open & breached (resolution), as of `asOf` (the period end, or now when the period is still running):
 *   – the ticket is open (not closed, not cancelled);
 *   – it has an SLA rule (a resolution-overdue flag OR a due time — neither = no rule, never judged);
 *   – EITHER the stored resolution-overdue flag says it is late (Zoho, last sync)
 *     OR it is not on hold and its due time is STRICTLY before asOf. A ticket due exactly at asOf has not
 *     missed it yet (boundary). A ticket on hold has its SLA paused: only the flag counts, the due time is
 *     not compared (same semantics as dashboard-shared isResOverdue, which judges open tickets by the flag).
 * Open & breached (first response): open, not cancelled, not yet responded, first-response flag late.
 *   (No first-response due time is synced, so the flag is the only source.)
 *
 * No base → null (never 0). Pure: no I/O, no clock — asOf is passed in.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SlaDual = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFINITIONS = ['closed_only', 'incl_open'];
  var DEFAULT_HEADLINE = 'closed_only';
  var LABELS = {
    closed_only:   { en: 'closed tickets only', fr: 'tickets clôturés uniquement' },
    incl_open:     { en: 'incl. open tickets past target', fr: 'y compris tickets ouverts hors délai' },
    open_breached: { en: 'open & breached', fr: 'ouverts hors délai' },
  };

  function normalizeHeadline(v) {
    var s = String(v == null ? '' : v).trim();
    return DEFINITIONS.indexOf(s) >= 0 ? s : DEFAULT_HEADLINE;
  }
  function label(def, lang) {
    var l = LABELS[def] || LABELS.closed_only;
    return lang === 'fr' ? l.fr : l.en;
  }
  function isCancelled(status) {
    var s = String(status == null ? '' : status).toLowerCase().trim();
    return s === 'cancelled' || s === 'canceled';
  }
  function isOnHold(status) {
    return /hold/.test(String(status == null ? '' : status).toLowerCase());
  }
  function flag(v) {
    var s = String(v == null ? '' : v).toLowerCase().trim();
    return s === '1' || s === 'yes' || s === 'true';
  }
  function _blank(v) { return v == null || String(v).trim() === ''; }

  /**
   * t = { closed:bool, status:string, resFlag:any, dueMs:number|null, responded:bool, frFlag:any }
   * (the caller normalises its own row shape; asOfMs = number).
   */
  function openResBreached(t, asOfMs) {
    if (!t || t.closed || isCancelled(t.status)) return false;
    var hasDue = t.dueMs != null && isFinite(t.dueMs);
    if (_blank(t.resFlag) && !hasDue) return false;           // no SLA rule → never judged
    if (flag(t.resFlag)) return true;
    if (isOnHold(t.status)) return false;                     // SLA paused: the due time is not compared
    return hasDue && asOfMs != null && t.dueMs < asOfMs;      // strict: due exactly at asOf is not breached
  }
  function openFrBreached(t) {
    if (!t || t.closed || isCancelled(t.status) || t.responded) return false;
    return flag(t.frFlag);
  }

  function pct(n, d, decimals) {
    if (!(d > 0)) return null;
    var f = Math.pow(10, decimals == null ? 1 : decimals);
    return Math.round(n / d * 100 * f) / f;
  }
  /**
   * dual({den, violated, openBreached}, decimals) — den/violated = the closed-only base and its
   * violations (the existing doctrine rate); openBreached = open & breached count (null = unknown).
   */
  function dual(o, decimals) {
    var den = o && o.den != null ? Number(o.den) : 0;
    var vio = o && o.violated != null ? Number(o.violated) : 0;
    var ob = o && o.openBreached != null ? Number(o.openBreached) : null;
    var closedOnly = {
      definition: 'closed_only', den: den > 0 ? den : null, violated: den > 0 ? vio : null,
      ok_pct: pct(den - vio, den, decimals), violated_pct: pct(vio, den, decimals),
    };
    var d2 = ob == null ? 0 : den + ob;
    var inclOpen = {
      definition: 'incl_open', den: ob == null || d2 <= 0 ? null : d2, violated: ob == null || d2 <= 0 ? null : vio + ob,
      ok_pct: ob == null ? null : pct(den - vio, d2, decimals), violated_pct: ob == null ? null : pct(vio + ob, d2, decimals),
    };
    return { closed_only: closedOnly, incl_open: inclOpen, open_breached: ob };
  }
  /** The as-of instant of a period: its exclusive end, or now while the period is still running. */
  function asOfFor(periodEndExclusiveMs, nowMs) {
    if (periodEndExclusiveMs == null) return nowMs;
    if (nowMs == null) return periodEndExclusiveMs;
    return Math.min(periodEndExclusiveMs, nowMs);
  }

  return { DEFINITIONS: DEFINITIONS, DEFAULT_HEADLINE: DEFAULT_HEADLINE, LABELS: LABELS,
    normalizeHeadline: normalizeHeadline, label: label, isCancelled: isCancelled, isOnHold: isOnHold, flag: flag,
    openResBreached: openResBreached, openFrBreached: openFrBreached, pct: pct, dual: dual, asOfFor: asOfFor };
});
