'use strict';
// Adoption Lot A (item 2) — a tracker month with NO entry for a site is "not entered": no score, no colour, no alert.
// Before this, a month where 0 of 21 activities were typed produced a site score of 14–28 % (RED) from the earlier
// months' year-to-date pro-rating, and the nightly rule tracker.site.red fired on it (5 firings on day 0).
//
// "Not entered" = at least one activity is due that month for the site (active target, month inside its window) and
// EVERY one of those cells is empty (null, '' or 0 — the same rule as Home's "N activities with nothing entered",
// services/myWork.trackerEmptyCells). A PARTIALLY entered month is scored exactly as before: how to treat it is a
// KPI-committee decision (PROPOSED rule in docs/agent-execution/ADOPTION-LOT-A.md), not an engineering one.
const { trackerEmptyCells } = require('./myWork');

function monthState(D, code, year, month) {
  const t = trackerEmptyCells(D, code, Number(year), Number(month));
  if (!t || t.total_cells === 0) return { state: 'no_activity_due', empty: t ? t.empty_cells : null, total: t ? t.total_cells : null };
  if (t.empty_cells === t.total_cells) return { state: 'not_entered', empty: t.empty_cells, total: t.total_cells };
  if (t.empty_cells > 0) return { state: 'partial', empty: t.empty_cells, total: t.total_cells };
  return { state: 'entered', empty: 0, total: t.total_cells };
}
const notEntered = (D, code, year, month) => monthState(D, code, year, month).state === 'not_entered';

module.exports = { monthState, notEntered };
