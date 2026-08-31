'use strict';

// Pure merge function for the Infrastructure Health page.
// No I/O, no DB, no Date.now(). All inputs injected.

const FAMILIES = ['wan', 'lan', 'wifi', 'servers'];

// status_color vocab -> page/rollup vocab (green/amber/red/na only)
function normalizeRag(statusColor) {
  switch (statusColor) {
    case 'green': return 'green';
    case 'orange': return 'amber';
    case 'red': return 'red';
    default: return 'na'; // 'none' or anything unrecognized
  }
}

// EXACT roll-up copied from routes/siteAwareness.js:82-89
function rollupRag(cells) {
  const scored = Object.values(cells).map((c) => c && c.rag)
    .filter((r) => r === 'green' || r === 'amber' || r === 'red')
    .map((r) => (r === 'green' ? 2 : (r === 'amber' ? 1 : 0)));
  if (!scored.length) return 'na';
  const pct = (scored.reduce((a, b) => a + b, 0) / scored.length) / 2;
  return pct >= 0.75 ? 'green' : (pct >= 0.5 ? 'amber' : 'red');
}

// Aggregate the 4 family trends: down wins, else up, else no_change.
function rollupTrend(cells) {
  const trends = Object.values(cells).map(c => c && c.trend);
  if (trends.some(t => t === 'down')) return 'down';
  if (trends.some(t => t === 'up')) return 'up';
  return 'no_change';
}

// WAN cell = MIN of non-null availability_pct across uplinks (worst uplink),
// plus a per-uplink breakdown so the page can show BOTH links (e.g. WAN1 · WAN2).
function wanRollup(uplinks, wanTarget) {
  // Per-uplink list: label uppercased, value may be null. Sorted by label ascending (stable).
  const list = (uplinks || [])
    .map(u => ({
      label: String(u && u.uplink != null ? u.uplink : '').toUpperCase(),
      value: (u && u.availability_pct != null ? u.availability_pct : null),
    }))
    .sort((a, b) => (a.label < b.label ? -1 : (a.label > b.label ? 1 : 0)));

  // No uplinks at all.
  if (!list.length) return { value: null, rag: 'na', target: wanTarget, trend: null, stale: false, uplinks: [] };

  const vals = list.map(u => u.value).filter(v => v != null);
  if (!vals.length) return { value: null, rag: 'na', target: wanTarget, trend: null, stale: false, uplinks: list };
  const value = Math.min(...vals);
  const rag = value >= wanTarget ? 'green' : (value >= wanTarget * 0.9 ? 'amber' : 'red');
  return { value, rag, target: wanTarget, trend: null, stale: false, uplinks: list };
}

function buildInfraMatrix({ opmSites, wanSites, wanTarget = 98, asOf } = {}) {
  const wanBySite = new Map();
  for (const w of (wanSites || [])) {
    wanBySite.set(w.site_id, w);
  }

  const by_family_counts = {};
  for (const fam of FAMILIES) {
    by_family_counts[fam] = { green: 0, amber: 0, red: 0, na: 0 };
  }

  let staleCount = 0;
  let dataThroughMax = null;

  const sites = (opmSites || []).map(site => {
    const famByKind = {};
    for (const f of (site.families || [])) {
      famByKind[f.kpi_family] = f;
    }

    const cells = {};

    // LAN / WLAN(wifi) / Servers from opm families
    for (const fam of ['lan', 'wifi', 'servers']) {
      const f = famByKind[fam];
      if (!f) {
        cells[fam] = { value: null, rag: 'na' };
      } else {
        cells[fam] = {
          value: f.metric_value,
          rag: normalizeRag(f.status_color),
          target: f.target,
          trend: f.trend,
          stale: f.stale,
          data_through: f.data_through,
          device_count: f.device_count,
        };
      }
    }

    // WAN from wanSites matched by site_id
    const w = wanBySite.get(site.site_id);
    cells.wan = wanRollup(w && w.uplinks, wanTarget);

    // fleet aggregation
    let siteHasStale = false;
    for (const fam of FAMILIES) {
      const c = cells[fam];
      const rag = c.rag;
      by_family_counts[fam][rag] = (by_family_counts[fam][rag] || 0) + 1;
      if (c && c.stale) siteHasStale = true;
      if (c && c.data_through != null) {
        if (dataThroughMax == null || c.data_through > dataThroughMax) {
          dataThroughMax = c.data_through;
        }
      }
    }
    if (siteHasStale) staleCount++;

    return {
      site_id: site.site_id,
      site_name: site.site_name,
      overall_rag: rollupRag(cells),
      overall_trend: rollupTrend(cells),
      families: cells,
    };
  });

  return {
    sites,
    fleet: {
      by_family_counts,
      freshness: { stale_count: staleCount, data_through_max: dataThroughMax },
    },
  };
}

// Monthly availability trend for ONE site (LAN/WLAN/Servers only — no WAN in v1).
// Pure: no DB, no Date.now(). Axis is derived from asOf by year/month arithmetic.
function buildInfraTrend({ opmMonthly, months, asOf } = {}) {
  const TREND_FAMILIES = ['lan', 'wifi', 'servers'];

  // Derive end month (0-based) from asOf 'YYYY-MM-DD'.
  const endYear = parseInt(String(asOf).substr(0, 4), 10);
  const endMonth = parseInt(String(asOf).substr(5, 2), 10) - 1; // 0-based

  // Contiguous month axis ending at asOf's month.
  const labels = [];
  for (let i = months - 1; i >= 0; i--) {
    // total months since year 0
    const total = endYear * 12 + endMonth - i;
    const y = Math.floor(total / 12);
    const m = total % 12; // 0-based
    labels.push(`${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}`);
  }

  // Index availability rows by family -> 'YYYY-MM' -> value.
  const byFamMonth = {};
  for (const fam of TREND_FAMILIES) byFamMonth[fam] = {};
  for (const row of (opmMonthly || [])) {
    if (!row || row.metric_name !== 'availability') continue;
    const fam = row.kpi_family;
    if (!TREND_FAMILIES.includes(fam)) continue; // WAN and others ignored
    const ym = String(row.period_start).substr(0, 7);
    byFamMonth[fam][ym] = row.metric_value;
  }

  const series = {};
  for (const fam of TREND_FAMILIES) {
    series[fam] = labels.map(ym => (ym in byFamMonth[fam] ? byFamMonth[fam][ym] : null));
  }

  return { labels, series };
}

module.exports = { buildInfraMatrix, buildInfraTrend, rollupRag, rollupTrend, wanRollup, normalizeRag };
