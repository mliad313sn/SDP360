/* SDP360 — A-22 — TrendPanel: a volume panel (bars) stacked over a rate panel (lines), sharing the
 * x labels. Replaces the dual-axis combo charts (two y-scales on one plot) — one axis per panel.
 * UMD: browser global `TrendPanel`, Node require (buildConfigs is pure and tested).
 *   TrendPanel.buildConfigs(spec, colors) -> { volume: ChartConfig, rate: ChartConfig }
 *   TrendPanel.render(container, spec)   -> { volume: Chart, rate: Chart, destroy() } + one data table (C-07)
 *   TrendPanel.tableSpec(spec, title?)   -> the ChartTable spec of that table (pure)
 * spec = { labels:[], unit:'%', rateMax:100, heights:{volume,rate},
 *          volume:[{label, data, extra?}], rate:[{label, data, target?, extra?}],
 *          volumeOptions?, rateOptions? }   (extra = per-dataset Chart.js keys, e.g. datalabels)
 * Data arrays are passed through untouched: null stays null and draws a GAP (spanGaps:false),
 * never a zero. A target line is drawn only when the caller gives a target. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./chartTheme.js'));
  else { var api = factory(root.ChartTheme); root.TrendPanel = api; root.ChartTable = api.ChartTable; }
})(typeof self !== 'undefined' ? self : this, function (ChartTheme) {
  'use strict';

  function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
  function merge(a, b) {
    var out = {}; var k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) out[k] = isObj(out[k]) && isObj(b[k]) ? merge(out[k], b[k]) : b[k];
    return out;
  }
  function assign(a, b) { return b ? merge(a, b) : a; }

  function buildConfigs(spec, colors) {
    var s = spec || {};
    var c = colors || (ChartTheme ? ChartTheme.read() : null);
    var series = (c && c.series) || ['#145FAE', '#C2410C', '#0891B2', '#7C3AED', '#A16207', '#BE185D'];
    var alpha = ChartTheme ? ChartTheme.alpha : function (h) { return h; };
    var labels = (s.labels || []).slice();
    var unit = s.unit == null ? '%' : s.unit;
    var vol = s.volume || [], rate = s.rate || [];
    var colourAt = function (i) { return series[i % series.length]; };
    var tick = { font: { size: 12 } };
    // the two panels share the x positions: both offset like a bar chart, both y-axes the same width
    var yWidth = function (scale) { scale.width = Math.max(scale.width, 48); };

    var volume = {
      type: 'bar',
      data: { labels: labels, datasets: vol.map(function (v, i) {
        var col = colourAt(i);
        return assign({ type: 'bar', label: v.label, data: v.data, backgroundColor: alpha(col, 0.85), borderColor: col,
          borderWidth: 0, borderRadius: 4, maxBarThickness: 28 }, v.extra);
      }) },
      options: assign({ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { font: { size: 12 }, boxWidth: 14 } } },
        scales: { x: { offset: true, ticks: { font: { size: 12 }, maxRotation: 0 }, grid: { display: false } },
          y: { beginAtZero: true, afterFit: yWidth, ticks: tick, title: { display: !!s.volumeTitle, text: s.volumeTitle || '', font: { size: 12 } } } } }, s.volumeOptions),
    };

    var targetCol = (c && c.target) || '#3A4A60';
    var rateSets = [];
    rate.forEach(function (r, j) {
      var col = colourAt(vol.length + j);
      rateSets.push(assign({ type: 'line', label: r.label, data: r.data, borderColor: col, backgroundColor: col,
        pointBackgroundColor: col, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0.3, fill: false,
        spanGaps: false, borderDash: j % 2 ? [6, 4] : [], pointStyle: ['circle', 'rectRot', 'triangle', 'rect'][j % 4] }, r.extra));
    });
    rate.forEach(function (r) {
      if (r.target == null || !isFinite(Number(r.target))) return;
      rateSets.push({ type: 'line', label: r.label + ' — target', data: labels.map(function () { return Number(r.target); }),
        borderColor: targetCol, borderWidth: 1.5, borderDash: [2, 4], pointRadius: 0, pointStyle: 'line', fill: false,
        spanGaps: true, datalabels: { display: false } });
    });
    // E-V08 — human-entered annotations (opt-in: spec.annotations = [{ index, label }]): one marker per note on the
    // rate panel at the first rate series' value of that period, plus ONE legend entry. A period with no value
    // gets no marker (the note stays in the list the page shows) — a marker is never placed on an invented 0.
    var notes = Array.isArray(s.annotations) ? s.annotations.filter(function (a) { return a && a.index >= 0 && a.index < labels.length; }) : [];
    if (notes.length && rate.length) {
      var first = rate[0].data || [];
      var mark = labels.map(function (_, i) { var hit = notes.some(function (a) { return a.index === i; }); return hit && first[i] != null ? first[i] : null; });
      if (mark.some(function (v) { return v != null; })) {
        rateSets.push({ type: 'line', label: s.annotationLabel || 'Annotation (human note)', data: mark, showLine: false, spanGaps: false,
          pointStyle: 'triangle', pointRadius: 7, pointHoverRadius: 9, borderColor: targetCol, backgroundColor: targetCol,
          fill: false, datalabels: { display: false }, edvAnnotations: notes });
      }
    }
    var suffix = unit ? (unit === '%' ? '%' : ' ' + unit) : '';
    var rateOpts = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { font: { size: 12 }, usePointStyle: true, boxWidth: 10 } },
        tooltip: { callbacks: { label: function (ctx) { return ' ' + ctx.dataset.label + ': ' + (ctx.raw == null ? '— not measured' : ctx.raw + suffix); } } } },
      scales: { x: { offset: true, ticks: { font: { size: 12 }, maxRotation: 0 }, grid: { display: false } },
        y: { beginAtZero: true, min: 0, afterFit: yWidth, ticks: { font: { size: 12 }, callback: function (v) { return v + suffix; } },
          title: { display: !!s.rateTitle, text: s.rateTitle || '', font: { size: 12 } } } } };
    if (s.rateMax != null) rateOpts.scales.y.max = s.rateMax;
    else if (unit === '%') rateOpts.scales.y.max = 100;
    var rateCfg = { type: 'line', data: { labels: labels, datasets: rateSets }, options: assign(rateOpts, s.rateOptions) };
    return { volume: volume, rate: rateCfg };
  }

  function render(container, spec) {
    var el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el || typeof Chart === 'undefined') return null;
    var s = spec || {};
    var h = s.heights || {};
    var cfg = buildConfigs(s, ChartTheme ? ChartTheme.colors : null);
    el.innerHTML = '';
    el.classList.add('edv-trend-panel');
    // C-07 (G26): one data table per panel, built from the same series — unless the page already
    // attached its own (analytics marks the container data-chart-table="page").
    var tableId = null;
    var T = ChartTheme && ChartTheme.ChartTable;
    var owned = el.getAttribute && el.getAttribute('data-chart-table') === 'page';
    if (owned) tableId = el.id ? el.id + '-table' : null;
    else if (T) {
      if (!el.id) el.id = 'edv-trend-' + (++trendSeq);
      T.attach(el, tableSpec(s), document, { mode: 'panel' });
      tableId = el.id + '-table';
    }
    function pane(name, height, title) {
      var w = document.createElement('div');
      w.className = 'edv-trend-panel__' + name;
      w.style.position = 'relative'; w.style.height = (height || 150) + 'px';
      var cv = document.createElement('canvas');
      cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', title);
      cv.setAttribute('data-chart-table', 'page');   // the panel's ONE table (below) describes both panes
      if (tableId) cv.setAttribute('aria-describedby', tableId);
      w.appendChild(cv); el.appendChild(w); return cv;
    }
    var vLabel = (s.volume || []).map(function (v) { return v.label; }).join(', ');
    var rLabel = (s.rate || []).map(function (r) { return r.label; }).join(', ');
    /* global Chart */
    var aria = s.aria || {};
    var volume = new Chart(pane('volume', h.volume, aria.volume || ('Counts per period: ' + vLabel)).getContext('2d'), cfg.volume);
    var rate = new Chart(pane('rate', h.rate, aria.rate || ('Rates per period (' + (s.unit == null ? '%' : s.unit) + '): ' + rLabel)).getContext('2d'), cfg.rate);
    return { volume: volume, rate: rate, destroy: function () { try { volume.destroy(); } catch (e) { /* already gone */ } try { rate.destroy(); } catch (e) { /* already gone */ } } };
  }

  var trendSeq = 0;
  /** C-07 — the table behind a TrendPanel: one row per period, volume then rate series (targets are a
   *  reference line, not data). Pure. */
  function tableSpec(spec, title) {
    var s = spec || {};
    var unit = s.unit == null ? '%' : s.unit;
    var sets = (s.volume || []).map(function (v) { return { label: v.label, data: v.data, unit: s.volumeUnit }; })
      .concat((s.rate || []).map(function (r) { return { label: r.label, data: r.data, unit: unit }; }));
    return { title: title || s.title || 'Trend', labelHead: s.labelHead || 'Period', labels: s.labels || [], datasets: sets };
  }

  /* C-06 ChartTable moved to lib/chartTheme.js in C-07 (the theme is loaded on every chart page, so its
   * Chart.js plugin can describe every canvas); re-exported here for existing callers. */
  var ChartTable = ChartTheme ? ChartTheme.ChartTable : null;

  return { buildConfigs: buildConfigs, render: render, tableSpec: tableSpec, ChartTable: ChartTable };
});
