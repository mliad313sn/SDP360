'use strict';
// D-03 (AMDEC AM-07) — one week vocabulary on screen. Two week conventions coexist: the weekly REPORTS
// follow the Zoho week (Sun→Sat, getWeekRange) and the helpdesk CHARTS bucket on ISO weeks (Mon→Sun,
// siteReportDeps._lastIsoWeeks). Both used to print "W37 2026" for different days.
// report_config ui_week_labels: 'legacy' (default, today) keeps "W37 2026"; 'explicit' prints
// "ISO W37 (7–13 Sep)" on ISO charts and "W37 2026 (13–19 Sep)" on Zoho-week labels. PURE.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function normalizeMode(v) { return String(v == null ? '' : v).trim() === 'explicit' ? 'explicit' : 'legacy'; }

// '2026-09-07','2026-09-13' → '7–13 Sep' · across months '28 Sep–4 Oct'. null when a date is unreadable.
function shortRange(from, to) {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(from || '')), b = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(to || ''));
  if (!a || !b) return null;
  const d1 = +a[3], m1 = MON[+a[2] - 1], d2 = +b[3], m2 = MON[+b[2] - 1];
  if (!m1 || !m2) return null;
  return m1 === m2 && a[1] === b[1] ? `${d1}–${d2} ${m2}` : `${d1} ${m1}–${d2} ${m2}`;
}

// w = {year, week, from, to} of an ISO (Mon→Sun) week.
function isoWeekLabel(w, mode) {
  const legacy = `W${w.week} ${w.year}`;
  if (normalizeMode(mode) !== 'explicit') return legacy;
  const r = shortRange(w.from, w.to);
  return r ? `ISO W${w.week} (${r})` : `ISO W${w.week} ${w.year}`;
}

// A Zoho (Sun→Sat) report week label, e.g. 'W37 2026' + its start/end.
function zohoWeekLabel(label, start, end, mode) {
  const l = String(label || '');
  if (normalizeMode(mode) !== 'explicit') return l;
  const r = shortRange(start, end);
  return r ? `${l} (${r})` : l;
}

// Best-effort read of the switch: any failure reads 'legacy' (today).
async function weekLabelMode(reportConfig, db) {
  try { return normalizeMode((await reportConfig.getConfig(db)).ui_week_labels); } catch (_) { return 'legacy'; }
}

module.exports = { normalizeMode, shortRange, isoWeekLabel, zohoWeekLabel, weekLabelMode };
