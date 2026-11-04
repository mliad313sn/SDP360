/* C-12 / G20 — data shaping for the two Hygiene-tab visuals, pure and browser/Node-shared (UMD).
 *   bulletRows(by_site)        -> per-site completeness bullets: owner / acquisition date / cost / scanned present %
 *   bulletHtml(rows)           -> an accessible <table class="list"> of bullets (every value escaped)
 *   pareto(by_kind, labels)    -> hygiene kinds by count (desc) + share and cumulative share of flagged occurrences
 *   paretoSpec(p)              -> the { title, labels, datasets } spec handed to Chart.js AND ChartTable
 * Rules: null = not measured (drawn as "—", never as 0); no money and no currency glyph; the bands reuse the
 * thresholds the Hygiene tab already uses for completeness (>= 80 good, >= 50 mid, else bad) — no new threshold.
 * The kinds overlap (one asset can lack an owner AND a cost), so Pareto percentages are shares of flagged
 * OCCURRENCES, not of assets; the page says so. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AssetHygieneVisuals = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MEASURES = [
    { key: 'owner', field: 'owner_pct', label: 'Owner' },
    { key: 'age', field: 'age_pct', label: 'Acquisition date' },
    { key: 'cost', field: 'cost_pct', label: 'Cost' },
    { key: 'scan', field: 'scan_pct', label: 'Scanned' },
  ];
  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    var n = Number(v); return isFinite(n) ? n : null;
  }
  function band(p) { return p == null ? 'none' : (p >= 80 ? 'good' : (p >= 50 ? 'mid' : 'bad')); }
  function fmtPct(p) { return p == null ? '—' : (Math.round(p * 10) / 10) + '%'; }

  function bulletRows(bySite) {
    var rows = (bySite || []).map(function (r, i) {
      var total = num(r.total) || 0;
      var measures = MEASURES.map(function (m) {
        var p = total > 0 ? num(r[m.field]) : null;
        return { key: m.key, label: m.label, pct: p, band: band(p) };
      });
      return { site: r.site == null ? '' : String(r.site), label: r.site ? String(r.site) : '(no site)', total: total,
        completeness: total > 0 ? num(r.completeness) : null, measures: measures, _i: i };
    });
    rows.sort(function (a, b) {
      if (a.completeness == null && b.completeness == null) return a._i - b._i;
      if (a.completeness == null) return 1;
      if (b.completeness == null) return -1;
      return (a.completeness - b.completeness) || (a._i - b._i);
    });
    rows.forEach(function (r) { delete r._i; });
    return rows;
  }

  function bulletHtml(rows) {
    if (!rows || !rows.length) return '<p class="count-note">No assets in scope for the current filters.</p>';
    var head = '<tr><th scope="col">Site</th><th scope="col" class="num">Assets</th>' +
      MEASURES.map(function (m) { return '<th scope="col">' + esc(m.label) + '</th>'; }).join('') + '</tr>';
    var body = rows.map(function (r) {
      return '<tr><th scope="row">' + esc(r.label) + '</th><td class="num">' + esc(r.total.toLocaleString('en')) + '</td>' +
        r.measures.map(function (m) {
          var aria = m.label + ': ' + (m.pct == null ? 'not measured' : fmtPct(m.pct) + ' present');
          var bar = m.pct == null ? '' :
            '<span class="hyg-bullet__bar ' + m.band + '" style="width:' + Math.max(0, Math.min(100, m.pct)) + '%"></span>';
          return '<td><div class="hyg-bullet" role="img" aria-label="' + esc(aria) + '">' +
            '<span class="hyg-bullet__band"></span>' + bar + '</div>' +
            '<span class="hyg-bullet__v">' + esc(fmtPct(m.pct)) + '</span></td>';
        }).join('') + '</tr>';
    }).join('');
    return '<table class="list hyg-bullets"><caption>Completeness by site — share of assets with each field present ' +
      '(bands: under 50%, 50–80%, 80% and over)</caption><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }

  function pareto(byKind, labels) {
    labels = labels || {};
    if (!byKind || typeof byKind !== 'object') return { state: 'NO_DATA', total: 0, rows: [], unmeasured: [] };
    var order = Object.keys(labels);
    Object.keys(byKind).forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
    var rows = [], unmeasured = [];
    order.forEach(function (k, i) {
      if (!Object.prototype.hasOwnProperty.call(byKind, k)) return;
      var n = num(byKind[k]);
      if (n == null) { unmeasured.push(k); return; }
      rows.push({ kind: k, label: labels[k] || k, count: n, _i: i });
    });
    rows.sort(function (a, b) { return (b.count - a.count) || (a._i - b._i); });
    var total = rows.reduce(function (s, r) { return s + r.count; }, 0);
    var cum = 0;
    rows.forEach(function (r) {
      delete r._i;
      cum += r.count;
      r.pct = total > 0 ? Math.round(1000 * r.count / total) / 10 : null;
      r.cum_pct = total > 0 ? Math.round(1000 * cum / total) / 10 : null;
    });
    return { state: total > 0 ? 'VALID' : (rows.length ? 'ZERO' : 'NO_DATA'), total: total, rows: rows, unmeasured: unmeasured };
  }

  function paretoSpec(p) {
    var rows = (p && p.rows) || [];
    return {
      title: 'Data-quality anomalies — Pareto', labelHead: 'Anomaly', state: p ? p.state : 'NO_DATA',
      labels: rows.map(function (r) { return r.label; }),
      datasets: [
        { label: 'Flagged assets', data: rows.map(function (r) { return r.count; }) },
        { label: 'Cumulative share', unit: '%', data: rows.map(function (r) { return r.cum_pct; }) },
      ],
    };
  }

  return { MEASURES: MEASURES, band: band, bulletRows: bulletRows, bulletHtml: bulletHtml, pareto: pareto, paretoSpec: paretoSpec };
});
