/* pageHead.js — C-10 (G16 / G30) shared page anatomy: one header block that says, before any figure,
 *   · the QUESTION the page answers,
 *   · its SCOPE (which sites / population),
 *   · its TIME WINDOW,
 *   · its FRESHNESS — how recent the data is ("Data through …", per source), and, when the page has one,
 *     when the response was computed ("Computed at …", C-05 / F21).
 *
 *   PageHead.render(spec)               → HTML string (pure, escaped)
 *   PageHead.freshness(sources, opts)   → { items:[{label, text, known}], text, known } (pure)
 *   PageHead.fmtWhen(v, lang)           → 'DD Mon YYYY HH:MM UTC' | 'DD Mon YYYY' | null (pure)
 *   PageHead.mount(el, spec)            → writes render(spec) into el (no-op without el)
 *
 * spec = { question, scope, window, sources, computedAt, lang, note }
 *   Text fields accept a string or { en, fr }. sources === false means the page shows no figures (no freshness row). sources accepts [{ label, at }] or the C-05 dashboards shape
 *   [{ module, last_success }] — reused as-is, never re-derived.
 * Rules: a freshness date is NEVER invented. A source without a date reads "never synced"; no source at all
 * reads "unknown". 0, '' and garbage are "no date", never 1970 nor the browser clock. Dates print in UTC so
 * every screen shows the same text whatever the browser's time zone.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PageHead = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STR = {
    en: { question: 'Question', scope: 'Scope', window: 'Time window', freshness: 'Data through',
          computed: 'Computed at', never: 'never synced', unknown: 'unknown', aria: 'About this page' },
    fr: { question: 'Question', scope: 'Périmètre', window: 'Période', freshness: 'Données au',
          computed: 'Calculé le', never: 'jamais synchronisé', unknown: 'inconnue', aria: 'À propos de cette page' },
  };
  var MON = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
              fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] };
  function L(lang) { return lang === 'fr' ? 'fr' : 'en'; }
  function txt(v, lang) {
    if (v == null) return '';
    if (typeof v === 'object') return String(v[L(lang)] != null ? v[L(lang)] : (v.en != null ? v.en : ''));
    return String(v);
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // → { d: Date, dateOnly: bool } | null
  function parse(v) {
    if (v == null || v === '' || v === 0) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : { d: v, dateOnly: false };
    if (typeof v === 'number') return isFinite(v) && v > 0 ? { d: new Date(v), dateOnly: false } : null;
    var s = String(v).trim();
    if (!s) return null;
    var dateOnly = false;
    if (/^\d+$/.test(s)) { var n = Number(s); return n > 0 ? { d: new Date(n), dateOnly: false } : null; }
    if (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(s)) s = s.replace(' ', 'T') + 'Z';   // UTC without a zone
    else if (/^\d{4}-\d\d-\d\d$/.test(s)) { s = s + 'T00:00:00Z'; dateOnly = true; }
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : { d: d, dateOnly: dateOnly };
  }
  function fmtWhen(v, lang) {
    var p = parse(v); if (!p) return null;
    var d = p.d, l = L(lang);
    var day = pad(d.getUTCDate()) + ' ' + MON[l][d.getUTCMonth()] + ' ' + d.getUTCFullYear();
    return p.dateOnly ? day : day + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
  }

  function freshness(sources, opts) {
    var lang = L(opts && opts.lang), t = STR[lang];
    var list = Array.isArray(sources) ? sources : [];
    var items = list.map(function (x) {
      x = x || {};
      var label = txt(x.label != null ? x.label : x.module, lang);
      var at = x.at !== undefined ? x.at : x.last_success;
      var when = fmtWhen(at, lang);
      return { label: label, text: when || t.never, known: !!when };
    });
    var text = items.length
      ? items.map(function (i) { return (i.label ? i.label + ' ' : '') + i.text; }).join(' · ')
      : t.unknown;
    return { items: items, text: text, known: items.length > 0 && items.every(function (i) { return i.known; }) };
  }

  function row(cls, label, valueHtml) {
    return '<div class="edv-page-head__row edv-page-head__' + cls + '"><dt>' + esc(label) + '</dt><dd>' + valueHtml + '</dd></div>';
  }
  function render(spec) {
    spec = spec || {};
    var lang = L(spec.lang), t = STR[lang];
    var q = txt(spec.question, lang), sc = txt(spec.scope, lang), w = txt(spec.window, lang), note = txt(spec.note, lang);
    var f = freshness(spec.sources, { lang: lang });
    var fHtml = f.items.length
      ? f.items.map(function (i) {
          return '<span class="edv-page-head__src' + (i.known ? '' : ' is-unknown') + '">' +
            (i.label ? '<span class="edv-page-head__srcname">' + esc(i.label) + '</span> ' : '') + esc(i.text) + '</span>';
        }).join('<span class="edv-page-head__sep" aria-hidden="true"> · </span>')
      : '<span class="edv-page-head__src is-unknown">' + esc(t.unknown) + '</span>';
    var html = '<dl class="edv-page-head__grid">';
    if (q) html += row('q', t.question, esc(q));
    html += row('scope', t.scope, esc(sc || t.unknown));
    if (w) html += row('window', t.window, esc(w));
    if (spec.sources !== false) html += row('fresh', t.freshness, fHtml);   // false = the page shows no figures
    if (spec.computedAt !== undefined) html += row('computed', t.computed, esc(fmtWhen(spec.computedAt, lang) || t.unknown));
    html += '</dl>';
    if (note) html += '<p class="edv-page-head__note">' + esc(note) + '</p>';
    return '<section class="edv-page-head" data-page-head="1" aria-label="' + esc(t.aria) + '">' + html + '</section>';
  }
  function mount(el, spec) { if (el) el.innerHTML = render(spec); return el; }

  return { render: render, freshness: freshness, fmtWhen: fmtWhen, mount: mount, STR: STR };
});
