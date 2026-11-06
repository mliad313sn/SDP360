/* SDP360 — E-V02 — measure → chart contract, ONE rule table shared by the composer (browser) and the dashboard
 * API (services/dashboardWidgets.validateDashboard). UMD: window.ChartContract in the browser, module.exports in
 * Node. Pure: no DOM, no server.
 *
 *   measureKind(metric)               { kind: 'rate'|'count'|'hours'|'rank'|'points'|'other', snapshot: bool }
 *   contractError(type, metric, w)    null, or why this widget type cannot draw this metric (plain words + what to use)
 *
 * The rules come from the audit's measure → chart matrix (§5.2): ratios are never added (no stacked rate), a site
 * grid needs a RAG policy (unknown ≠ green), a rank is not a magnitude (no bar), a snapshot has no history (no trend).
 * `stacked` is also refused on ANY bar because no renderer draws it (X-V-01): the author would silently get a plain
 * list. These rules apply to NEW widgets; stored definitions keep rendering (see validateDashboard opts).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChartContract = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var UNIT_KIND = { '%': 'rate', count: 'count', hours: 'hours', h: 'hours', rank: 'rank', points: 'points', pts: 'points' };

  function measureKind(metric) {
    if (!metric) return { kind: 'other', snapshot: false };
    var u = String(metric.unit == null ? '' : metric.unit).trim().toLowerCase();
    return { kind: UNIT_KIND[u] || 'other', snapshot: metric.window_kind === 'current' };
  }

  function label(m) { return m ? (m.name || m.key || '') : ''; }

  /**
   * @param {string} type     widget type
   * @param {object} metric   registry row ({key, name, unit, window_kind, rag_policy}) or null when unknown
   * @param {object} [w]      widget props (stacked, rag)
   */
  function contractError(type, metric, w) {
    w = w || {};
    var mk = measureKind(metric);
    if (type === 'bar' && w.stacked) {
      if (mk.kind === 'rate') return 'Ratios cannot be stacked — “' + label(metric) + '” is a percentage; stacking adds ratios. Use a bar without stacking, a ragGrid or a table.';
      return 'Stacked bars are not drawn by the dashboard (the bar widget renders a plain ordered list) — remove “stacked”, or use a table.';
    }
    if (type === 'bar' && mk.kind === 'rank') return 'A rank is not a magnitude — a bar of “' + label(metric) + '” would mislead. Use a table (sorted by rank) or a ragGrid.';
    if (type === 'ragGrid' && metric && !metric.rag_policy && !w.rag) return 'A site grid needs colour thresholds — “' + label(metric) + '” has no RAG policy. Pick a RAG policy or use a table.';
    if (type === 'trend' && metric && mk.snapshot) return 'A trend needs a time series, but “' + label(metric) + '” is a current snapshot with no history — use a KPI tile or a site comparison.';
    return null;
  }

  return { UNIT_KIND: UNIT_KIND, measureKind: measureKind, contractError: contractError };
});
