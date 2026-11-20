'use strict';
// Site-view Resolution SLA (P11 F-16), extracted from reports-db.js (monolith ratchet). The SAME rule as
// helpdesk.resolution_sla_pct (reports-db getCalendarMonthlyHelpdesk sla_res_pct): denominator = closed tickets
// carrying an SLA rule, CANCELLED EXCLUDED; missed = services/slaDefinition.resOverdueRow under the configured
// report_config helpdesk_sla_definition (opts.slaDefinition, 'flag' by default). Nothing closed -> null (UNKNOWN),
// never 100. open_overdue (counted by the caller) = open tickets already flagged overdue, shown next to the rate.
const SD = require('./slaDefinition');

// A closed ticket counts in the Resolution SLA denominator when it is not cancelled and carries an SLA rule —
// the getCalendarMonthlyHelpdesk SQL (NOT_CANCELLED AND overdue_status IS NOT NULL); under 'due_vs_resolved' a
// due time is a rule too (that mode judges resolved-after-due).
function judged(r, mode) {
  const st = String(r.request_status || '').toLowerCase().trim();
  if (st === 'cancelled' || st === 'canceled') return false;
  if (r.overdue_status != null) return true;
  return mode === 'due_vs_resolved' && r.due_by_time != null && String(r.due_by_time).trim() !== '';
}

function mode(opts) { return SD.normalizeMode(opts && opts.slaDefinition); }
function tally(out, r, m) {
  if (r.pending_status === 0 && judged(r, m)) {
    out.res_sla_den++;
    if (SD.resOverdueRow(r, m)) out.res_sla_missed++;
  }
}
function pct(out) { return out.res_sla_den ? Math.round(((out.res_sla_den - out.res_sla_missed) / out.res_sla_den) * 1000) / 10 : null; }


/** P11 F-24 — the Vue Groupe helpdesk cell, on the SAME closed-only doctrine (no second formula): the window reader's
 *  res_sla_den / res_sla_missed (cancelled, open and no-rule tickets out of the base). Nothing closed → 'na' (never
 *  green). Bands kept from the former cell, now on the missed share of CLOSED tickets: < 5 % green, < 15 % amber, else
 *  red (display only, PROPOSED — G06). value = "missed/closed". */
function fleetCell(hw) {
  const h = hw || {};
  const den = h.res_sla_den == null ? null : Number(h.res_sla_den);
  const missed = h.res_sla_missed == null ? null : Number(h.res_sla_missed);
  if (!Number.isFinite(den) || den <= 0 || !Number.isFinite(missed) || h.res_sla_pct == null) return { rag: 'na', value: null };   // unknown, never green
  const rate = missed / den;
  return { rag: rate < 0.05 ? 'green' : rate < 0.15 ? 'amber' : 'red', value: missed + '/' + den };
}

module.exports = { judged, mode, tally, pct, fleetCell };
