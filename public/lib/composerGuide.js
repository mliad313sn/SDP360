/* SDP360 — Dashboard composer, guided flow (C-08 · F17/G17).
 *
 * Pure helpers shared by public/dashboard-composer.html and its tests (UMD: window.ComposerGuide
 * in the browser, module.exports in Node). Nothing here talks to the server or the DOM directly;
 * the server's validateDashboard (services/dashboardWidgets.js) stays the authority — these
 * helpers only steer the publisher towards a definition it will accept.
 *
 *   INTENTS / PRESETS                         the questions a widget can answer
 *   suggestTypes(intent, metric, types)       every creatable type, suggested ones first, unfit ones with a reason
 *   fitError(type, metric, intent, types, w)  null, or why this type cannot answer with this metric (E-V02: the
 *                                             measure → chart rules come from lib/chartContract.js, shared with the API)
 *   fieldsFor(type, types, ctx)               form-field descriptors generated from WIDGET_TYPES[type].props
 *   renderFieldsHtml(fields, values, esc)     the fields as HTML (labelled controls + an error slot each)
 *   readFieldValues(fields, getEl)            the fields back into widget props (blank = absent)
 *   dims / sizeOf / flowLayout                S-M-L placement instead of raw x/y/w/h
 *   plainErrors(errors, widgets)              server validation errors in plain words, mapped to a field
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./chartContract'));
  else root.ComposerGuide = factory(root.ChartContract);
})(typeof self !== 'undefined' ? self : this, function (ChartContract) {
  'use strict';

  /** Window kinds that have a history, so a trend can draw them (a 'current' metric is a snapshot). */
  var TIME_SERIES_KINDS = ['week', 'month', 'ytd', 'rolling3m', 'rolling13w'];
  var MAX_EXTRA_SERIES = 4;

  var INTENTS = {
    status:  { label: 'Where do we stand now? (status)',              types: ['kpi', 'ragGrid', 'trackerRag'] },
    trend:   { label: 'How is it evolving? (trend)',                  types: ['trend'] },
    compare: { label: 'Which site is ahead or behind? (compare sites)', types: ['ragGrid', 'bar', 'table', 'trackerRag'] },
    target:  { label: 'Are we on target? (target)',                   types: ['kpi', 'ragGrid'] },
    detail:  { label: 'Which items need action? (detail)',            types: ['table', 'actions', 'text'] },
  };
  var INTENT_ORDER = ['status', 'trend', 'compare', 'target', 'detail'];

  /** Questions a publisher starts from. A preset whose metric is not in the catalogue is not offered. */
  var PRESETS = [
    { key: 'sla-status',  question: 'Is my site resolving tickets within SLA?', metric: 'helpdesk.resolution_sla_pct', intent: 'target', type: 'kpi', title: 'Resolution SLA', size: 'S', props: { compare: 'fleet' } },
    { key: 'volume',      question: 'How is ticket volume evolving?', metric: 'helpdesk.inbound', intent: 'trend', type: 'trend', title: 'Inbound vs closed tickets', size: 'M', props: { window: '6m', series: ['helpdesk.closed'] } },
    { key: 'sla-sites',   question: 'Which site is behind on resolution SLA?', metric: 'helpdesk.resolution_sla_pct', intent: 'compare', type: 'ragGrid', title: 'Resolution SLA by site', size: 'M', props: {} },
    { key: 'wan',         question: 'How available is the WAN?', metric: 'wan.wan1_availability_pct', intent: 'trend', type: 'trend', title: 'WAN availability', size: 'M', props: { window: '13w', series: ['wan.wan2_availability_pct'] } },
    { key: 'assets',      question: 'How complete is the asset register?', metric: 'assets.completeness_pct', intent: 'target', type: 'kpi', title: 'Asset register completeness', size: 'S', props: {} },
    { key: 'overdue',     question: 'Which actions are overdue?', metric: '', intent: 'detail', type: 'actions', title: 'Overdue actions', size: 'L', props: { onlyOverdue: true } },
    { key: 'tracker',     question: 'Where does the Activity Tracker stand per site?', metric: '', intent: 'compare', type: 'trackerRag', title: 'Activity Tracker by site', size: 'M', props: { tracker: 'it-activity' } },
  ];

  function creatable(types) { return Object.keys(types || {}).filter(function (t) { return types[t].creatable !== false; }); }
  function metricLabel(m) { return m ? (m.name || m.key) : ''; }

  function fitError(type, metric, intent, types, w) {
    var T = types && types[type];
    if (!T) return 'Unknown widget type “' + type + '”.';
    if (T.creatable === false) return T.retiredNote || (type + ' is no longer offered.');
    if (T.needsMetric && !metric) return 'A ' + type + ' widget charts a metric — pick one in step 2.';
    if (!T.needsMetric && metric) return 'A ' + type + ' widget does not chart a metric — clear the metric (step 2) or choose another type.';
    if (type === 'trend' && metric && TIME_SERIES_KINDS.indexOf(metric.window_kind) < 0) {
      return 'A trend needs a time series, but “' + metricLabel(metric) + '” is a current snapshot with no history — use a KPI tile or a site comparison.';
    }
    var contract = ChartContract && T.needsMetric ? ChartContract.contractError(type, metric, w) : null;
    if (contract) return contract;
    if (intent && INTENTS[intent] && INTENTS[intent].types.indexOf(type) < 0) {
      var alt = INTENTS[intent].types.filter(function (t) { return types[t] && types[t].creatable !== false && !!types[t].needsMetric === !!metric; });
      return 'A ' + type + ' does not answer “' + INTENTS[intent].label + '”' + (alt.length ? ' — try ' + alt.join(' or ') + '.' : '.');
    }
    return null;
  }

  /** Every creatable type with {type, ok, reason, suggested}; fitting suggested types first. */
  function suggestTypes(intent, metric, types) {
    var wanted = intent && INTENTS[intent] ? INTENTS[intent].types : [];
    var all = creatable(types).map(function (t) {
      var reason = fitError(t, metric, intent, types);
      return { type: t, ok: !reason, reason: reason, suggested: !reason && wanted.indexOf(t) >= 0 };
    });
    var rank = function (x) { return x.suggested ? wanted.indexOf(x.type) : (x.ok ? 100 : 200); };   // the question's own order first
    return all.map(function (x, i) { return [x, i]; }).sort(function (a, b) { return rank(a[0]) - rank(b[0]) || a[1] - b[1]; }).map(function (p) { return p[0]; });
  }

  /** Trend window choices that match the metric's own window kind (same rule as DashboardRender.trendLength). */
  function windowOptions(metric) {
    var monthly = metric && ['month', 'ytd', 'rolling3m'].indexOf(metric.window_kind) >= 0;
    var opts = monthly ? [['6m', 'last 6 months'], ['12m', 'last 12 months'], ['24m', 'last 24 months']]
                       : [['13w', 'last 13 weeks'], ['26w', 'last 26 weeks'], ['52w', 'last 52 weeks']];
    return [['', 'default (' + (monthly ? '6 months' : '13 weeks') + ')']].concat(opts);
  }

  /**
   * Field descriptors for a type, one per WIDGET_TYPES[type].props entry (an unknown prop still gets
   * a plain text field — the form never hides something the type declares).
   * ctx = { metric, metrics: [registry rows], policies: {key:..}, trackers: [keys] }
   */
  function fieldsFor(type, types, ctx) {
    var T = types && types[type]; if (!T) return [];
    ctx = ctx || {};
    var metric = ctx.metric || null;
    var policies = Object.keys(ctx.policies || {});
    return (T.props || []).map(function (p) {
      switch (p) {
        case 'rag': return { name: p, kind: 'select', label: 'RAG policy (colour thresholds)', options: [['', metric && metric.rag_policy ? 'metric default (' + metric.rag_policy + ')' : 'none']].concat(policies.map(function (k) { return [k, k]; })) };
        case 'compare': return { name: p, kind: 'select', label: 'Comparison', options: [['', 'none'], ['fleet', 'compare with the fleet']] };
        case 'format': return { name: p, kind: 'text', label: 'Number format hint (optional)', hint: 'Leave blank to use the metric unit.' };
        case 'window': return { name: p, kind: 'select', label: 'Time window', options: windowOptions(metric) };
        case 'series': {
          var same = (ctx.metrics || []).filter(function (m) {
            return metric && m.key !== metric.key && String(m.unit || '') === String(metric.unit || '') && TIME_SERIES_KINDS.indexOf(m.window_kind) >= 0;
          });
          return { name: p, kind: 'multi', label: 'Extra lines (same unit' + (metric ? ': ' + (metric.unit || '—') : '') + ', up to ' + MAX_EXTRA_SERIES + ')', max: MAX_EXTRA_SERIES,
            options: same.map(function (m) { return [m.key, m.name + ' (' + m.key + ')']; }), hint: metric ? '' : 'Pick the metric first.' };
        }
        case 'groupBy': return { name: p, kind: 'select', label: 'Group by', options: [['', 'site (default)'], ['site', 'site']] };
        case 'stacked': return { name: p, kind: 'checkbox', label: 'Stacked bars' };
        case 'columns': return { name: p, kind: 'list', label: 'Columns (comma-separated, optional)' };
        case 'pageSize': return { name: p, kind: 'number', label: 'Rows per page', min: 1, max: 100, hint: 'Field devices: 10 or fewer.' };
        case 'tracker': return { name: p, kind: 'select', label: 'Tracker', options: (ctx.trackers && ctx.trackers.length ? ctx.trackers : ['it-activity']).map(function (k) { return [k, k]; }) };
        case 'markdown': return { name: p, kind: 'textarea', label: 'Text (simple formatting: **bold**, - lists)' };
        case 'sources': return { name: p, kind: 'multi', label: 'Action sources (none = all)', options: [['meetings', 'Meetings'], ['inspection', 'Inspections'], ['report', 'Weekly report']] };
        case 'onlyOverdue': return { name: p, kind: 'checkbox', label: 'Only overdue actions' };
        default: return { name: p, kind: 'text', label: p };
      }
    });
  }

  var identity = function (s) { return String(s == null ? '' : s); };

  function renderFieldsHtml(fields, values, esc) {
    esc = esc || identity; values = values || {};
    return fields.map(function (f) {
      var id = 'wf-' + f.name, v = values[f.name], html;
      var lab = '<label for="' + id + '">' + esc(f.label) + '</label>';
      if (f.kind === 'select' || f.kind === 'multi') {
        var sel = f.kind === 'multi' ? (Array.isArray(v) ? v : []) : [v == null ? '' : String(v)];
        html = lab + '<select id="' + id + '"' + (f.kind === 'multi' ? ' multiple size="' + Math.min(5, Math.max(2, f.options.length)) + '"' : '') + '>' +
          f.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (sel.indexOf(o[0]) >= 0 ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
      } else if (f.kind === 'checkbox') {
        html = '<label class="check" for="' + id + '"><input type="checkbox" id="' + id + '"' + (v ? ' checked' : '') + '> ' + esc(f.label) + '</label>';
      } else if (f.kind === 'number') {
        html = lab + '<input type="number" id="' + id + '" min="' + f.min + '" max="' + f.max + '" value="' + esc(v == null ? '' : v) + '">';
      } else if (f.kind === 'textarea') {
        html = lab + '<textarea id="' + id + '">' + esc(v == null ? '' : v) + '</textarea>';
      } else {
        html = lab + '<input id="' + id + '" value="' + esc(Array.isArray(v) ? v.join(', ') : (v == null ? '' : v)) + '">';
      }
      return '<div class="field">' + html + (f.hint ? '<div class="hint">' + esc(f.hint) + '</div>' : '') + '<div class="ferr" id="ferr-' + f.name + '"></div></div>';
    }).join('');
  }

  /** Field values → widget props. A blank field means "absent", never an empty string / 0. */
  function readFieldValues(fields, getEl) {
    var out = {};
    fields.forEach(function (f) {
      var el = getEl('wf-' + f.name); if (!el) return;
      var v;
      if (f.kind === 'multi') { v = Array.prototype.slice.call(el.selectedOptions || []).map(function (o) { return o.value; }).filter(Boolean); if (!v.length) v = undefined; }
      else if (f.kind === 'checkbox') v = el.checked ? true : undefined;
      else if (f.kind === 'number') v = String(el.value == null ? '' : el.value).trim() === '' ? undefined : Number(el.value);
      else if (f.kind === 'list') { v = String(el.value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); if (!v.length) v = undefined; }
      else { v = String(el.value == null ? '' : el.value).trim(); if (v === '') v = undefined; }
      if (v !== undefined) out[f.name] = v;
    });
    return out;
  }

  /** Every prop name any type declares — the keys the generated form owns. */
  function allProps(types) {
    var s = {}; Object.keys(types || {}).forEach(function (t) { (types[t].props || []).forEach(function (p) { s[p] = true; }); });
    return Object.keys(s);
  }

  // ---------- placement: sizes instead of coordinates ----------
  var SIZES = { S: { w: 3, h: 2, label: 'Small (quarter width)' }, M: { w: 6, h: 3, label: 'Medium (half width)' }, L: { w: 12, h: 4, label: 'Large (full width)' } };
  function dims(type, size, cols, types) {
    cols = cols || 12; var T = (types && types[type]) || { minW: 1, minH: 1 }; var b = SIZES[size] || SIZES.M;
    var w = size === 'L' ? cols : Math.max(b.w, T.minW || 1);
    return { w: Math.min(w, cols), h: Math.max(b.h, T.minH || 1) };
  }
  function sizeOf(layout, cols) {
    cols = cols || 12; var w = (layout && layout.w) || 0;
    return w >= cols ? 'L' : (w >= 6 ? 'M' : 'S');
  }
  /** Pack the widgets in order, left to right, into rows: never overlaps, never overflows. */
  function flowLayout(items, cols, types) {
    cols = cols || 12; var x = 0, y = 0, rowH = 0;
    return items.map(function (it) {
      var d = dims(it.type, it.size, cols, types);
      if (x + d.w > cols) { y += rowH; x = 0; rowH = 0; }
      var L = { x: x, y: y, w: d.w, h: d.h };
      x += d.w; rowH = Math.max(rowH, d.h);
      return L;
    });
  }
  /** Visual order (top-to-bottom, left-to-right) — how a stored definition is read into the list. */
  function byPosition(widgets) {
    return widgets.slice().sort(function (a, b) { var A = a.layout || {}, B = b.layout || {}; return (A.y || 0) - (B.y || 0) || (A.x || 0) - (B.x || 0); });
  }

  // ---------- server errors in plain words ----------
  var FIELD_LABELS = { id: 'Id', type: 'Type', title: 'Title', metric: 'Metric', size: 'Size', series: 'Extra lines', rag: 'RAG policy', tracker: 'Tracker', window: 'Time window', advanced: 'Advanced options', pageSize: 'Rows per page', sources: 'Action sources', markdown: 'Text', compare: 'Comparison' };
  var DOC_FIELDS = { key: 'd-key', title: 'd-title', audience: 'd-aud', widgets: 'wlist', 'grid.columns': 'd-key', filters: 'd-key' };
  function humanize(msg) {
    var s = String(msg || ''); var m;
    if (/^layout needs integer/.test(s)) return 'the placement is incomplete — choose a size.';
    if ((m = /needs at least (\d+)×(\d+) cells/.exec(s))) return 'too small for this widget type (needs at least ' + m[1] + ' columns × ' + m[2] + ' rows) — choose a larger size.';
    if ((m = /overflows the (\d+)-column grid/.exec(s))) return 'wider than the page (' + m[1] + ' columns) — choose a smaller size.';
    if ((m = /overlaps widget (\S+)/.exec(s))) return 'overlaps widget ' + m[1] + ' — use Move up / Move down or change the size.';
    if (/raw sql\/query/.test(s)) return 'a raw SQL query is not allowed — register a metric instead.';
    return s;
  }
  function plainErrors(errors, widgets) {
    widgets = widgets || [];
    return (errors || []).map(function (e) {
      var path = String((e && e.path) || ''), msg = (e && (e.msg || e.message)) || String(e || '');
      var m = /^widgets\[(\d+)\](?:\.(\w+))?/.exec(path);
      if (m) {
        var w = widgets[+m[1]] || {}, seg = m[2] || 'advanced';
        var field = seg === 'layout' ? 'size' : seg;
        var label = FIELD_LABELS[field] || field;
        var who = 'Widget “' + (w.title || w.id || ('#' + (+m[1] + 1))) + '”';
        var text = humanize(msg);
        return { widgetId: w.id || null, index: +m[1], field: field, label: label, text: text, line: who + ' — ' + label + ': ' + text };
      }
      var fid = DOC_FIELDS[path] || null;
      return { widgetId: null, index: null, field: fid, label: path || 'Dashboard', text: humanize(msg), line: (path ? path.charAt(0).toUpperCase() + path.slice(1) + ': ' : '') + humanize(msg) };
    });
  }

  /** The first intent a stored widget's type answers (used when a saved widget is re-opened). */
  function intentFor(type) {
    for (var i = 0; i < INTENT_ORDER.length; i++) if (INTENTS[INTENT_ORDER[i]].types.indexOf(type) >= 0) return INTENT_ORDER[i];
    return '';
  }

  function nextId(widgets) {
    var used = {}; (widgets || []).forEach(function (w) { used[w.id] = true; });
    for (var i = 1; i < 1000; i++) if (!used['w' + i]) return 'w' + i;
    return 'w' + Date.now();
  }

  return { INTENTS: INTENTS, INTENT_ORDER: INTENT_ORDER, PRESETS: PRESETS, TIME_SERIES_KINDS: TIME_SERIES_KINDS, SIZES: SIZES, MAX_EXTRA_SERIES: MAX_EXTRA_SERIES,
    creatable: creatable, fitError: fitError, suggestTypes: suggestTypes, windowOptions: windowOptions, fieldsFor: fieldsFor,
    renderFieldsHtml: renderFieldsHtml, readFieldValues: readFieldValues, allProps: allProps,
    dims: dims, sizeOf: sizeOf, flowLayout: flowLayout, byPosition: byPosition, humanize: humanize, plainErrors: plainErrors, nextId: nextId, intentFor: intentFor };
});
