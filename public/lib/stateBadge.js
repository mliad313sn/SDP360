/* SDP360 — E-V03 — the standard state vocabulary (audit §5.3): ten states a figure, a chart or a page can be in,
 * each = a symbol + a text + an accessible name, never a colour alone. UMD: window.StateBadge in the browser,
 * module.exports in Node. Pure HTML strings, no DOM.
 *
 *   STATES                      { key: { symbol, text, aria } }  (English; French in public/lib/i18n/dashboards.fr.js)
 *   text(key, variant)          the plain text of a state ('stale' has the variant 'never' = source never synced)
 *   badge(key, opts)            <span class="edv-state edv-state-<key>" role="status" aria-label="…">symbol text</span>
 *   KEYS                        the ten keys, in the audit's order
 *
 * The texts of the states the dashboards already showed are kept byte-identical (they are pinned by tests):
 *   not-measured "not measured" (KPI card: "— not measured"), stale "Source not current — colour withheld",
 *   stale/never "Source never synced — colour withheld".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StateBadge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATES = {
    'loading':             { symbol: '…', text: 'Loading…',                              aria: 'loading' },
    'no-data':             { symbol: '∅', text: 'No data for this period',               aria: 'no data for this period' },
    'not-measured':        { symbol: '—', text: 'not measured',                          aria: 'not measured' },
    'stale':               { symbol: '–', text: 'Source not current — colour withheld',  aria: 'stale source, colour withheld',
                             never: { text: 'Source never synced — colour withheld', aria: 'source never synced, colour withheld' } },
    'unmonitored':         { symbol: '○', text: 'Source not monitored',                  aria: 'source not monitored' },
    'error':               { symbol: '⚠', text: 'Could not load — try again',            aria: 'error' },
    'no-right':            { symbol: '⊘', text: 'You do not have access to this figure', aria: 'no access' },
    'uncertified':         { symbol: '◇', text: 'Value not certified',                   aria: 'value not certified' },
    'export-in-progress':  { symbol: '↻', text: 'Export in progress',                    aria: 'export in progress' },
    'publication-blocked': { symbol: '⊗', text: 'Publication blocked',                   aria: 'publication blocked' },
  };
  var KEYS = ['loading', 'no-data', 'not-measured', 'stale', 'unmonitored', 'error', 'no-right', 'uncertified', 'export-in-progress', 'publication-blocked'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function def(key, variant) {
    var s = STATES[key]; if (!s) throw new Error('unknown state ' + key);
    return variant && s[variant] ? { symbol: s.symbol, text: s[variant].text, aria: s[variant].aria } : s;
  }
  function text(key, variant) { return def(key, variant).text; }
  function aria(key, variant) { return def(key, variant).aria; }
  function symbol(key) { return def(key).symbol; }
  /** opts: { variant, detail } — detail is appended after the text (escaped). */
  function badge(key, opts) {
    var o = opts || {}; var s = def(key, o.variant);
    return '<span class="edv-state edv-state-' + key + '" role="status" aria-label="' + esc(s.aria + (o.detail ? ': ' + o.detail : '')) + '">' +
      '<span class="edv-state-sym" aria-hidden="true">' + s.symbol + '</span> ' + esc(s.text) + (o.detail ? ' — ' + esc(o.detail) : '') + '</span>';
  }

  return { STATES: STATES, KEYS: KEYS, text: text, aria: aria, symbol: symbol, badge: badge };
});
