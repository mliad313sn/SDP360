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

const WIDGET_TYPES = {
  kpi:        { needsMetric: true,  minW: 2, minH: 2, props: ['rag', 'format', 'compare'] },
  trend:      { needsMetric: true,  minW: 4, minH: 3, props: ['series', 'window'] },
  bar:        { needsMetric: true,  minW: 4, minH: 3, props: ['groupBy', 'stacked'] },
  table:      { needsMetric: true,  minW: 4, minH: 3, props: ['columns', 'pageSize'] },
  heatmap:    { needsMetric: true,  minW: 6, minH: 3, props: ['rows', 'cols', 'rag'] },
  ragGrid:    { needsMetric: true,  minW: 4, minH: 3, props: ['rag'] },
  trackerRag: { needsMetric: false, minW: 4, minH: 3, props: ['tracker'] },
  text:       { needsMetric: false, minW: 2, minH: 1, props: ['markdown'] },
  actions:    { needsMetric: false, minW: 4, minH: 3, props: ['sources', 'onlyOverdue'] },
};

const AUDIENCES = ['site', 'executive', 'field', 'committee'];
const FILTER_TYPES = ['site', 'window', 'month', 'week', 'group', 'department', 'text'];
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/i;

/**
 * @param {object} doc              dashboard definition
 * @param {object} [opts]
 * @param {Set<string>|string[]} [opts.metrics]   registered metric keys; when given, unknown metrics are errors
 * @param {Set<string>|string[]} [opts.trackers]  known tracker keys for trackerRag widgets
 */
function validateDashboard(doc, opts = {}) {
  const errors = [];
  const E = (path, msg) => errors.push({ path, msg });
  if (!doc || typeof doc !== 'object') return { ok: false, errors: [{ path: '', msg: 'dashboard must be an object' }] };
  const metrics = opts.metrics ? new Set(opts.metrics) : null;
  const trackers = opts.trackers ? new Set(opts.trackers) : null;

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
    if (!T) { E(`${p}.type`, `type must be one of ${Object.keys(WIDGET_TYPES).join(', ')}`); return; }
    if (T.needsMetric) {
      if (!w.metric || typeof w.metric !== 'string') E(`${p}.metric`, 'metric key is required for this widget type');
      else if (metrics && !metrics.has(w.metric)) E(`${p}.metric`, `unknown metric ${w.metric} — only registered metrics may be charted`);
    }
    if (w.type === 'trackerRag') {
      if (!w.tracker) E(`${p}.tracker`, 'tracker key is required');
      else if (trackers && !trackers.has(w.tracker)) E(`${p}.tracker`, `unknown tracker ${w.tracker}`);
    }
    if (w.rag != null) {
      if (typeof w.rag === 'string') { if (!KpiRag.POLICIES[w.rag]) E(`${p}.rag`, `unknown RAG policy ${w.rag}`); }
      else if (!(w.rag.green > w.rag.amber)) E(`${p}.rag`, 'green threshold must exceed amber');
    }
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

module.exports = { validateDashboard, fieldReadiness, WIDGET_TYPES, AUDIENCES, FILTER_TYPES };
