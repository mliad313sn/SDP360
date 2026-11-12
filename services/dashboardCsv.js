'use strict';
// G15 / F-DATA-05 — the figures behind a dashboard as CSV rows (one row per value). Pure: built from the very
// payload the viewer receives (routes/dashboards.js dashboardData), so the file cannot say something else
// than the screen.
//   - freshness is READ, never assumed: the widget's own state when the colour was withdrawn (degradeStale),
//     else the state of the sources of the metric's module (v.sources). A module typed into the application
//     has no sync job: its cell says NO_SYNC_JOB. A metric the registry does not know leaves the cell empty.
//   - the truths of a figure travel with it: partial, n, target, low_sample, error (appended columns — the
//     former nine keep their order), and a per-site row carries its window label.
const HEADER = ['widget', 'metric', 'site', 'window', 'value', 'unit', 'rag', 'freshness', 'as_of', 'partial', 'n', 'target', 'low_sample', 'error'];
const ORDER = { FRESH: 0, STALE: 1, UNKNOWN: 2 };

/** @param {object} v dashboardData payload · @param {{get:Function}} reg metric registry */
function dashboardCsvRows(v, reg) {
  const byModule = new Map();
  for (const s of (v && v.sources) || []) { const cur = byModule.get(s.module); if (cur == null || (ORDER[s.state] || 0) > (ORDER[cur] || 0)) byModule.set(s.module, s.state); }
  const fresh = (w, metric) => {
    if (w && w.freshness) return w.freshness;
    const m = metric && reg && reg.get ? reg.get(metric) : null;
    if (!m) return '';
    return byModule.has(m.module) ? byModule.get(m.module) : 'NO_SYNC_JOB';
  };
  const yes = (x) => (x ? 'true' : '');
  // F-DATA-08 — a source read in part: the row is partial and says how much was not read
  const ps = (x) => (x && x.partial_source ? `partial source: ${x.partial_source.unread} of ${x.partial_source.read + x.partial_source.unread} parts not read` : '');
  const rows = [HEADER.slice()];
  const siteName = (((v && v.sites) || []).find((s) => s.id === v.site) || {}).name || '';
  for (const [id, w] of Object.entries((v && v.widgets) || {})) {
    const t = w.title || id; const at = w.as_of || v.as_of; const before = rows.length;
    if (w.mode === 'single') rows.push([t, w.metric, 'site_id' in w && w.site_id == null ? 'fleet' : siteName, (w.window && w.window.label) || '', w.value, w.unit, w.rag, fresh(w, w.metric), at, yes(w.partial || w.partial_source), w.n, w.target, yes(w.low_sample), w.error || ps(w)]);
    else if (w.mode === 'per-site') for (const r of w.rows || []) rows.push([t, w.metric, r.site, (w.window && w.window.label) || '', r.value, w.unit, r.rag, fresh(w, w.metric), at, yes(w.partial || r.partial_source), r.n, r.target, yes(r.low_sample), w.error || ps(r)]);
    else if (w.mode === 'series') {
      for (const p of w.points || []) rows.push([t, w.metric, siteName, p.label, p.value, w.unit, '', fresh(w, w.metric), at, yes(p.partial), p.n, p.target, '', w.error || '']);
      for (const l of (w.lines || []).slice(1)) for (const p of l.points || []) rows.push([t, l.metric, siteName, p.label, p.value, l.unit, '', fresh(w, l.metric), at, yes(p.partial), p.n, '', '', w.error || '']);
    } else if (w.mode === 'multiples') {
      for (const pn of w.panels || []) for (const p of pn.points || []) rows.push([t, pn.metric, siteName, p.label, p.value, pn.unit, '', fresh(w, pn.metric), at, yes(p.partial), '', '', '', w.error || '']);
    } else if (w.mode === 'tracker') for (const r of w.rows || []) rows.push([t, 'tracker.site_score_pct', r.site, w.period || '', r.score_pct, '%', r.rag, w.state || '', at, '', '', '', '', w.error || '']);
    // a widget that failed to resolve is a row with its error, not a silent absence
    if (w.error && rows.length === before) rows.push([t, w.metric || '', '', '', '', '', '', '', at, '', '', '', '', w.error]);
  }
  return rows;
}

function toCsv(rows) {
  const { neutralize } = require('../public/lib/csvSafe');
  const cell = (x) => { const t = neutralize(x == null ? '' : x); return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { HEADER, dashboardCsvRows, toCsv };
