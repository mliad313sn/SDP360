'use strict';
// The SINGLE window definition for WAN Health availability, mirroring Meraki's Summary Report
// presets (Past Day / Past Week / Past Month). Read from Meraki's own selector, every preset:
//   • ends YESTERDAY (excludes the incomplete current day) → to = start of today (00:00 UTC), and
//   • spans N COMPLETE days → from = to − N·24h, with N = 1 (day) / 7 (week) / 30 (month).
// NOTE these are ROLLING windows, NOT ISO calendar weeks or calendar months — that is exactly how
// Meraki computes them, so a WAN Health number reconciles with what the report editor sees when
// they click the matching preset in Meraki (they use presets, never Custom). asOfMs is injected so
// this is pure and deterministic. UTC day boundaries (consistent with the SLA module's UTC-only
// scope). SLA / chargeback does NOT use this — it stays calendar-month for billing.
const DAY_MS = 86400000;
const DAYS = { day: 1, week: 7, month: 30 };

function _startOfUTCDay(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// merakiWindow(period, asOfMs) → { fromMs, toMs, fromISO, toISO, days, period }
function merakiWindow(period, asOfMs) {
  const p = Object.prototype.hasOwnProperty.call(DAYS, period) ? period : 'week';
  const days = DAYS[p];
  const toMs = _startOfUTCDay(asOfMs == null ? Date.now() : asOfMs);
  const fromMs = toMs - days * DAY_MS;
  return {
    fromMs, toMs,
    fromISO: new Date(fromMs).toISOString(),
    toISO: new Date(toMs).toISOString(),
    days, period: p,
  };
}

module.exports = { merakiWindow, DAYS };
