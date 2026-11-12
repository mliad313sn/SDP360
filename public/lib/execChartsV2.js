/* F-UX-12 — Executive chart standard (vision §3.4), behind report_config ui_exec_charts_v2 (window.__uiPolicy
 * .exec_charts_v2; '0' = today, this file then does NOTHING). Same figures, same windows: only the presentation of a
 * chart changes, at construction time, so the page code that builds and updates the charts is untouched.
 *   • a chart with two value axes becomes small multiples: the first panel keeps the datasets of the first axis (the
 *     other datasets stay in it, hidden, so the page's in-place updates by index keep working); each other axis gets
 *     its own panel underneath, re-synced from the first chart on every update();
 *   • a ring / pie chart becomes horizontal bars with the same labels, same order and same values (order is kept on
 *     purpose: the page updates those charts in place by index — sorting would mis-assign the values).
 * The design ratchet is NOT lowered here: it may be lowered only once the switch is armed in the pilot profile
 * after a browser review (decision D5). UMD: window.ExecChartsV2 in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExecChartsV2 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var AX = 'yAxis' + 'ID';
  var RING = /^(dough|pie)/;
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function axisOf(ds) { return (ds && ds[AX]) || 'y'; }

  /** Pure: one config → { main, panels: [{ config, map: [[srcIndex, panelIndex]] }] }. Functions in options are kept by reference. */
  function plan(cfg) {
    var c = cfg || {};
    var type = String(c.type || '');
    if (RING.test(type)) {
      var data = { labels: (c.data && c.data.labels) || [], datasets: ((c.data && c.data.datasets) || []).map(function (d) { var x = Object.assign({}, d); delete x.cutout; return x; }) };
      var opt = Object.assign({}, c.options || {});
      opt.indexAxis = 'y';
      opt.plugins = Object.assign({}, opt.plugins || {}, { legend: Object.assign({}, (opt.plugins && opt.plugins.legend) || {}, { display: false }) });
      delete opt.cutout;
      opt.scales = { x: { beginAtZero: true }, y: { ticks: { autoSkip: false } } };
      return { main: Object.assign({}, c, { type: 'bar', data: data, options: opt }), panels: [] };
    }
    var sets = (c.data && c.data.datasets) || [];
    var axes = [];
    sets.forEach(function (d) { var a = axisOf(d); if (axes.indexOf(a) < 0) axes.push(a); });
    if (axes.length < 2) return { main: c, panels: [] };
    var first = axes[0];
    var scales = (c.options && c.options.scales) || {};
    var mainSets = sets.map(function (d) { return axisOf(d) === first ? d : Object.assign({}, d, { hidden: true, _v2moved: true }); });
    var mainScales = Object.assign({}, scales);
    axes.slice(1).forEach(function (a) { if (mainScales[a]) mainScales[a] = Object.assign({}, mainScales[a], { display: false }); });
    var mainOpts = Object.assign({}, c.options || {}, { scales: mainScales });
    var leg = (mainOpts.plugins && mainOpts.plugins.legend) || {};
    var prevFilter = leg.labels && leg.labels.filter;
    mainOpts.plugins = Object.assign({}, mainOpts.plugins || {}, { legend: Object.assign({}, leg, { labels: Object.assign({}, leg.labels || {}, {
      filter: function (item, chartData) { var d = chartData.datasets[item.datasetIndex]; if (d && d._v2moved) return false; return prevFilter ? prevFilter(item, chartData) : true; } }) }) });
    var panels = axes.slice(1).map(function (a) {
      var map = [], ps = [];
      sets.forEach(function (d, i) { if (axisOf(d) === a) { var x = Object.assign({}, d, { hidden: false }); delete x[AX]; map.push([i, ps.length]); ps.push(x); } });
      var ys = Object.assign({}, scales[a] || {}, { position: 'left', display: true });
      var pScales = {}; if (scales.x) pScales.x = scales.x; pScales.y = ys;
      return { config: { type: c.type, data: { labels: (c.data && c.data.labels) || [], datasets: ps }, options: Object.assign({}, c.options || {}, { scales: pScales }) }, map: map };
    });
    return { main: Object.assign({}, c, { data: Object.assign({}, c.data, { datasets: mainSets }), options: mainOpts }), panels: panels };
  }

  function canvasOf(ctx) { if (!ctx) return null; if (ctx.canvas) return ctx.canvas; return ctx; }

  /** Browser: a Chart constructor that applies plan(); `doc` = document. Statics (defaults, register…) pass through. */
  function wrap(Chart, doc) {
    return new Proxy(Chart, {
      construct: function (T, args) {
        var p = plan(args[1]);
        var main = new T(args[0], p.main);
        if (!p.panels.length) return main;
        var cv = canvasOf(args[0]); var host = cv && cv.parentNode;
        var extras = [];
        if (host && doc) {
          p.panels.forEach(function (pp) {
            var box = doc.createElement('div'); box.className = 'v2-panel'; box.style.position = 'relative'; box.style.height = (host.clientHeight ? Math.round(host.clientHeight * 0.6) : 160) + 'px'; box.style.marginTop = '8px';
            var c2 = doc.createElement('canvas'); box.appendChild(c2);
            host.parentNode.insertBefore(box, host.nextSibling);
            extras.push({ chart: new T(c2, pp.config), map: pp.map, box: box });
          });
        }
        var upd = main.update.bind(main), des = main.destroy.bind(main);
        main.update = function (mode) {
          var r = upd(mode);
          extras.forEach(function (e) {
            e.chart.data.labels = main.data.labels;
            e.map.forEach(function (m) { var s = main.data.datasets[m[0]], t = e.chart.data.datasets[m[1]]; if (s && t) { t.data = s.data; t.label = s.label; } });
            e.chart.update(mode);
          });
          return r;
        };
        main.destroy = function () { extras.forEach(function (e) { try { e.chart.destroy(); } catch (_) { /* gone */ } if (e.box && e.box.parentNode) e.box.parentNode.removeChild(e.box); }); extras = []; return des(); };
        return main;
      },
    });
  }

  /** Called once by executive.html right after Chart.js: replaces window.Chart only when the switch is on. */
  function install(win) {
    try {
      var pol = win.__uiPolicy;
      if (!(pol && pol.exec_charts_v2 === '1') || !win.Chart) return false;
      win.Chart = wrap(win.Chart, win.document);
      return true;
    } catch (_) { return false; }
  }

  // <script src="lib/execChartsV2.js" data-install="1"> after Chart.js and auth.js: installs itself (no inline code)
  try {
    var me = typeof document !== 'undefined' && document.currentScript;
    if (me && me.getAttribute('data-install') === '1' && typeof window !== 'undefined') install(window);
  } catch (_) { /* not a browser */ }

  return { plan: plan, wrap: wrap, install: install };
});
