/* Adoption Lot A (item 3) — ONE definition of the Zoho week and of "the week a weekly report is due", shared by the
 * server (reports-db getPreviousWeek / getWeekRange, /api/reports/current-week, Home "My work") and the browser
 * (report week picker, Home, Helpdesk week labels). Before this, the same day showed three different weeks: Home W45,
 * the report picker W44 (it stepped back a SECOND time from an already-previous week) and the Helpdesk W46.
 *
 *   ReportingWeek.weekOf(date)        → { year, week }   Zoho week: W01 starts on the first Sunday of the year (UTC)
 *   ReportingWeek.range(year, week)   → { start, end }    ISO dates, Sunday → Saturday
 *   ReportingWeek.previous(year, week) → { year, week }   the week before (W53 of a 53-week year included)
 *   ReportingWeek.dueWeek(now)        → { year, week }    the week the weekly report covers = the PREVIOUS week
 *   ReportingWeek.currentWeek(now)    → { year, week }    the week in progress (live helpdesk view)
 *   ReportingWeek.label(year, week, lang) → "W45 (08–14 nov.)" / "W45 (08–14 Nov)" — every week label carries its dates
 *
 * Dates are calendar dates, computed in UTC from the caller's calendar day (sites run on GMT). UMD: Node + browser. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const MON = {
    en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  };
  function firstSunday(year) {
    const d = new Date(Date.UTC(Number(year), 0, 1));
    const dow = d.getUTCDay();
    if (dow !== 0) d.setUTCDate(d.getUTCDate() + (7 - dow));
    return d;
  }
  // The caller's calendar day (local getters, as reports-db always did), as a UTC midnight.
  function dayOf(date) {
    const d = date instanceof Date ? date : new Date(date);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  function weekOf(date) { return _weekOfUtcDay(dayOf(date)); }
  // d is already a UTC midnight (no local getters): DST-proof — a BST Sunday never falls into the previous week.
  function _weekOfUtcDay(d) {
    let year = d.getUTCFullYear();
    let fs = firstSunday(year);
    if (d < fs) { year -= 1; fs = firstSunday(year); }
    return { year, week: Math.floor((d - fs) / (7 * DAY)) + 1 };
  }
  function range(year, week) {
    const s = new Date(firstSunday(year).getTime() + (Number(week) - 1) * 7 * DAY);
    const e = new Date(s.getTime() + 6 * DAY);
    return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
  }
  // The week before (year, week) — crosses into the previous year's LAST week, W53 included (P11 F-19: the Helpdesk
  // comparison skipped 2028-W53 by asking for the week of 28 December).
  function previous(year, week) {
    if (Number(week) > 1) return { year: Number(year), week: Number(week) - 1 };
    return _weekOfUtcDay(new Date(firstSunday(year).getTime() - DAY));
  }
  function shift(now, days) { const d = now ? new Date(now) : new Date(); d.setDate(d.getDate() + days); return d; }
  function dueWeek(now) { return weekOf(shift(now, -7)); }
  function currentWeek(now) { return weekOf(now ? new Date(now) : new Date()); }
  function label(year, week, lang) {
    const r = range(year, week);
    const m = MON[lang === 'fr' ? 'fr' : 'en'];
    const [, sm, sd] = r.start.split('-').map(Number);
    const [, em, ed] = r.end.split('-').map(Number);
    const p = (n) => String(n).padStart(2, '0');
    const span = sm === em ? `${p(sd)}–${p(ed)} ${m[em - 1]}` : `${p(sd)} ${m[sm - 1]} – ${p(ed)} ${m[em - 1]}`;
    return `${lang === 'fr' ? 'S' : 'W'}${p(week)} (${span})`;   // I18N-QUALITY — « S45 » in French (semaine)
  }
  const api = { firstSunday, weekOf, range, previous, dueWeek, currentWeek, label };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReportingWeek = api;
})(typeof self !== 'undefined' ? self : this);
