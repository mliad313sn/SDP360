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

function _max(nums) {
  const xs = (nums || []).filter((n) => n != null && Number.isFinite(+n)).map(Number);
  return xs.length ? round2(Math.max(...xs)) : null;
}

// Quality-weighted availability from a fine-resolution (ideally 60s) loss/latency series.
// The binary "% Time Up" (loss<100) treats a badly-degraded link as up — Meraki's own % Time
// Up does NOT: a bursty-loss uplink reads e.g. 24% up even though it's never fully down. So we
// score EACH interval's usability 0..1 from loss/latency/jitter (piecewise-linear between a
// "good" and a "bad" threshold, weakest-link = min across present metrics), and the effective
// availability is the time-mean of that score. A missing interval (totalIntervals > present)
// counts as down (health 0), like deriveAvailability. Thresholds are CALIBRATED against Meraki's
// Summary Report — the defaults are VoIP-grade starting points, overridable via opts.thresholds.
const DEFAULT_QUALITY_THRESHOLDS = {
  loss: { good: 1, bad: 20 },       // % packet loss: h=1 at <=1%, h=0 at >=20%
  latency: { good: 100, bad: 400 }, // ms RTT:        h=1 at <=100, h=0 at >=400
  jitter: { good: 30, bad: 100 },   // ms jitter:     h=1 at <=30,  h=0 at >=100
};

// Piecewise-linear health for one metric; null (unknown metric) does not constrain the min.
function _health1(v, good, bad) {
  if (v == null || !Number.isFinite(+v)) return null;
  const x = +v;
  if (bad === good) return x <= good ? 1 : 0;
  const h = (bad - x) / (bad - good);
  return h < 0 ? 0 : h > 1 ? 1 : h;
}

// series: merged per-interval [{ lossPercent, latencyMs, jitter, goodput }, …] (present only).
// opts: { totalIntervals, missing:'down'|'unknown', thresholds }
function qualityAvailability(series, opts = {}) {
  const rows = Array.isArray(series) ? series : [];
  const present = rows.length;
  const th = {
    loss: { ...DEFAULT_QUALITY_THRESHOLDS.loss, ...((opts.thresholds || {}).loss) },
    latency: { ...DEFAULT_QUALITY_THRESHOLDS.latency, ...((opts.thresholds || {}).latency) },
    jitter: { ...DEFAULT_QUALITY_THRESHOLDS.jitter, ...((opts.thresholds || {}).jitter) },
  };
  const missing = opts.missing || 'down';
  const denom = missing === 'unknown' ? present : (opts.totalIntervals != null ? opts.totalIntervals : present);

  let sumH = 0, up = 0;
  const lossArr = [], latArr = [], jitArr = [];
  for (const s of rows) {
    const loss = s && s.lossPercent, lat = s && s.latencyMs, jit = s && s.jitter;
    if (loss != null && Number(loss) < 100) up++;                    // binary probe-responded
    const hs = [
      _health1(loss, th.loss.good, th.loss.bad),
      _health1(lat, th.latency.good, th.latency.bad),
      _health1(jit, th.jitter.good, th.jitter.bad),
    ].filter((h) => h != null);
    sumH += hs.length ? Math.min(...hs) : (loss != null && Number(loss) < 100 ? 1 : 0);
    if (loss != null) lossArr.push(+loss);
    if (lat != null) latArr.push(+lat);
    if (jit != null) jitArr.push(+jit);
  }

  const availability_pct = (present === 0 || denom <= 0) ? null : round2((100 * up) / denom);   // binary (loss<100)
  const effective_pct = (present === 0 || denom <= 0) ? null : round2((100 * sumH) / denom);    // quality-weighted
  return {
    availability_pct, effective_pct,
    up_intervals: up, total_intervals: denom, present,
    loss_pct_avg: _avg(lossArr), loss_pct_max: _max(lossArr),
    latency_ms_avg: _avg(latArr), latency_ms_max: _max(latArr),
    jitter_ms_avg: _avg(jitArr),
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

module.exports = { deriveAvailability, qualityAvailability, DEFAULT_QUALITY_THRESHOLDS, statusColor, round2, mergeDestinationSeries };
