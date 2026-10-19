/* SDP Dashboard — Step 6 — pure helpers shared by the dashboard viewer, the composer and the
 * server data route (UMD: browser global `DashboardRender`, Node require). No DOM, no fetch.
 *   gridStyle(layout, columns)      -> inline CSS grid placement
 *   formatValue(value, unit)        -> "92.4 %", "1 204", "3.5 h", "—" for null (null ≠ 0)
 *   ragClass(rag)                   -> 'rag-green' | 'rag-amber' | 'rag-red' | 'rag-na'
 *   windowSeries(kind, n, now)      -> the last n window labels for a trend (oldest first)
 *   widgetDataPlan(widget, def)     -> what the data route must resolve for this widget
 *   summarizeGrid(rows)             -> counts per RAG for a ragGrid header
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DashboardRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function gridStyle(layout, columns) {
    var L = layout || {}; var c = columns || 12;
    return 'grid-column:' + ((L.x || 0) + 1) + ' / span ' + Math.min(L.w || 1, c) + ';grid-row:' + ((L.y || 0) + 1) + ' / span ' + (L.h || 1) + ';';
  }

  function formatValue(value, unit) {
    if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) return '—';
    var n = Number(value);
    if (typeof value !== 'number' && isNaN(n)) return String(value);
    var u = String(unit || '').toLowerCase();
    var s;
    if (u === '%') s = (Math.round(n * 10) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 }) + ' %';
    else if (u === 'hours' || u === 'h') s = (Math.round(n * 10) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 }) + ' h';
    else if (u === 'ms') s = Math.round(n).toLocaleString('en-GB') + ' ms';
    else if (u === 'points' || u === 'pts') s = (Math.round(n * 10) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 }) + ' pts';
    else if (u === 'rank') s = '#' + Math.round(n);
    else if (u === 'usd') s = Math.round(n).toLocaleString('en-GB') + ' USD';
    else s = Number.isInteger(n) ? n.toLocaleString('en-GB') : (Math.round(n * 10) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 });
    return s;
  }

  function ragClass(rag) {
    var r = String(rag || 'NA').toUpperCase();
    return r === 'GREEN' ? 'rag-green' : r === 'AMBER' ? 'rag-amber' : r === 'RED' ? 'rag-red' : 'rag-na';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
    var y = t.getUTCFullYear(); var jan1 = new Date(Date.UTC(y, 0, 1));
    return { year: y, week: Math.ceil(((t - jan1) / 86400000 + 1) / 7) };
  }

  /** Window labels understood by the metric registry (`YYYY-Www` for weeks, `YYYY-MM` for months). */
  function windowSeries(kind, n, now) {
    var d = now ? new Date(now) : new Date(); var out = [];
    n = Math.max(1, Math.min(60, n || 13));
    if (kind === 'week' || kind === 'rolling13w') {
      var cur = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      cur.setUTCDate(cur.getUTCDate() - 7);                     // the previous FULL week = the latest report period
      for (var i = n - 1; i >= 0; i--) { var w = new Date(cur); w.setUTCDate(cur.getUTCDate() - 7 * i); var iw = isoWeek(w); out.push(iw.year + '-W' + pad2(iw.week)); }
      return out;
    }
    var y = d.getUTCFullYear(), m = d.getUTCMonth();
    for (var j = n - 1; j >= 0; j--) { var mm = new Date(Date.UTC(y, m - j, 1)); out.push(mm.getUTCFullYear() + '-' + pad2(mm.getUTCMonth() + 1)); }
    return out;
  }

  /** Default trend length from the widget's window hint: '13w' → 13 weeks, '6m' → 6 months. */
  function trendLength(w, metricKind) {
    var m = /^(\d+)([wm])$/.exec(String(w && w.window || ''));
    if (m) return { n: +m[1], kind: m[2] === 'w' ? 'week' : 'month' };
    return { n: metricKind === 'month' || metricKind === 'ytd' || metricKind === 'rolling3m' ? 6 : 13, kind: metricKind === 'month' || metricKind === 'ytd' || metricKind === 'rolling3m' ? 'month' : 'week' };
  }

  /** The resolution plan: single value, per-site grid, or a time series. */
  function widgetDataPlan(w, metricKind) {
    if (!w) return null;
    if (w.type === 'kpi') return { mode: 'single', compare: w.compare === 'fleet' };
    if (w.type === 'trend') { var t = trendLength(w, metricKind); return { mode: 'series', n: t.n, kind: t.kind }; }
    if (w.type === 'ragGrid' || w.type === 'heatmap' || w.type === 'bar' || w.type === 'table') return { mode: 'per-site' };
    if (w.type === 'actions') return { mode: 'actions', sources: w.sources || ['meetings', 'inspection', 'report'], onlyOverdue: !!w.onlyOverdue };
    if (w.type === 'trackerRag') return { mode: 'tracker' };
    return { mode: 'none' };
  }

  function summarizeGrid(rows) {
    var c = { GREEN: 0, AMBER: 0, RED: 0, NA: 0 };
    (rows || []).forEach(function (r) { var k = String(r && r.rag || 'NA').toUpperCase(); c[k in c ? k : 'NA']++; });
    return c;
  }

  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }

  /** Minimal Markdown for the text widget: **bold**, *italic*, line breaks — escaped first. */
  function miniMarkdown(md) {
    var s = escapeHtml(md);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return s.split(/\n{2,}/).map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('');
  }

  return { gridStyle, formatValue, ragClass, windowSeries, trendLength, widgetDataPlan, summarizeGrid, escapeHtml, miniMarkdown, isoWeek };
});
