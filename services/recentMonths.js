'use strict';
// Keep the rows of the last N months (from server.js, SDP-DASH-2.0 step 5).

/**
 * Filter rows to the last N months (default 13 = current + 12 previous).
 * Expects rows with a 'Created Time' field in SDP format: "15 Feb 2026, 08:34:03 AM"
 * Keeps rows whose Created Time is >= the start of (today - nMonths).
 */
function filterRecentMonths(rows, nMonths = 13) {
  const MMAP = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - nMonths);
  cutoff.setDate(1);
  cutoff.setHours(0,0,0,0);
  const before = rows.length;
  const filtered = rows.filter(r => {
    const dt = (r['Created Time'] || '').trim().split(/[\s,]+/);
    if (dt.length < 3 || !(dt[1] in MMAP)) return false;
    const d = new Date(parseInt(dt[2]), MMAP[dt[1]], parseInt(dt[0]));
    return d >= cutoff;
  });
  console.log(`[filterRecentMonths] ${before} → ${filtered.length} rows (last ${nMonths} months)`);
  return filtered;
}

module.exports = { filterRecentMonths };
