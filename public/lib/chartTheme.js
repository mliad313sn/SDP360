/* SDP360 — A-22 — ONE Chart.js theme, read from the design tokens (public/_tokens.css).
 * UMD: browser global `ChartTheme`, Node require. Loaded right after Chart.js on every chart page;
 * it applies itself to window.Chart on load, so no page needs an inline call.
 *   read(getVar)          -> { rag:{green,amber,red,na}, series:[6], target, grid, text, font }
 *   colors                -> read() against the live page (getComputedStyle on <html>)
 *   alpha(hex, a)         -> 'rgba(r,g,b,a)' fill for a token colour
 *   apply(Chart, {getVar, locale}) -> sets Chart.defaults (font ≥ 12 px, legend bottom, token ink, locale)
 * RAG names come from the tokens, never re-derived here: thresholds live in public/lib/kpiRag.js.
 * Series colours are categorical, in fixed order (validated: see docs/ai-decisions/ADR-A22-chart-theme.md);
 * they are NOT status colours. Fallbacks equal the token values (pinned by tests/chart-theme.test.js). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.ChartTheme = factory();
    if (root.Chart) root.ChartTheme.apply(root.Chart);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FALLBACK = {
    '--rag-green': '#1E7B45', '--rag-amber': '#B45309', '--rag-red': '#B91C1C', '--rag-na': '#7C8796',
    '--chart-series-1': '#145FAE', '--chart-series-2': '#C2410C', '--chart-series-3': '#0891B2',
    '--chart-series-4': '#7C3AED', '--chart-series-5': '#A16207', '--chart-series-6': '#BE185D',
    '--chart-target': '#3A4A60', '--chart-grid': '#E2E5EA', '--chart-text': '#524F4E',
    '--font-sans': "'Libre Franklin', 'Franklin Gothic', system-ui, -apple-system, 'Segoe UI', sans-serif",
  };
  var MIN_FONT = 12;

  function domGetVar() {
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function' || !document.documentElement) return function () { return ''; };
    var cs = getComputedStyle(document.documentElement);
    return function (n) { return cs.getPropertyValue(n); };
  }

  function read(getVar) {
    var g = typeof getVar === 'function' ? getVar : domGetVar();
    function v(n) { var x = String(g(n) || '').trim(); return x || FALLBACK[n]; }
    return {
      rag: { green: v('--rag-green'), amber: v('--rag-amber'), red: v('--rag-red'), na: v('--rag-na') },
      series: [1, 2, 3, 4, 5, 6].map(function (i) { return v('--chart-series-' + i); }),
      target: v('--chart-target'), grid: v('--chart-grid'), text: v('--chart-text'),
      font: v('--font-sans').replace(/\s+/g, ' '),
    };
  }

  function alpha(hex, a) {
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
    if (!m) return hex;
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }

  function pageLocale() {
    if (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) {
      var l = document.documentElement.lang; return l === 'fr' ? 'fr-FR' : l === 'en' ? 'en-GB' : l;
    }
    return 'en-GB';
  }

  function apply(Chart, opts) {
    if (!Chart || !Chart.defaults) return false;
    var o = opts || {};
    var c = read(o.getVar);
    var d = Chart.defaults;
    d.font = d.font || {};
    d.font.family = c.font;
    d.font.size = Math.max(MIN_FONT, Number(d.font.size) || 0);
    d.color = c.text;
    d.locale = o.locale || pageLocale();
    d.plugins = d.plugins || {};
    d.plugins.legend = d.plugins.legend || {};
    d.plugins.legend.position = 'bottom';
    d.scale = d.scale || {};
    d.scale.grid = d.scale.grid || {};
    d.scale.grid.color = c.grid;
    return true;
  }

  var api = { read: read, alpha: alpha, apply: apply, MIN_FONT: MIN_FONT, FALLBACK: FALLBACK };
  Object.defineProperty(api, 'colors', { enumerable: true, get: function () { return read(); } });
  return api;
});
