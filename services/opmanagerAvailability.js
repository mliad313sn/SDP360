'use strict';
// V1b-B — PURE device-availability aggregate. No I/O. Averages each device's
// availdata.Up% into a per-(site, family) availability for LAN/WLAN/Servers.
// WAN and excluded families are dropped (WAN = Meraki, V1b-A). A device with no
// readable availUp is not counted (never 0). A family with no readable device →
// metric_value null (status 'none'), never a fabricated 0. Rows are shaped for
// infra_metric_snapshots with basis='recent' (the availdata window is not the exact
// period — labelled, not passed off as the week's).
const { statusColor } = require('./merakiWanQuality');   // shared report band (>=t/>=t*0.9/else)

function _round2(x) { return x == null || Number.isNaN(x) ? null : Math.round(x * 100) / 100; }

// families we emit here (WAN is Meraki; 'excluded' is dropped)
const _EMIT = new Set(['lan', 'wifi', 'servers']);

// data_through (optional, A-18a): the date the readings are TRUE through. The REST collector
// passes the collection date — availdata is "now"-ish, and the current month's period_end is a
// future date that would keep a month row from ever going stale. Absent → period.period_end
// (unchanged behaviour for any other caller).
function aggregateDeviceAvail(devices, { classify, deviceToSite, targets = {}, period, collected_at, data_through }) {
  const through = data_through || period.period_end;
  // group availUp values per (site_id | family)
  const groups = new Map();   // key → { site_id, family, vals:[], total:0 }
  for (const d of (devices || [])) {
    const family = classify(d.type, d.category).family;
    if (!_EMIT.has(family)) continue;                    // wan / excluded → skip
    const site_id = deviceToSite(d);
    if (site_id == null) continue;                       // unmapped device → skip
    const key = `${site_id}|${family}`;
    let g = groups.get(key);
    if (!g) { g = { site_id, family, vals: [], total: 0 }; groups.set(key, g); }
    g.total += 1;
    const v = d.availUp;
    if (v != null && Number.isFinite(+v)) g.vals.push(+v);
  }

  const rows = [];
  for (const g of groups.values()) {
    const metric_value = g.vals.length ? _round2(g.vals.reduce((a, b) => a + b, 0) / g.vals.length) : null;
    rows.push({
      site_id: g.site_id, period_type: period.period_type, period_start: period.period_start, period_end: period.period_end,
      kpi_family: g.family, metric_name: 'availability',
      metric_value, target_value: (targets[g.family] != null ? targets[g.family] : null),
      status_color: statusColor(metric_value, targets[g.family]),
      trend: null, source: 'opmanager_rest', data_through: through,
      device_count: g.total, included_device_count: g.vals.length,
      collected_at, basis: 'recent', raw_json: null,
    });
  }
  return rows;
}

// data_as_of (A-18a): the latest collected_at among the snapshot rows a response is built from —
// the date the DATA is from, next to as_of (today, kept unchanged for existing clients). null
// when no row was used (never today's date for data that does not exist).
function dataAsOf(...rowSets) {
  let max = null;
  for (const rows of rowSets) for (const r of (rows || [])) {
    const c = r && r.collected_at ? String(r.collected_at) : null;
    if (c && (max == null || c > max)) max = c;
  }
  return max;
}

module.exports = { aggregateDeviceAvail, dataAsOf, _EMIT };
