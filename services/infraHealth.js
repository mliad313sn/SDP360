'use strict';

// Pure merge function for the Infrastructure Health page.
// No I/O, no DB, no Date.now(). All inputs injected.

// The two WAN uplinks are shown as SEPARATE columns (wan1, wan2): they are
// same-capacity redundant links, each sized to carry the whole site — so a single
// red link must not paint the whole WAN red. The site's WAN health for the overall
// roll-up therefore uses the BEST of the two (redundancy: the site is reachable if
// either link is up), computed as a synthetic 'wan' cell that never enters the grid.
const FAMILIES = ['wan1', 'wan2', 'lan', 'wifi', 'servers'];

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

// Band a WAN availability value against the target (same >=t / >=t*0.9 / else bands
// used everywhere), null → 'na'. Values are clamped to 100 first (the snapshot
// "% Time Up" can round slightly over 100, e.g. 100.14).
function _wanBand(v, wanTarget) {
  if (v == null) return 'na';
  return v >= wanTarget ? 'green' : (v >= wanTarget * 0.9 ? 'amber' : 'red');
}

// Split the uplinks into two SEPARATE cells (wan1, wan2) plus a redundancy-aware
// `best` (the higher of the two — the site's WAN is healthy if either link is up).
// Each cell: { value, rag, target }. Absent link → { value:null, rag:'na' }.
function wanCells(uplinks, wanTarget) {
  const clamp = v => (v == null ? null : Math.min(100, v));
  const slot = { wan1: null, wan2: null };
  for (const u of (uplinks || [])) {
    const label = String(u && u.uplink != null ? u.uplink : '').toUpperCase();
    const key = label.includes('2') ? 'wan2' : (label.includes('1') ? 'wan1' : null);
    const v = clamp(u && u.availability_pct != null ? u.availability_pct : null);
    if (key) { if (slot[key] == null) slot[key] = v; }
    else if (slot.wan1 == null) slot.wan1 = v;   // unlabelled uplink → first free slot
    else if (slot.wan2 == null) slot.wan2 = v;
  }
  const wan1 = { value: slot.wan1, rag: _wanBand(slot.wan1, wanTarget), target: wanTarget };
  const wan2 = { value: slot.wan2, rag: _wanBand(slot.wan2, wanTarget), target: wanTarget };
  const vals = [slot.wan1, slot.wan2].filter(v => v != null);
  const bestVal = vals.length ? Math.max(...vals) : null;
  const best = { value: bestVal, rag: _wanBand(bestVal, wanTarget), target: wanTarget };
  return { wan1, wan2, best };
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
          value: (f.metric_value == null ? null : Math.min(100, f.metric_value)),  // cap at 100% (defensive)
          rag: normalizeRag(f.status_color),
          target: f.target,
          trend: f.trend,
          stale: f.stale,
          data_through: f.data_through,
          device_count: f.device_count,
        };
      }
    }

    // WAN from wanSites matched by site_id → two separate columns (wan1, wan2) + a
    // redundancy-aware best link for the overall roll-up.
    const w = wanBySite.get(site.site_id);
    const wan = wanCells(w && w.uplinks, wanTarget);
    cells.wan1 = wan.wan1;
    cells.wan2 = wan.wan2;

    // fleet aggregation — count each displayed family (wan1, wan2, lan, wifi, servers).
    for (const fam of FAMILIES) {
      const rag = cells[fam].rag;
      by_family_counts[fam][rag] = (by_family_counts[fam][rag] || 0) + 1;
    }
    // Freshness/stale are OPManager-side only (LAN/WLAN/Servers carry stale + data_through;
    // WAN cells come from the WAN snapshot and don't).
    let siteHasStale = false;
    for (const fam of ['lan', 'wifi', 'servers']) {
      const c = cells[fam];
      if (c && c.stale) siteHasStale = true;
      if (c && c.data_through != null && (dataThroughMax == null || c.data_through > dataThroughMax)) {
        dataThroughMax = c.data_through;
      }
    }
    if (siteHasStale) staleCount++;

    // Overall roll-up sees ONE WAN (the best link — redundancy), never wan1+wan2
    // separately (that would double-weight WAN and let a single red link drag it down).
    const rollupCells = { wan: wan.best, lan: cells.lan, wifi: cells.wifi, servers: cells.servers };

    return {
      site_id: site.site_id,
      site_name: site.site_name,
      overall_rag: rollupRag(rollupCells),
      overall_trend: rollupTrend(rollupCells),
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

module.exports = { buildInfraMatrix, buildInfraTrend, rollupRag, rollupTrend, wanCells, normalizeRag };
