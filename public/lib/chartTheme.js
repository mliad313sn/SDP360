/* SDP360 — A-22 — ONE Chart.js theme, read from the design tokens (public/_tokens.css).
 * UMD: browser global `ChartTheme`, Node require. Loaded right after Chart.js on every chart page;
 * it applies itself to window.Chart on load, so no page needs an inline call.
 *   read(getVar)          -> { rag:{green,amber,red,na}, series:[6], target, grid, text, font }
 *   colors                -> read() against the live page (getComputedStyle on <html>)
 *   alpha(hex, a)         -> 'rgba(r,g,b,a)' fill for a token colour
 *   apply(Chart, {getVar, locale, reducedMotion}) -> sets Chart.defaults (font ≥ 12 px, legend bottom, token ink,
 *                          locale), turns animation off under prefers-reduced-motion, and registers `a11yPlugin`
 *   ChartTable             -> the accessible alternative (summary + <details><table>) — moved here from charts.js
 *   a11yPlugin             -> C-07 Chart.js plugin: EVERY chart on a page that loads this theme gets role="img",
 *                             a one-line aria-label summary and a collapsible data table, with no page code.
 *                             Opt out per canvas with data-chart-table="off"; a page that attaches its own table
 *                             (ChartTable.attach) is marked "page" and left alone.
 * RAG names come from the tokens, never re-derived here: thresholds live in public/lib/kpiRag.js.
 * Series colours are categorical, in fixed order (validated: see docs/ai-decisions/ADR-A22-chart-theme.md);
 * they are NOT status colours. Fallbacks equal the token values (pinned by tests/chart-theme.test.js). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.ChartTheme = factory();
    root.ChartTable = root.ChartTheme.ChartTable;
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

  /* ── C-06 — ChartTable: the accessible alternative to a chart ─────────────────────────────
   * Built from the SAME labels/datasets handed to Chart.js, so the table can never disagree
   * with the picture. C-07: lives in the theme; the `edvA11y` plugin below calls it for every chart.
   *   ChartTable.rows(spec)    -> { head:[...], rows:[[label, cell…]] }   (null → '—')
   *   ChartTable.summary(spec) -> one-line text for a canvas aria-label
   *   ChartTable.html(spec)    -> inner HTML of a <details> (summary + table), every value escaped
   *   ChartTable.attach(target, spec, doc?, opts?) -> role="img" + aria-label on a canvas target, and a
   *                               collapsible <details id="<target.id>-table"> right after its wrap.
   *                               Marks the target data-chart-table=<opts.mode||"page">: "page" = a page owns
   *                               it (the plugin leaves it alone), "auto" = the plugin, "panel" = TrendPanel.
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
      if (typeof v === 'object') return 'y' in v ? num(v.y) : null;   // {x,y} points (scatter / time)
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
    function elementKids(el) {
      var k = el && el.children ? Array.prototype.slice.call(el.children) : [];
      return k.filter(function (c) { return !(c.className && /edv-chart-table/.test(String(c.className))); });
    }
    function anchorOf(target, auto) {
      var a = target && target.closest ? target.closest('.chart-wrap') : null;
      if (a) return a;
      if (!auto) return target;
      // Chart.js sizes a responsive canvas to its parent: never put the table INSIDE that sized box.
      // Climb while the parent holds nothing but this chart (at most 2 levels).
      var n = target;
      for (var i = 0; i < 2; i++) {
        var p = n && n.parentNode;
        if (!p || !p.parentNode || String(p.tagName || '').toUpperCase() === 'BODY') break;
        var kids = elementKids(p);
        if (kids.length !== 1 || kids[0] !== n) break;
        n = p;
      }
      return n;
    }
    function attach(target, spec, doc, opts) {
      var d = docOf(doc);
      if (!target) return null;
      var mode = (opts && opts.mode) || 'page';
      var auto = mode === 'auto';
      if (target.setAttribute) target.setAttribute('data-chart-table', mode);
      var isCanvas = String(target.tagName || '').toUpperCase() === 'CANVAS';
      if (isCanvas && target.setAttribute) {
        target.setAttribute('role', 'img');
        target.setAttribute('aria-label', summary(spec));
      }
      var anchor = anchorOf(target, auto);
      if (!d || !anchor || !anchor.parentNode || !target.id) return null;
      var id = target.id + '-table';
      var det = d.getElementById(id);
      if (!det) {
        det = d.createElement('details');
        det.id = id;
        det.className = 'edv-chart-table';
        anchor.parentNode.insertBefore(det, anchor.nextSibling || null);
      }
      var h = html(spec);
      if (det.innerHTML !== h) det.innerHTML = h;
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


  /* ── C-07 — reduced motion + the accessibility plugin ──────────────────────────────────── */
  function prefersReducedMotion(win) {
    var w = win || (typeof window !== 'undefined' ? window : null);
    try { return !!(w && typeof w.matchMedia === 'function' && w.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  var TABLE_CSS =
    '.edv-chart-table{margin-top:8px;font-size:12px}' +
    '.edv-chart-table summary{cursor:pointer;font-weight:600}' +
    '.edv-chart-table table{width:100%;border-collapse:collapse;margin-top:6px}' +
    '.edv-chart-table caption{text-align:left;padding-bottom:4px}' +
    '.edv-chart-table th,.edv-chart-table td{padding:4px 6px;border-bottom:1px solid #E2E5EA;text-align:left}' +
    '.edv-chart-table .num{text-align:right;font-variant-numeric:tabular-nums}';
  function ensureStyle(doc) {
    if (!doc || !doc.createElement || !doc.head) return;
    if (doc.getElementById && doc.getElementById('edv-chart-a11y-css')) return;
    var st = doc.createElement('style'); st.id = 'edv-chart-a11y-css'; st.textContent = TABLE_CSS;
    doc.head.appendChild(st);
  }

  var autoId = 0;
  function textOf(t) { return Array.isArray(t) ? t.join(' ') : (t == null ? '' : String(t)); }
  function titleFor(chart, cv) {
    var keep = cv.getAttribute && cv.getAttribute('data-chart-title');
    if (keep) return keep;
    var t = chart.options && chart.options.plugins && chart.options.plugins.title;
    var title = t && t.text ? textOf(t.text).trim() : '';
    if (!title) {   // an author-written label, but never the summary this plugin wrote itself
      var own = cv.getAttribute && cv.getAttribute('data-chart-table') === 'auto';
      var lbl = cv.getAttribute && cv.getAttribute('aria-label');
      if (lbl && !own) title = String(lbl).trim();
    }
    if (!title && cv.closest) {
      var box = cv.closest('.card,.panel,section,[class*="card"],[class*="panel"]');
      var h = box && box.querySelector ? box.querySelector('h1,h2,h3,h4,.card-title,.panel-title') : null;
      if (h && h.textContent) title = String(h.textContent).replace(/\s+/g, ' ').trim();
    }
    title = title || 'Chart';
    if (cv.setAttribute) cv.setAttribute('data-chart-title', title);
    return title;
  }
  function specFromChart(chart, title) {
    var data = chart.data || {};
    var sets = (data.datasets || []).map(function (d) { return { label: d.label, data: (d.data || []).slice() }; });
    var labels = (data.labels || []).slice();
    if (!labels.length && sets.length) {
      labels = (sets[0].data || []).map(function (v) { return v && typeof v === 'object' && 'x' in v ? v.x : ''; });
    }
    return { title: title, labels: labels, datasets: sets };
  }
  /** Describe one Chart.js chart. Never throws: a broken description must not break the chart. */
  function describe(chart) {
    try {
      var cv = chart && chart.canvas;
      if (!cv || !cv.getAttribute) return;
      var mode = cv.getAttribute('data-chart-table');
      if (mode === 'off' || mode === 'page') return;
      var doc = cv.ownerDocument || (typeof document !== 'undefined' ? document : null);
      if (!cv.id) cv.id = 'edv-chart-' + (++autoId);
      var title = titleFor(chart, cv);
      ensureStyle(doc);
      ChartTable.attach(cv, specFromChart(chart, title), doc, { mode: 'auto' });
    } catch (e) { /* accessibility layer is best-effort */ }
  }
  var a11yPlugin = { id: 'edvA11y', afterUpdate: describe };

  function apply(Chart, opts) {
    if (!Chart || !Chart.defaults) return false;
    var o = opts || {};
    var calm = o.reducedMotion != null ? !!o.reducedMotion : prefersReducedMotion();
    if (calm) Chart.defaults.animation = false;
    if (!Chart.__edvA11y) {
      try {
        if (typeof Chart.register === 'function') Chart.register(a11yPlugin);
        else if (Chart.plugins && typeof Chart.plugins.register === 'function') Chart.plugins.register(a11yPlugin);
        Chart.__edvA11y = true;
      } catch (e) { /* older Chart without plugins: charts stay as they were */ }
    }
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

  var api = { read: read, alpha: alpha, apply: apply, MIN_FONT: MIN_FONT, FALLBACK: FALLBACK,
    ChartTable: ChartTable, a11yPlugin: a11yPlugin, prefersReducedMotion: prefersReducedMotion };
  Object.defineProperty(api, 'colors', { enumerable: true, get: function () { return read(); } });
  return api;
});
