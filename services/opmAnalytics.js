'use strict';
// V1a — OPManager Analytics adapter. readDailyRows maps the prepared daily view's
// header-keyed rows (returned by server.js `fetchView`) into the normalized shape the
// pure aggregator consumes. coverageSummary is a pure governance rollup (included /
// excluded / unmapped probes). No DB here.

async function readDailyRows({ fetchView, viewId }) {
  if (!viewId || typeof fetchView !== 'function') return [];
  const res = await fetchView(viewId);            // { status, rows, columns }
  const rows = (res && res.rows) || [];
  return rows.map(r => ({
    device_key:      r['Device Key'] || r['Device ID'] || r['Resource ID'] || null,
    device_name:     r['Device Name'] || null,
    probe:           r['Probe Name'] || null,
    type:            r['Type'] || null,
    category:        r['Category'] || null,
    vendor:          r['Vendor'] || null,
    day:             r['Day'] || r['Time Period'] || null,
    uptime_pct:      r['Uptime Percentage'] != null ? r['Uptime Percentage'] : null,
    uptime_dur:      r['Uptime Duration'] || null,
    downtime_dur:    r['Downtime Duration'] || null,
    maintenance_dur: r['Maintenance Duration'] || null,
    dependent_dur:   r['Dependent Unavailability Duration'] || null,
    unmonitored_dur: r['Unmonitored Duration'] || null,
    onhold_dur:      r['On Hold Duration'] || null,
  }));
}

// Pure. Dedups per DEVICE (rows are per-device × day) then classifies + maps.
function coverageSummary(rows, { classify, probeToSite }) {
  const seen = new Map();
  for (const r of (rows || [])) {
    const dev = r.device_key || r.device_name || `${r.probe}|${r.type}|${r.category}`;
    if (!seen.has(dev)) seen.set(dev, r);
  }
  const by_family = { lan: 0, wifi: 0, wan: 0, servers: 0 };
  let included = 0, excluded = 0;
  const unmapped = new Set();
  for (const r of seen.values()) {
    const family = classify(r.type, r.category).family;
    if (family === 'excluded') { excluded++; continue; }
    const site = probeToSite(r.probe);
    if (site == null) { if (r.probe) unmapped.add(r.probe); continue; }
    included++; by_family[family] = (by_family[family] || 0) + 1;
  }
  return { total: seen.size, included, excluded, by_family, unmapped_probes: [...unmapped].sort() };
}

module.exports = { readDailyRows, coverageSummary };
