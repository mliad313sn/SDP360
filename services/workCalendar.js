'use strict';
// Committee #40 — working days. PURE. The off days of a context ride on the resolved policy object as the
// non-enumerable property __off_days (set by services/governancePolicy.js from the site_calendar table),
// and the policy `calendar.skip_weekends` adds Saturdays and Sundays. With no calendar and the switch off,
// every function here gives exactly the calendar-day answer used until now.
const DAY = 864e5;
const t = (d) => Date.parse(String(d || '').slice(0, 10) + 'T00:00:00Z');
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

function offOf(pol) { const a = pol && pol.__off_days; return a instanceof Set ? a : new Set(Array.isArray(a) ? a : []); }
const skipWeekends = (pol) => !!(pol && pol['calendar.skip_weekends'] === true);
/** Attach off days to a policy snapshot without changing its keys (non-enumerable). */
function withOffDays(pol, days) { const out = pol || {}; Object.defineProperty(out, '__off_days', { value: [...new Set(days || [])].sort(), enumerable: false, configurable: true, writable: true }); return out; }

function isOff(day, pol) {
  const d = String(day || '').slice(0, 10); if (!d) return false;
  if (offOf(pol).has(d)) return true;
  if (skipWeekends(pol)) { const w = new Date(t(d)).getUTCDay(); if (w === 0 || w === 6) return true; }
  return false;
}
/** Working days in (from, to] — 0 when to <= from. */
function workingDaysAfter(from, to, pol) {
  const a = t(from), b = t(to); if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  const off = offOf(pol);
  if (!off.size && !skipWeekends(pol)) return Math.round((b - a) / DAY);
  let n = 0; for (let x = a + DAY, i = 0; x <= b && i < 4000; x += DAY, i++) if (!isOff(iso(x), pol)) n++;
  return n;
}
module.exports = { isOff, workingDaysAfter, withOffDays, offOf };
