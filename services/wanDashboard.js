'use strict';
// V1b-D — PURE WAN dashboard shaping. No I/O. Turns wan_link_snapshots rows into a
// per-site summary (latest period per uplink) and per-uplink trend series.

function _cell(r) {
  return {
    uplink: r.uplink, sub_site: r.sub_site || '', availability_pct: r.availability_pct, status_color: r.status_color || 'none',
    avail_quality_pct: r.avail_quality_pct == null ? null : r.avail_quality_pct,
    loss_pct_max: r.loss_pct_max == null ? null : r.loss_pct_max, latency_ms_max: r.latency_ms_max == null ? null : r.latency_ms_max,
    loss_pct_avg: r.loss_pct_avg, latency_ms_avg: r.latency_ms_avg, jitter_ms_avg: r.jitter_ms_avg,
    goodput_avg: r.goodput_avg, uplink_label: r.uplink_label || null,
    period_start: r.period_start, period_end: r.period_end || null,
    data_through: r.data_through || null, basis: r.basis || null,
  };
}

// Latest (max period_start) row per (site_id, sub_site, uplink), grouped by site, sites ordered by id.
function latestPerSite(rows) {
  const latest = new Map();   // `${site}|${sub_site}|${uplink}` → row
  for (const r of (rows || [])) {
    const k = `${r.site_id}|${r.sub_site || ''}|${r.uplink}`;
    const cur = latest.get(k);
    if (!cur || String(r.period_start) > String(cur.period_start)) latest.set(k, r);
  }
  const bySite = new Map();
  for (const r of latest.values()) {
    if (!bySite.has(r.site_id)) bySite.set(r.site_id, []);
    bySite.get(r.site_id).push(_cell(r));
  }
  return [...bySite.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([site_id, uplinks]) => ({
      site_id,
      uplinks: uplinks.sort((a, b) =>
        String(a.sub_site).localeCompare(String(b.sub_site)) ||
        String(a.uplink).localeCompare(String(b.uplink))),
    }));
}

// Per-(sub_site, uplink) series, ordered by period_start ascending.
function trendSeries(rows) {
  const byUplink = new Map();
  for (const r of (rows || [])) {
    const sub = r.sub_site || '';
    const k = `${sub}||${r.uplink}`;
    if (!byUplink.has(k)) byUplink.set(k, { uplink: r.uplink, sub_site: sub, points: [] });
    byUplink.get(k).points.push({
      period_start: r.period_start, availability_pct: r.availability_pct,
      status_color: r.status_color || 'none', loss_pct_avg: r.loss_pct_avg, latency_ms_avg: r.latency_ms_avg,
    });
  }
  return [...byUplink.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([, s]) => ({ uplink: s.uplink, sub_site: s.sub_site, points: s.points.sort((a, b) => String(a.period_start).localeCompare(String(b.period_start))) }));
}

module.exports = { latestPerSite, trendSeries };
