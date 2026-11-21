/* SDPFormat — dates, numbers, percentages, durations and week labels in the reader's language (I18N-QUALITY,
 * 2026-11-21). One place so a French page shows « 1 629 », « 73,5 % », « 15 janv. 2026 », « S45 » and an English
 * page « 1,629 », « 73.5% », « 15 Jan 2026 », « W45 ».
 *
 *   SDPFormat.lang()                       'fr' | 'en' — the language the page BODY is shown in (see below)
 *   SDPFormat.date(v[, {lang}])            ISO date / datetime / Date / epoch ms → '15 janv. 2026'
 *   SDPFormat.dateTime(v[, {lang}])        → '15 janv. 2026, 07:20 UTC' (UTC on every screen, like lib/trustLabel.js)
 *   SDPFormat.number(n[, {decimals, lang}])→ '1 629' / '1,629'
 *   SDPFormat.percent(n[, {decimals, lang}]) n is already a percentage (73.5 → '73,5 %' / '73.5%')
 *   SDPFormat.duration(hours[, {lang}])    → '45 min' · '3,5 h' · '1 j 22 h' (EN: '45m' · '3.5h' · '1d 22h')
 *   SDPFormat.week(w[, {lang}])            42 | '2026-W45' | Date → 'S45' / 'W45'
 *   SDPFormat.plural(n, one, many[, {lang}]) the word that agrees with n (French: 0 and 1 are singular)
 *
 * The unknown stays unknown: null, undefined, '' and anything that is not a finite number / valid date give '—',
 * never 0 (CLAUDE.md: null = not measured).
 * Language: an explicit {lang} wins; otherwise the page's translation layer when it is installed
 * (<html data-i18n="on"> + I18nText — the same source lib/i18n/boot.js installs), otherwise <html lang>. An English
 * page body therefore keeps English formats even when the menu is French (no mixed page).
 * UMD: browser global SDPFormat, CommonJS in Node (tests pass {lang}).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.SDPFormat = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var DASH = '—';
  var NNBSP = '\u202F';           // narrow no-break space: French thousands separator and space before % / units
  var LOCALE = { fr: 'fr-FR', en: 'en-GB' };

  function lang(o) {
    if (o && (o.lang === 'fr' || o.lang === 'en')) return o.lang;
    try {
      var g = root || (typeof window !== 'undefined' ? window : {});
      var de = g.document && g.document.documentElement;
      if (de && de.dataset && de.dataset.i18n === 'on' && g.I18nText && g.I18nText.lang) return g.I18nText.lang() === 'fr' ? 'fr' : 'en';
      if (de && /^fr/i.test(de.lang || '')) return 'fr';
    } catch (_) { /* no DOM */ }
    return 'en';
  }
  function num(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    var n = typeof v === 'number' ? v : Number(String(v).trim());
    return isFinite(n) ? n : null;
  }
  function nf(l, d) {
    var x = d == null ? null : Math.max(0, Math.min(6, d | 0));
    return new Intl.NumberFormat(LOCALE[l], x == null ? { maximumFractionDigits: 1 } : { minimumFractionDigits: x, maximumFractionDigits: x });
  }
  // fr-FR groups with U+202F in current ICU and U+00A0 in older ones: normalise to the narrow one.
  function frSpaces(s) { return s.replace(/[\u00A0\u202F ]/g, NNBSP); }

  function number(n, o) {
    var x = num(n); if (x === null) return DASH;
    var l = lang(o), s = nf(l, o && o.decimals).format(x);
    return l === 'fr' ? frSpaces(s) : s;
  }
  function percent(n, o) {
    var x = num(n); if (x === null) return DASH;
    var l = lang(o), d = o && o.decimals != null ? o.decimals : null;
    var s = d == null ? nf(l, null).format(Math.round(x * 10) / 10) : nf(l, d).format(x);
    return l === 'fr' ? frSpaces(s) + NNBSP + '%' : s + '%';
  }

  function parseDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : { d: v, dateOnly: false };
    if (typeof v === 'number') return isFinite(v) && v > 0 ? { d: new Date(v), dateOnly: false } : null;
    var s = String(v).trim(); if (!s) return null;
    var dateOnly = false;
    if (/^\d{4}-\d\d-\d\d$/.test(s)) { s += 'T00:00:00Z'; dateOnly = true; }
    else if (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(s)) s = s.replace(' ', 'T') + 'Z';   // stored UTC without a zone
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : { d: d, dateOnly: dateOnly };
  }
  function date(v, o) {
    var p = parseDate(v); if (!p) return DASH;
    var l = lang(o);
    var s = new Intl.DateTimeFormat(LOCALE[l], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(p.d);
    return l === 'fr' ? s.replace(/\u00A0/g, ' ') : s;
  }
  function dateTime(v, o) {
    var p = parseDate(v); if (!p) return DASH;
    if (p.dateOnly) return date(v, o);
    var l = lang(o);
    var hm = new Intl.DateTimeFormat(LOCALE[l], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(p.d);
    return date(p.d, o) + (l === 'fr' ? ' à ' : ', ') + hm + ' UTC';
  }

  function duration(hours, o) {
    var h = num(hours); if (h === null || h < 0) return DASH;
    var l = lang(o), fr = l === 'fr';
    if (h === 0) return fr ? '0' + NNBSP + 'h' : '0h';
    if (h < 1) { var m = Math.round(h * 60); return fr ? m + NNBSP + 'min' : m + 'm'; }
    if (h < 24) {
      var r = Math.round(h * 10) / 10, t = Math.round(h) === r ? String(Math.round(h)) : (fr ? String(r).replace('.', ',') : String(r));
      return fr ? t + NNBSP + 'h' : t + 'h';
    }
    var days = Math.floor(h / 24), rem = Math.round(h - days * 24);
    if (rem === 24) { days++; rem = 0; }
    if (fr) return days + NNBSP + 'j' + (rem > 0 ? ' ' + rem + NNBSP + 'h' : '');
    return days + 'd' + (rem > 0 ? ' ' + rem + 'h' : '');
  }

  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
    var y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  }
  function week(w, o) {
    var n = null;
    if (typeof w === 'number') n = isFinite(w) ? w : null;
    else if (w instanceof Date) n = isNaN(w.getTime()) ? null : isoWeek(w);
    else if (typeof w === 'string') {
      var m = w.trim().match(/^(?:\d{4}-?)?[WwSs]?(\d{1,2})$/);
      if (m) n = Number(m[1]);
      else { var p = parseDate(w); n = p ? isoWeek(p.d) : null; }
    }
    if (n === null || n < 1 || n > 53 || Math.floor(n) !== n) return DASH;
    return (lang(o) === 'fr' ? 'S' : 'W') + n;
  }

  function plural(n, one, many, o) {
    var x = num(n);
    if (x === null) return many;
    try { return new Intl.PluralRules(LOCALE[lang(o)]).select(x) === 'one' ? one : many; }
    catch (_) { return (lang(o) === 'fr' ? Math.abs(x) < 2 : x === 1) ? one : many; }
  }

  // VISUAL POLISH 2 — the BCP-47 locale of the interface ('fr-FR' | 'en-GB'), for the pages that still call
  // Date/Number.toLocale*String themselves: one locale per page instead of the browser's or a hard-coded one.
  function locale(o) { return LOCALE[lang(o)]; }
  try { var g = root || (typeof window !== 'undefined' ? window : null); if (g && typeof g.document !== 'undefined') g.SDPLocale = function () { return locale(); }; } catch (_) { /* no window */ }
  return { lang: lang, locale: locale, number: number, percent: percent, date: date, dateTime: dateTime, duration: duration, week: week, plural: plural, isoWeek: isoWeek, DASH: DASH };
});
