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
  const scored = Object.values(cells).map(c => c && c.rag)
    .filter(r => r === 'green' || r === 'amber' || r === 'red')
    .map(r => (r === 'green' ? 2 : (r === 'amber' ? 1 : 0)));
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

// WAN cell = MIN of non-null availability_pct across uplinks (worst uplink).
function wanRollup(uplinks, wanTarget) {
  const vals = (uplinks || [])
    .map(u => (u && u.availability_pct != null ? u.availability_pct : null))
    .filter(v => v != null);
  if (!vals.length) return { value: null, rag: 'na', target: wanTarget, trend: null, stale: false };
  const value = Math.min(...vals);
  const rag = value >= wanTarget ? 'green' : (value >= wanTarget * 0.9 ? 'amber' : 'red');
  return { value, rag, target: wanTarget, trend: null, stale: false };
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

module.exports = { buildInfraMatrix, rollupRag, rollupTrend, wanRollup, normalizeRag };
