/* Activity Tracker — closed months (2026-10-16).
 *
 * Below super_admin, a month stays editable while it is the current calendar month,
 * and the previous month stays editable up to the GRACE_DAY-th of the current month
 * (time to finish entering last month). Anything older is CLOSED: only super_admin
 * may change it. Future months are untouched by this rule.
 *
 * UMD: the browser (Input tab) and the server (save path) use the same rule.
 * Months are 0-based here (Jan = 0), years are calendar years.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrackerMonthLock = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GRACE_DAY = 5;

  const key = (year, month0) => Number(year) * 12 + Number(month0);

  // First editable month key: months strictly below it are closed.
  function cutoff(now) {
    const d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const cur = key(d.getFullYear(), d.getMonth());
    return d.getDate() <= GRACE_DAY ? cur - 1 : cur;
  }

  function isClosed(year, month0, now) {
    return key(year, month0) < cutoff(now);
  }

  // Server guard: keep the STORED value for every closed month. `stored` may be null
  // (no row yet) — a closed month then keeps 0 instead of accepting a new value.
  // Returns { months, blocked } where blocked = closed months whose value differed.
  function mergeClosed(year, incoming, stored, now) {
    const c = cutoff(now);
    const out = Array.isArray(incoming) ? incoming.slice() : [];
    let blocked = 0;
    for (let m = 0; m < 12; m++) {
      if (key(year, m) >= c) continue;
      const keep = Array.isArray(stored) && stored[m] != null ? stored[m] : 0;
      const got = out[m] == null ? 0 : out[m];
      if (Number(got) !== Number(keep)) blocked++;
      out[m] = keep;
    }
    return { months: out, blocked };
  }

  function label(now) {
    const c = cutoff(now);
    const y = Math.floor(c / 12), m = c % 12;
    return { year: y, month0: m };
  }

  return { GRACE_DAY, cutoff, isClosed, mergeClosed, label };
});
