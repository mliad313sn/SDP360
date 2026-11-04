/* SDP360 — A-22 — TrendPanel: a volume panel (bars) stacked over a rate panel (lines), sharing the
 * x labels. Replaces the dual-axis combo charts (two y-scales on one plot) — one axis per panel.
 * UMD: browser global `TrendPanel`, Node require (buildConfigs is pure and tested).
 *   TrendPanel.buildConfigs(spec, colors) -> { volume: ChartConfig, rate: ChartConfig }
 *   TrendPanel.render(container, spec)   -> { volume: Chart, rate: Chart, destroy() }
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
        borderColor: (c && c.target) || '#3A4A60', borderWidth: 1.5, borderDash: [2, 4], pointRadius: 0, pointStyle: 'line', fill: false,
        spanGaps: true, datalabels: { display: false } });
    });
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
    function pane(name, height, title) {
      var w = document.createElement('div');
      w.className = 'edv-trend-panel__' + name;
      w.style.position = 'relative'; w.style.height = (height || 150) + 'px';
      var cv = document.createElement('canvas');
      cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', title);
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

  /* ── C-06 — ChartTable: the accessible alternative to a chart ─────────────────────────────
   * Built from the SAME labels/datasets handed to Chart.js, so the table can never disagree
   * with the picture. Reusable by any page (C-07 wires it into the theme plugin).
   *   ChartTable.rows(spec)    -> { head:[...], rows:[[label, cell…]] }   (null → '—')
   *   ChartTable.summary(spec) -> one-line text for a canvas aria-label
   *   ChartTable.html(spec)    -> inner HTML of a <details> (summary + table), every value escaped
   *   ChartTable.attach(target, spec, doc?) -> role="img" + aria-label on a canvas target, and a
   *                               collapsible <details id="<target.id>-table"> right after its wrap
   *   ChartTable.detach(target, doc?)        -> removes that table (error state)
   * spec = { title, labels:[], datasets:[{label, data:[], unit?}], unit?, state? }
   * state ∈ LOADING | VALID | ZERO | NO_DATA | STALE | ERROR (see analyticsLogic.STATES). */
  var ChartTable = (function () {
    function esc(x) {
      return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function num(v) {
      if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
      var n = Number(v); return isFinite(n) ? n : null;
    }
    function fmt(v) {
      var n = num(v);
      if (n === null) return '—';
      return n.toLocaleString('en', { maximumFractionDigits: 1 });
    }
    function unitOf(ds, spec) { return ds.unit != null ? ds.unit : (spec.unit || ''); }
    function withUnit(v, u) { var t = fmt(v); return t === '—' || !u ? t : (u === '%' ? t + '%' : t + ' ' + u); }

    function rows(spec) {
      var s = spec || {};
      var labels = s.labels || [], sets = s.datasets || [];
      var head = [s.labelHead || 'Label'].concat(sets.map(function (d) {
        var u = unitOf(d, s); return (d.label || 'Value') + (u ? ' (' + u + ')' : '');
      }));
      var body = labels.map(function (l, i) {
        return [l == null || l === '' ? '—' : String(l)].concat(sets.map(function (d) { return fmt((d.data || [])[i]); }));
      });
      return { head: head, rows: body };
    }

    function summary(spec) {
      var s = spec || {};
      var title = s.title || 'Chart';
      if (s.state === 'ERROR') return title + ' — data unavailable (load error).';
      if (s.state === 'LOADING') return title + ' — loading.';
      var labels = s.labels || [], sets = s.datasets || [];
      var parts = [];
      sets.forEach(function (d) {
        var hi = null, lo = null, missing = 0;
        (d.data || []).forEach(function (v, i) {
          var n = num(v);
          if (n === null) { missing++; return; }
          if (hi === null || n > hi.v) hi = { v: n, l: labels[i] };
          if (lo === null || n < lo.v) lo = { v: n, l: labels[i] };
        });
        if (!hi) return;
        var u = unitOf(d, s);
        var p = (d.label ? d.label + ': ' : '') + 'highest ' + hi.l + ' (' + withUnit(hi.v, u) + ')';
        if (lo && lo.l !== hi.l) p += ', lowest ' + lo.l + ' (' + withUnit(lo.v, u) + ')';
        if (missing) p += ', ' + missing + ' not measured';
        parts.push(p);
      });
      if (!parts.length || s.state === 'NO_DATA') return title + ' — no data for this period.';
      var lead = s.state === 'STALE' ? 'Source not current. ' : '';
      return lead + title + ' — ' + labels.length + ' rows. ' + parts.join('; ') + '.';
    }

    function html(spec) {
      var s = spec || {};
      var cap = esc(s.title || 'Chart') + ' — data table';
      var out = '<summary>Data table</summary>';
      if (s.state === 'NO_DATA' || !(s.labels || []).length) return out + '<p class="edv-chart-empty">No data for this period.</p>';
      if (s.state === 'STALE') out += '<p class="edv-chart-stale">Source not current — figures shown as last synced, colour withheld.</p>';
      var t = rows(s);
      out += '<table class="edv-chart-table__t"><caption>' + cap + '</caption><thead><tr>' +
        t.head.map(function (h, i) { return '<th scope="col"' + (i ? ' class="num"' : '') + '>' + esc(h) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + t.rows.map(function (r) {
          return '<tr>' + r.map(function (c, i) { return i ? '<td class="num">' + esc(c) + '</td>' : '<th scope="row">' + esc(c) + '</th>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
      return out;
    }

    function docOf(d) { return d || (typeof document !== 'undefined' ? document : null); }
    function anchorOf(target) {
      var a = target && target.closest ? target.closest('.chart-wrap') : null;
      return a || target;
    }
    function attach(target, spec, doc) {
      var d = docOf(doc);
      if (!target) return null;
      var isCanvas = String(target.tagName || '').toUpperCase() === 'CANVAS';
      if (isCanvas && target.setAttribute) {
        target.setAttribute('role', 'img');
        target.setAttribute('aria-label', summary(spec));
      }
      var anchor = anchorOf(target);
      if (!d || !anchor || !anchor.parentNode || !target.id) return null;
      var id = target.id + '-table';
      var det = d.getElementById(id);
      if (!det) {
        det = d.createElement('details');
        det.id = id;
        det.className = 'edv-chart-table';
        anchor.parentNode.insertBefore(det, anchor.nextSibling || null);
      }
      det.innerHTML = html(spec);
      if (isCanvas && target.setAttribute) target.setAttribute('aria-describedby', id);
      return det;
    }
    function detach(target, doc) {
      var d = docOf(doc);
      if (!d || !target || !target.id) return;
      var det = d.getElementById(target.id + '-table');
      if (det && det.parentNode) det.parentNode.removeChild(det);
      if (String(target.tagName || '').toUpperCase() === 'CANVAS' && target.setAttribute) {
        target.setAttribute('aria-label', 'Chart data unavailable.');
        if (target.removeAttribute) target.removeAttribute('aria-describedby');
      }
    }
    return { rows: rows, summary: summary, html: html, attach: attach, detach: detach, esc: esc };
  })();

  return { buildConfigs: buildConfigs, render: render, ChartTable: ChartTable };
});
