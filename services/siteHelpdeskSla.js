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


/** P11 F-24 / r6 F-26 — the Vue Groupe helpdesk cell. The RATE stays the closed-only Resolution SLA (no second
 *  formula): the window reader's res_sla_den / res_sla_missed (cancelled, open and no-rule tickets out of the base).
 *  But a closed-only verdict alone can read green on a one-ticket closed base while most of the window is open and
 *  already overdue, so the cell colour is the WORST of two bands:
 *    - closed band: on-time share of the closed tickets (1 − missed / closed);
 *    - open band:   share of the window's tickets NOT open-and-overdue (1 − open_overdue / created).
 *  Both bands are the PROPOSED kpiRag policy 'helpdesk-fleet-sla' (green ≥ 0.95, amber ≥ 0.85 — the former cell's
 *  < 5 % / < 15 % cut-offs; KPI Committee, G06). Green is only possible with a measured closed base; nothing closed and
 *  no open overdue → 'na' (never green); nothing closed but open overdue → the open band alone (amber / red).
 *  value = "missed/closed" (or null), open_overdue rides along (the page labels it); cap = the open band when it is
 *  amber/red, so the site's OVERALL verdict cannot read better than its open overdue load (siteAwarenessFleet.rollupRag). */
function fleetCell(hw) {
  const P = require('../public/lib/kpiRag').POLICIES['helpdesk-fleet-sla'];
  // exact integer comparison on the BAD share (bad / base < 5 % green, < 15 % amber — strict, as the former cell), so a
  // float 1 − x never moves a ticket across a boundary
  const gMax = Math.round((1 - P.green) * 100), aMax = Math.round((1 - P.amber) * 100);
  const band = (bad, base) => (bad * 100 < gMax * base ? 'green' : bad * 100 < aMax * base ? 'amber' : 'red');
  const h = hw || {};
  const den = h.res_sla_den == null ? null : Number(h.res_sla_den);
  const missed = h.res_sla_missed == null ? null : Number(h.res_sla_missed);
  const closedMeasured = Number.isFinite(den) && den > 0 && Number.isFinite(missed) && h.res_sla_pct != null;
  const closedRag = closedMeasured ? band(missed, den) : null;
  const oo = h.open_overdue == null ? null : Number(h.open_overdue);
  const created = h.created == null ? null : Number(h.created);
  let openRag = null;
  if (Number.isFinite(oo) && oo > 0) {
    // created is the window population; if it is missing or smaller than the overdue count, the share is unknown →
    // the overdue load alone is enough to deny green (red: a measured overdue load with no base to dilute it)
    openRag = (Number.isFinite(created) && created >= oo && created > 0) ? band(oo, created) : 'red';
  }
  const ord = { red: 0, amber: 1, green: 2 };
  let rag;
  if (closedRag && openRag) rag = ord[openRag] < ord[closedRag] ? openRag : closedRag;
  else if (closedRag) rag = closedRag;
  else if (openRag && openRag !== 'green') rag = openRag;   // nothing closed: only a bad open band gives a verdict
  else rag = 'na';
  const cell = { rag, value: closedMeasured ? missed + '/' + den : null, open_overdue: Number.isFinite(oo) ? oo : null };
  if (openRag === 'red' || openRag === 'amber') cell.cap = openRag;
  return cell;
}

module.exports = { judged, mode, tally, pct, fleetCell };
