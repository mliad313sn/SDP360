/* chartNoData.js — VISUAL POLISH 3 (UX committee executive F18, admin P3-1). One Chart.js plugin for the executive
 * pages, registered globally when this file is loaded AFTER Chart.js:
 *   • a chart with no value at all draws "No data for this period" instead of an empty 0–1.0 axis;
 *   • a TREND (a chart with a line dataset) with fewer than 3 measured points draws "Not enough data for a trend —
 *     N of 3 periods" instead of a lone dot on a 12-month axis (a per-chart `options.plugins.noData.minPoints`
 *     overrides 3; `false` switches the plugin off for that chart);
 *   • a count axis (every value on it is a whole number) shows whole ticks only.
 * It draws nothing new from data and changes no value: the figures stay in the chart's data table / tiles.
 * UMD: the pure decision is exported for the tests. */
(function (root) {
  'use strict';
  function measured(ds) { return ((ds && ds.data) || []).filter(function (v) { var n = v && typeof v === 'object' ? v.y : v; return n !== null && n !== undefined && !Number.isNaN(Number(n)); }).length; }
  /** → null (draw the chart) | { kind:'none' } | { kind:'few', have, need } */
  function verdict(type, datasets, minPoints) {
    var sets = datasets || [];
    var most = sets.reduce(function (m, ds) { return Math.max(m, measured(ds)); }, 0);
    if (!most) return { kind: 'none' };
    var trend = type === 'line' || sets.some(function (ds) { return ds && ds.type === 'line'; });
    var need = minPoints == null ? 3 : Number(minPoints);
    if (trend && most < need) return { kind: 'few', have: most, need: need };
    return null;
  }
  function fr() { try { return /^fr/i.test(document.documentElement.lang || ''); } catch (_) { return false; } }
  function text(v) {
    if (v.kind === 'none') return fr() ? 'Pas de données sur cette période' : 'No data for this period';
    return fr() ? 'Pas assez de données pour une tendance — ' + v.have + ' période' + (v.have > 1 ? 's' : '') + ' sur ' + v.need : 'Not enough data for a trend — ' + v.have + ' of ' + v.need + ' periods';
  }
  var plugin = {
    id: 'noData',
    beforeUpdate: function (chart) {
      var scales = (chart.options && chart.options.scales) || {};
      Object.keys(scales).forEach(function (id) {
        var sc = scales[id]; if (!sc || sc.type === 'category' || sc.type === 'time' || (sc.ticks && sc.ticks.precision != null)) return;
        var vals = []; (chart.data.datasets || []).forEach(function (ds) { var ax = ds.yAxisID || 'y'; if (ax !== id) return; (ds.data || []).forEach(function (v) { var n = v && typeof v === 'object' ? v.y : v; if (n != null && !Number.isNaN(Number(n))) vals.push(Number(n)); }); });
        if (vals.length && vals.every(function (n) { return Number.isInteger(n); })) { sc.ticks = sc.ticks || {}; sc.ticks.precision = 0; }
      });
    },
    beforeDraw: function (chart, args, opts) {
      if (opts === false || (opts && opts.enabled === false)) return;
      var t = chart.config.type; if (t === 'doughnut' || t === 'pie') { if (verdict('bar', chart.data.datasets) === null) return; }
      var v = verdict(t, chart.data.datasets, opts && opts.minPoints); if (!v) return;
      var c = chart.ctx, w = chart.width, h = chart.height;
      c.save(); c.clearRect(0, 0, w, h); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '600 13px ' + ((root.getComputedStyle && getComputedStyle(document.body).fontFamily) || 'sans-serif'); c.fillStyle = ((root.getComputedStyle && getComputedStyle(document.documentElement).getPropertyValue('--gray-600')) || '').trim() || 'gray';
      c.fillText(text(v), w / 2, h / 2); c.restore();
      chart.canvas.setAttribute('aria-label', text(v));
      return false;
    },
  };
  var api = { verdict: verdict, plugin: plugin };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.ChartNoData = api; if (root.Chart && root.Chart.register) root.Chart.register(plugin); else if (root.document) root.document.addEventListener('DOMContentLoaded', function () { if (root.Chart && root.Chart.register) root.Chart.register(plugin); }); }
})(typeof self !== 'undefined' ? self : this);
