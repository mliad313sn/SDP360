'use strict';
// V1b-A — PURE WAN quality derive. No I/O. Turns a Meraki loss/latency time series
// (getDeviceLossAndLatencyHistory) into a period availability% + quality averages.
//
// % Time Up is DERIVED (Meraki gives loss/latency, not uptime) and calibration-gated
// (§7 of the spec): an interval is "up" iff it has a sample with lossPercent < 100.
// A MISSING interval (totalIntervals > series.length) is ambiguous — the caller's
// `missing` policy decides: 'down' (absent = down, denom = totalIntervals) or
// 'unknown' (absent excluded, denom = present samples). The correct policy is locked
// by calibrating the output against Meraki's own Summary Report, not assumed here.

function round2(x) {
  if (x == null || Number.isNaN(x)) return null;
  return Math.round(x * 100) / 100;
}

function _avg(nums) {
  const xs = nums.filter((n) => n != null && Number.isFinite(+n)).map(Number);
  if (!xs.length) return null;
  return round2(xs.reduce((a, b) => a + b, 0) / xs.length);
}

// series: [{ lossPercent, latencyMs, jitter, goodput }, …] (present samples only)
// opts: { totalIntervals, missing:'down'|'unknown' }
function deriveAvailability(series, { totalIntervals, missing = 'down' } = {}) {
  const rows = Array.isArray(series) ? series : [];
  const present = rows.length;
  const up = rows.filter((s) => s && s.lossPercent != null && Number(s.lossPercent) < 100).length;

  // Zero samples at all = no data (collection/API gap), NOT a measured total outage —
  // absence is `null` → status `none`, never a fabricated 0% (spec §7). The `missing`
  // policy only governs absent intervals WITHIN a window that has ≥1 real sample.
  const denom = missing === 'unknown' ? present : (totalIntervals != null ? totalIntervals : present);
  const availability_pct = (present === 0 || denom <= 0) ? null : round2((100 * up) / denom);

  return {
    availability_pct,
    loss_pct_avg: _avg(rows.map((s) => s && s.lossPercent)),
    latency_ms_avg: _avg(rows.map((s) => s && s.latencyMs)),
    jitter_ms_avg: _avg(rows.map((s) => s && s.jitter)),
    goodput_avg: _avg(rows.map((s) => s && s.goodput)),
  };
}

// Report band (same as reports.html autoInfraStatusTrend): >=target green,
// >=target*0.9 orange, else red; null → none. NOT V1a's ±2 band — one canonical
// band so the report cell and the WAN dashboard never disagree on a colour.
function statusColor(pct, target) {
  if (pct == null) return 'none';
  const t = Number(target);
  if (!Number.isFinite(t) || t <= 0) return 'none';
  if (pct >= t) return 'green';
  if (pct >= t * 0.9) return 'orange';
  return 'red';
}

// A Meraki MX pings SEVERAL destinations per uplink (connectivityMonitoringDestinations).
// Merge the per-destination loss/latency series into ONE, aligned by startTime, so the WAN
// link is "up" for an interval iff it responded to ANY destination — otherwise a single
// destination outage (e.g. Google unreachable) would read as a link outage and the derived
// % Time Up would under-report vs Meraki's own number. lossPercent = MIN across destinations
// (best path → drives up/down); latency/jitter/goodput = average across present destinations.
function mergeDestinationSeries(seriesList) {
  const byTs = new Map();
  for (const series of (seriesList || [])) {
    for (const s of (series || [])) {
      // getDeviceLossAndLatencyHistory returns startTs/endTs (NOT startTime) — accept
      // the real field first, keep startTime/ts as defensive fallbacks. Missing this
      // dropped every real sample → empty merge → null metrics (prod bug 2026-08-16).
      const ts = s && (s.startTs || s.startTime || s.ts);
      if (!ts) continue;
      let b = byTs.get(ts);
      if (!b) { b = { startTime: ts, endTime: s.endTs || s.endTime || null, loss: [], lat: [], jit: [], good: [] }; byTs.set(ts, b); }
      if (s.lossPercent != null && Number.isFinite(+s.lossPercent)) b.loss.push(+s.lossPercent);
      if (s.latencyMs != null && Number.isFinite(+s.latencyMs)) b.lat.push(+s.latencyMs);
      if (s.jitter != null && Number.isFinite(+s.jitter)) b.jit.push(+s.jitter);
      if (s.goodput != null && Number.isFinite(+s.goodput)) b.good.push(+s.goodput);
    }
  }
  const out = [];
  for (const b of byTs.values()) {
    out.push({
      startTime: b.startTime, endTime: b.endTime,
      lossPercent: b.loss.length ? Math.min(...b.loss) : null,   // best-of → up if any dest up
      latencyMs: _avg(b.lat), jitter: _avg(b.jit), goodput: _avg(b.good),
    });
  }
  out.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  return out;
}

module.exports = { deriveAvailability, statusColor, round2, mergeDestinationSeries };
