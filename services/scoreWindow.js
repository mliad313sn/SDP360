'use strict';
// rollingWindow(asOf, months=3) → { from, to } as ISO 'YYYY-MM-DD' strings.
// The score model compares dates as STRINGS (lexicographic ISO), never Date
// objects — so this returns strings and does its own calendar math to avoid
// Date's timezone/rollover surprises (new Date('2026-05-31') minus 3 months
// via setMonth famously lands on 3 March).
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const p2 = (n) => String(n).padStart(2, '0');

function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }   // m is 1-based; day 0 of next month

function rollingWindow(asOf, months = 3) {
  if (!ISO.test(String(asOf || ''))) throw new Error(`rollingWindow: asOf must be 'YYYY-MM-DD', got "${asOf}"`);
  const [y, m, d] = asOf.split('-').map(Number);
  let fy = y, fm = m - months;
  while (fm <= 0) { fm += 12; fy -= 1; }
  const fd = Math.min(d, daysInMonth(fy, fm));   // clamp: 31 May − 3mo → 28/29 Feb
  return { from: `${fy}-${p2(fm)}-${p2(fd)}`, to: asOf };
}

// prevDay(iso) → the ISO date one day earlier. UTC-anchored so there is no
// local-timezone rollover; returns a string because the whole model compares
// strings.
function prevDay(iso) {
  if (!ISO.test(String(iso || ''))) throw new Error(`prevDay: expected 'YYYY-MM-DD', got "${iso}"`);
  const t = Date.UTC(...iso.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n))) - 86400000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

module.exports = { rollingWindow, prevDay };
