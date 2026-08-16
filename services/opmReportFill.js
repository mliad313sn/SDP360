'use strict';
// V1b-C — PURE report auto-fill mapping. No I/O. Turns wan_link_snapshots (V1b-A) +
// infra_metric_snapshots (V1b-B) rows into per-cell fill descriptors for the site report's
// Infrastructure KPIs table. `serviceToFill` maps a row's free-text service name to a
// snapshot key; the client uses the SAME mapping to match its rendered rows (keep the inline
// mirror in reports.html in sync with this). Backup/Radio (no source) → null (never filled).
// A null metric produces NO fill entry (nothing to fill; the report stays blank there).

// Delegates to the shared UMD matcher so there is exactly ONE family classifier
// (no divergeable regex copies). Kept exported for back-compat.
function serviceToFill(name) {
  return require('../public/lib/wanLineMatch').parseServiceLine(name, []).family;
}

function _round1(x) { return x == null || Number.isNaN(+x) ? null : Math.round(+x * 10) / 10; }
function _fmtPct(x) { const r = _round1(x); return r == null ? null : `${r}%`; }
function _isStale(ref, staleDays, nowMs) {
  if (!ref) return false;
  const t = Date.parse(String(ref).slice(0, 10));
  if (Number.isNaN(t)) return false;
  return Math.floor((nowMs - t) / 86400000) > staleDays;
}

// wan: wan_link_snapshots rows (uplink wan1/wan2). infra: infra_metric_snapshots rows.
function buildFills({ wan = [], infra = [], staleDays = 9, nowMs = Date.now() } = {}) {
  const fills = [];
  for (const r of wan) {
    if (r.period_type && r.period_type !== 'week') continue;   // report is weekly
    if (!/^wan[12]$/.test(String(r.uplink || ''))) continue;
    const value = _fmtPct(r.availability_pct);
    if (value == null) continue;                               // nothing to fill
    fills.push({
      match: r.uplink, sub_site: r.sub_site || '',
      value, status_color: r.status_color || 'none', trend: r.trend || null,
      stale: _isStale(r.data_through, staleDays, nowMs), basis: r.basis || null,
      source: 'meraki', data_through: r.data_through || null,
    });
  }
  for (const r of infra) {
    if (r.period_type && r.period_type !== 'week') continue;
    if (r.metric_name && r.metric_name !== 'availability') continue;
    if (!['lan', 'wifi', 'servers'].includes(String(r.kpi_family || ''))) continue;
    const value = _fmtPct(r.metric_value);
    if (value == null) continue;
    fills.push({
      match: r.kpi_family, sub_site: '',   // OpManager has no sub-site source
      value, status_color: r.status_color || 'none', trend: r.trend || null,
      stale: _isStale(r.data_through, staleDays, nowMs), basis: r.basis || null,
      source: 'opmanager', data_through: r.data_through || null,
    });
  }
  return fills;
}

module.exports = { serviceToFill, buildFills };
