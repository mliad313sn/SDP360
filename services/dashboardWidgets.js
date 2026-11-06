'use strict';
// SDP360 — Dynamic Dashboard: widget & layout definition schema (Phase 2).
//
// A dashboard is a JSON document a site manager assembles from a catalogue of widget types,
// each bound to a *registered metric* (never to a raw SQL string — that is how the dashboard
// stays safe for self-service and how the committee keeps one definition per KPI).
// This module validates such documents; rendering lives in the browser, data in /api/metrics.
//
// {
//   key: 'sgo-weekly', title: 'Sabodala weekly', audience: 'site' | 'executive' | 'field',
//   grid: { columns: 12 },
//   filters: [{ key: 'site', type: 'site', default: 'SGO' }, { key: 'window', type: 'window', default: '13w' }],
//   widgets: [{ id: 'w1', type: 'kpi', metric: 'helpdesk.resolution_sla_pct', title: 'Resolution SLA',
//               rag: 'sla-percent', layout: { x: 0, y: 0, w: 3, h: 2 } }, ...]
// }

const KpiRag = require('./kpiRag');
// E-V02 — the measure → chart rule table shared with the composer (one source, browser + API)
const ChartContract = require('../public/lib/chartContract');
const R = require('../public/lib/dashboardRender');

// C-04 (F01/F02/G11-min) — every type declares HOW it renders (`render`), so a type that is
// offered is a type that draws something distinct; `creatable:false` = kept only so stored
// definitions still render (no NEW widget of that type is accepted).
//   render: tile | line | bar-list | sortable-table | rag-grid | tracker-rag | markdown | action-table
const WIDGET_TYPES = {
  kpi:        { needsMetric: true,  minW: 2, minH: 2, props: ['rag', 'format', 'compare', 'action_href'], render: 'tile' },
  trend:      { needsMetric: true,  minW: 4, minH: 3, props: ['series', 'window'], render: 'line' },
  // E-V02 (X-V-01) — `stacked` is no longer offered: no renderer draws it. A stored widget that carries it keeps rendering.
  bar:        { needsMetric: true,  minW: 4, minH: 3, props: ['groupBy'], render: 'bar-list' },
  table:      { needsMetric: true,  minW: 4, minH: 3, props: ['columns', 'pageSize'], render: 'sortable-table' },
  heatmap:    { needsMetric: true,  minW: 6, minH: 3, props: ['rows', 'cols', 'rag'], render: 'sortable-table', creatable: false,
                retiredNote: 'heatmap is no longer offered — existing widgets render as a table; use ragGrid or table' },
  ragGrid:    { needsMetric: true,  minW: 4, minH: 3, props: ['rag'], render: 'rag-grid' },
  trackerRag: { needsMetric: false, minW: 4, minH: 3, props: ['tracker'], render: 'tracker-rag' },
  text:       { needsMetric: false, minW: 2, minH: 1, props: ['markdown'], render: 'markdown' },
  actions:    { needsMetric: false, minW: 4, minH: 3, props: ['sources', 'onlyOverdue'], render: 'action-table' },
  // E-V09 — small multiples: 2-6 registered metrics, one panel each (own unit, own axis), one shared window and
  // data table. Creatable only while report_config ui_small_multiples='1' (default '0'); never a dual axis.
  multiples:  { needsMetric: false, minW: 6, minH: 3, props: ['metrics', 'window'], render: 'small-multiples', switch: 'ui_small_multiples', creatable: false,
                switchNote: 'small multiples are not offered yet (report_config ui_small_multiples=0)', retiredNote: 'small multiples are not offered yet (report_config ui_small_multiples=0)' },
};
const MIN_MULTIPLES = 2, MAX_MULTIPLES = 6;
const MONTHLY_KINDS = ['month', 'ytd', 'rolling3m'];
/** Tracker keys the trackerRag resolver understands: the Activity Tracker, optionally pinned to a year. */
const TRACKER_KEY_RE = /^it-activity(-20[0-9][0-9])?$/;
const MAX_EXTRA_SERIES = 4;

const AUDIENCES = ['site', 'executive', 'field', 'committee'];
const FILTER_TYPES = ['site', 'window', 'month', 'week', 'group', 'department', 'text'];
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/i;

/**
 * @param {object} doc              dashboard definition
 * @param {object} [opts]
 * @param {Set<string>|string[]} [opts.metrics]   registered metric keys; when given, unknown metrics are errors
 * @param {Set<string>|string[]} [opts.trackers]  known tracker keys for trackerRag widgets (default: TRACKER_KEY_RE)
 * @param {object} [opts.metricUnits]   { metricKey: unit } — a trend's series[] must share one unit
 * @param {object} [opts.metricKinds]   { metricKey: window_kind } — a trend needs a metric with a history (not 'current')
 * @param {Set<string>|string[]} [opts.legacyIds]  widget ids that ALREADY carried a retired type (kept rendering)
 * @param {boolean} [opts.allowRetired]  stored definitions (submit/publish) keep their retired widgets
 * @param {object} [opts.metricInfo]  E-V02 — { metricKey: {name, unit, window_kind, rag_policy} }: enables the
 *                                     measure → chart contract (public/lib/chartContract.js) for NEW widgets
 * @param {boolean} [opts.smallMultiples]  E-V09 — ui_small_multiples='1': the `multiples` type may be created
 * @param {object[]} [opts.storedWidgets]  widgets of the stored definition: a widget kept identical (same id, type,
 *                                     metric, stacked, rag) is exempt from the contract, so a stored one keeps saving
 */
function validateDashboard(doc, opts = {}) {
  const errors = [];
  const E = (path, msg) => errors.push({ path, msg });
  if (!doc || typeof doc !== 'object') return { ok: false, errors: [{ path: '', msg: 'dashboard must be an object' }] };
  const metrics = opts.metrics ? new Set(opts.metrics) : null;
  const trackers = opts.trackers ? new Set(opts.trackers) : null;
  const units = opts.metricUnits || null;
  const kinds = opts.metricKinds || null;
  const legacy = new Set(opts.legacyIds || []);
  const info = opts.metricInfo || null;
  const stored = new Map((opts.storedWidgets || []).filter((x) => x && x.id).map((x) => [x.id, x]));
  const sameAsStored = (w) => {
    const o = stored.get(w.id);
    return !!o && o.type === w.type && o.metric === w.metric && !!o.stacked === !!w.stacked && JSON.stringify(o.rag) === JSON.stringify(w.rag);
  };

  if (!doc.key || !ID_RE.test(doc.key)) E('key', 'key is required (letters, digits, - or _, max 48)');
  if (!doc.title) E('title', 'title is required');
  if (doc.audience != null && !AUDIENCES.includes(doc.audience)) E('audience', `audience must be one of ${AUDIENCES.join(', ')}`);
  const cols = (doc.grid && doc.grid.columns) || 12;
  if (!(Number.isInteger(cols) && cols >= 1 && cols <= 24)) E('grid.columns', 'columns must be an integer 1-24');

  if (doc.filters != null) {
    if (!Array.isArray(doc.filters)) E('filters', 'filters must be an array');
    else doc.filters.forEach((f, i) => {
      if (!f || !ID_RE.test(f.key || '')) E(`filters[${i}].key`, 'filter key is required');
      if (!f || !FILTER_TYPES.includes(f.type)) E(`filters[${i}].type`, `type must be one of ${FILTER_TYPES.join(', ')}`);
    });
  }

  if (!Array.isArray(doc.widgets) || !doc.widgets.length) { E('widgets', 'at least one widget is required'); return { ok: false, errors }; }
  if (doc.widgets.length > 40) E('widgets', 'a dashboard is capped at 40 widgets (readability + load)');

  const ids = new Set();
  const cells = new Map();
  doc.widgets.forEach((w, i) => {
    const p = `widgets[${i}]`;
    if (!w || !ID_RE.test(w.id || '')) E(`${p}.id`, 'widget id is required');
    else if (ids.has(w.id)) E(`${p}.id`, `duplicate widget id ${w.id}`);
    ids.add(w && w.id);
    const T = WIDGET_TYPES[w && w.type];
    if (!T) { E(`${p}.type`, `type must be one of ${creatableTypes().join(', ')}`); return; }
    if (T.creatable === false && !T.switch && !opts.allowRetired && !legacy.has(w.id)) E(`${p}.type`, T.retiredNote || `${w.type} is no longer offered`);
    if (T.switch && !opts.smallMultiples && !opts.allowRetired && !legacy.has(w.id) && !(stored.get(w.id) && stored.get(w.id).type === w.type)) E(`${p}.type`, T.switchNote);
    if (w.type === 'multiples') {
      const ms = w.metrics;
      if (!Array.isArray(ms) || ms.length < MIN_MULTIPLES || ms.length > MAX_MULTIPLES || !ms.every((k) => typeof k === 'string' && k)) E(`${p}.metrics`, `small multiples need ${MIN_MULTIPLES}-${MAX_MULTIPLES} metric keys, one panel each`);
      else {
        if (new Set(ms).size !== ms.length) E(`${p}.metrics`, 'small multiples must not repeat a metric');
        for (const k of ms) if (metrics && !metrics.has(k)) E(`${p}.metrics`, `unknown metric ${k} — only registered metrics may be charted`);
        if (kinds) {
          const ks = ms.filter((k) => k in kinds).map((k) => kinds[k]);
          if (ks.includes('current')) E(`${p}.metrics`, 'small multiples draw time series — a current snapshot has no history (use a kpi or ragGrid)');
          else if (new Set(ks.map((k) => MONTHLY_KINDS.includes(k) ? 'month' : 'week')).size > 1) E(`${p}.metrics`, 'small multiples share one window — do not mix weekly and monthly metrics');
        }
      }
      // mixed units are the point of the type (one panel, one axis, one unit each) — never refused
    }
    if (T.needsMetric) {
      if (!w.metric || typeof w.metric !== 'string') E(`${p}.metric`, 'metric key is required for this widget type');
      else if (metrics && !metrics.has(w.metric)) E(`${p}.metric`, `unknown metric ${w.metric} — only registered metrics may be charted`);
    }
    // C-08 (G17) — a trend draws a time series; a 'current' metric is a snapshot with no history
    if (w.type === 'trend' && kinds) {
      for (const k of [w.metric].concat(Array.isArray(w.series) ? w.series : [])) {
        if (typeof k === 'string' && kinds[k] === 'current') E(`${p}.${k === w.metric ? 'metric' : 'series'}`, `a trend needs a time series — ${k} is a current snapshot with no history (use a kpi or ragGrid)`);
      }
    }
    // E-V02 — measure → chart contract (stacked bar · stacked rate · ragGrid without RAG policy · bar of a rank)
    if (T.needsMetric && !opts.allowRetired && !sameAsStored(w)) {
      const m = info && typeof w.metric === 'string' && info[w.metric] ? Object.assign({ key: w.metric }, info[w.metric]) : null;
      const why = (m || w.stacked) ? ChartContract.contractError(w.type, m, w) : null;
      if (why && !(w.type === 'trend' && kinds)) E(`${p}.${w.stacked ? 'stacked' : (w.type === 'ragGrid' ? 'rag' : 'type')}`, why);
    }
    if (w.type === 'trackerRag') {
      if (!w.tracker) E(`${p}.tracker`, 'tracker key is required');
      else if (trackers ? !trackers.has(w.tracker) : !TRACKER_KEY_RE.test(String(w.tracker))) E(`${p}.tracker`, `unknown tracker ${w.tracker}`);
    }
    // F24 — a trend's extra lines are registered metrics on the SAME unit as the main one, or nothing
    if (w.series != null) {
      if (w.type !== 'trend') E(`${p}.series`, 'series is only available on trend widgets');
      else if (!Array.isArray(w.series) || !w.series.length || w.series.length > MAX_EXTRA_SERIES || !w.series.every((k) => typeof k === 'string' && k)) E(`${p}.series`, `series must be a list of 1-${MAX_EXTRA_SERIES} metric keys`);
      else {
        if (new Set(w.series).size !== w.series.length || w.series.includes(w.metric)) E(`${p}.series`, 'series must not repeat a metric (the main metric is already drawn)');
        for (const k of w.series) {
          if (metrics && !metrics.has(k)) E(`${p}.series`, `unknown metric ${k} in series — only registered metrics may be charted`);
        }
        if (units && w.metric) {
          const set = new Set([w.metric, ...w.series].filter((k) => k in units).map((k) => String(units[k] || '')));
          if (set.size > 1) E(`${p}.series`, `series mixes units (${[...set].join(', ')}) — one chart, one unit`);
        }
      }
    }
    if (w.rag != null) {
      if (typeof w.rag === 'string') { if (!KpiRag.POLICIES[w.rag]) E(`${p}.rag`, `unknown RAG policy ${w.rag}`); }
      else if (!(w.rag.green > w.rag.amber)) E(`${p}.rag`, 'green threshold must exceed amber');
    }
    // E-V03 — "→ act" link: a relative URL only (no scheme, no //host), so a definition cannot point viewers off-site
    if (w.action_href != null && !R.safeRelativeHref(w.action_href)) E(`${p}.action_href`, 'action link must be a relative URL inside the dashboard (e.g. site-actions.html?site=HGO)');
    if (w.sql != null || w.query != null) E(`${p}`, 'raw sql/query is not allowed in a dashboard definition — register a metric instead');

    const L = w.layout || {};
    const ok = ['x', 'y', 'w', 'h'].every((k) => Number.isInteger(L[k]) && L[k] >= 0);
    if (!ok) { E(`${p}.layout`, 'layout needs integer x, y, w, h'); return; }
    if (L.w < T.minW || L.h < T.minH) E(`${p}.layout`, `${w.type} needs at least ${T.minW}×${T.minH} cells`);
    if (L.x + L.w > cols) E(`${p}.layout`, `widget overflows the ${cols}-column grid`);
    for (let x = L.x; x < L.x + L.w; x++) for (let y = L.y; y < L.y + L.h; y++) {
      const k = `${x},${y}`;
      if (cells.has(k)) { E(`${p}.layout`, `overlaps widget ${cells.get(k)} at cell (${x},${y})`); x = L.x + L.w; break; }
      cells.set(k, w.id);
    }
  });

  return { ok: errors.length === 0, errors };
}

// Field-device profile: a dashboard flagged audience 'field' must stay readable on a phone with
// a slow link — a hard rule of the SOP, enforced here rather than in a review meeting.
function fieldReadiness(doc) {
  const issues = [];
  const widgets = doc.widgets || [];
  if (widgets.length > 8) issues.push(`field dashboards are capped at 8 widgets (has ${widgets.length})`);
  for (const w of widgets) {
    if (w.type === 'table' && (w.pageSize == null || w.pageSize > 10)) issues.push(`table ${w.id}: pageSize ≤ 10 on field devices`);
    if (w.type === 'heatmap') issues.push(`heatmap ${w.id}: not readable on a phone — use ragGrid`);
    if ((w.layout || {}).w < 6 && ['trend', 'bar'].includes(w.type)) issues.push(`${w.type} ${w.id}: charts must span ≥ 6 columns (stack full-width on phones)`);
  }
  return { ok: issues.length === 0, issues };
}

/** The types a composer may offer (retired types keep rendering but are not offered; switch-gated types only when on). */
function creatableTypes(opts = {}) { return Object.keys(widgetTypesFor(opts)).filter((t) => widgetTypesFor(opts)[t].creatable !== false); }
/** WIDGET_TYPES as the composer must see them: a switch-gated type is creatable:false while its switch is off. */
function widgetTypesFor(opts = {}) {
  const out = {};
  for (const [k, T] of Object.entries(WIDGET_TYPES)) out[k] = T.switch && opts.smallMultiples ? Object.assign({}, T, { creatable: true }) : T;
  return out;
}

module.exports = { validateDashboard, fieldReadiness, creatableTypes, widgetTypesFor, WIDGET_TYPES, MIN_MULTIPLES, MAX_MULTIPLES, AUDIENCES, FILTER_TYPES, TRACKER_KEY_RE, MAX_EXTRA_SERIES };
