'use strict';
// D-05 (AMDEC AM-09) — paging of GET /api/reports for the report list page.
// Without ?limit / ?offset the route returns the whole array exactly as before (every other caller).
// With either, it returns { rows, total, limit, offset } — limit clamped to 1..100 (default 20 = the
// first 20 cards the page always showed), offset >= 0. D-03: when ui_week_labels = 'explicit', each row
// gains week_display = "W37 2026 (13–19 Sep)" (the Zoho Sun→Sat range); legacy adds nothing.
const weekLabels = require('./weekLabels');

async function pageReports(rows, query, rdb) {
  const list = Array.isArray(rows) ? rows : [];
  const q = query || {};
  const mode = rdb ? await weekLabels.weekLabelMode(require('./reportConfig'), rdb.db) : 'legacy';
  if (mode === 'explicit') for (const r of list) r.week_display = weekLabels.zohoWeekLabel(r.week_label, r.start_date, r.end_date, mode);
  const { limit, offset } = q;
  if (limit == null && offset == null) return list;
  const lim = Math.max(1, Math.min(100, Math.floor(Number(limit)) || 20));
  const off = Math.max(0, Math.floor(Number(offset)) || 0);
  return { rows: list.slice(off, off + lim), total: list.length, limit: lim, offset: off };
}

module.exports = { pageReports };
