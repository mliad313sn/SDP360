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

module.exports = { judged, mode, tally, pct };
