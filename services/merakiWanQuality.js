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

module.exports = { deriveAvailability, statusColor, round2 };
