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
function deriveAvailability(series, { totalIntervals, missing = 'down', lossDownPct = 100, latencyDownMs = null } = {}) {
  const rows = Array.isArray(series) ? series : [];
  const present = rows.length;
  // An interval is "up" iff loss is BELOW the down-threshold AND (if a latency timeout is set)
  // latency is within it. Default lossDownPct=100 / no latency cap = the plain loss<100 rule.
  // Meraki's own "% Time Up" counts high-loss/timeout samples as down (MANA wan1: 4.48% avg loss
  // but 84% up), so a lower lossDownPct (~15-25%) + a latency cap approximates the Summary Report.
  const lossCap = Number(lossDownPct);
  const latCap = (latencyDownMs == null || latencyDownMs === '' ) ? null : Number(latencyDownMs);
  const up = rows.filter((s) => {
    if (!s || s.lossPercent == null) return false;
    if (Number(s.lossPercent) >= lossCap) return false;
    if (latCap != null && Number.isFinite(latCap) && s.latencyMs != null && Number(s.latencyMs) > latCap) return false;
    return true;
  }).length;

  // Zero samples at all = no data (collection/API gap), NOT a measured total outage —
  // absence is `null` → status `none`, never a fabricated 0% (spec §7). The `missing`
  // policy only governs absent intervals WITHIN a window that has ≥1 real sample.
  // The denominator can never be SMALLER than the samples actually observed: Meraki
  // sometimes returns more points than the window÷resolution estimate (fence-post /
  // boundary samples — a 31-day month at 1h resolution estimates 744 but delivers
  // ~753), which used to print impossible availabilities (101.2%). If we observed N
  // samples, the window truly contained ≥N intervals — the estimate was low.
  const base = missing === 'unknown' ? present : (totalIntervals != null ? totalIntervals : present);
  const denom = Math.max(base, present);
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

// ── ITU-T G.107 "E-model" quality (R-factor → MOS) ───────────────────────────
// The recognised industry model for turning loss/latency/jitter into a call-quality score
// (used by Cisco IP SLA, ntopng, etc). Per interval: effective latency = latency + 2·jitter +
// base_delay (dejitter-buffer approximation); R = r0 − delay_impairment − codec_loss_factor·loss
// + advantage_factor, clamped 0..100. R (0-100) IS the quality index (our "Qualité %"), and
// R→MOS gives the familiar 1..4.5 score. Defaults are G.711 wired (advantage_factor 0),
// overridable via wan_mos_config. NOT the same as Meraki's proprietary "% Time Up".
const DEFAULT_MOS_CONFIG = {
  r0: 93.2,                 // narrowband baseline R (G.711 best ≈ MOS 4.4)
  codec_loss_factor: 2.5,   // R points lost per 1% packet loss (G.711 ≈ 2.5)
  jitter_buffer_factor: 2,  // jitter × this ≈ added dejitter-buffer delay
  base_delay_ms: 10,        // fixed codec/packetisation delay
  advantage_factor: 0,      // A: 0 wired; 10-20 for satellite/VSAT user tolerance
};

// R-factor (0..100) for ONE interval. Missing delay metrics add no delay penalty (loss and
// latency/jitter arrive together in practice). loss null → treated 0 (caller decides "down").
function rFactor(lossPercent, latencyMs, jitterMs, cfg = {}) {
  const c = { ...DEFAULT_MOS_CONFIG, ...(cfg || {}) };
  const lat = (latencyMs == null || !Number.isFinite(+latencyMs)) ? 0 : +latencyMs;
  const jit = (jitterMs == null || !Number.isFinite(+jitterMs)) ? 0 : +jitterMs;
  const loss = (lossPercent == null || !Number.isFinite(+lossPercent)) ? 0 : +lossPercent;
  const effLat = lat + c.jitter_buffer_factor * jit + c.base_delay_ms;
  let R = (effLat < 160) ? c.r0 - effLat / 40 : c.r0 - (effLat - 120) / 10;
  R = R - c.codec_loss_factor * loss + c.advantage_factor;
  return R < 0 ? 0 : R > 100 ? 100 : R;
}

// R-factor (0..100) → MOS (1..4.5), the ITU-T G.107 mapping.
function rToMos(R) {
  if (R == null || !Number.isFinite(+R)) return null;
  const r = +R;
  if (r < 0) return 1;
  if (r > 100) return 4.5;
  return round2(1 + 0.035 * r + 7e-6 * r * (r - 60) * (100 - r));
}

// series: merged per-interval [{ lossPercent, latencyMs, jitter, goodput }, …] (present only).
// opts: { totalIntervals, missing:'down'|'unknown', mos } — mos overrides DEFAULT_MOS_CONFIG.
// effective_pct = mean R-factor over the window (a responding-but-degraded interval scores its
// R; a fully-down or MISSING interval scores 0), and mos = R→MOS of that mean.
function qualityAvailability(series, opts = {}) {
  const rows = Array.isArray(series) ? series : [];
  const present = rows.length;
  const mosCfg = { ...DEFAULT_MOS_CONFIG, ...(opts.mos || {}) };
  const missing = opts.missing || 'down';
  const denom = missing === 'unknown' ? present : (opts.totalIntervals != null ? opts.totalIntervals : present);

  let sumR = 0, up = 0;
  const lossArr = [], latArr = [], jitArr = [];
  for (const s of rows) {
    const loss = s && s.lossPercent, lat = s && s.latencyMs, jit = s && s.jitter;
    const responded = loss != null && Number(loss) < 100;
    if (responded) up++;                                             // binary probe-responded
    sumR += responded ? rFactor(loss, lat, jit, mosCfg) : 0;        // down/absent interval → R 0
    if (loss != null) lossArr.push(+loss);
    if (lat != null) latArr.push(+lat);
    if (jit != null) jitArr.push(+jit);
  }

  const availability_pct = (present === 0 || denom <= 0) ? null : round2((100 * up) / denom);   // binary (loss<100)
  const effective_pct = (present === 0 || denom <= 0) ? null : round2(sumR / denom);            // mean R-factor (0-100)
  const mos = rToMos(effective_pct);                                                             // ITU-T MOS 1..4.5
  return {
    availability_pct, effective_pct, mos,
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
// % Time Up would under-report vs Meraki's own number.
//   lossPercent = MIN across destinations (best-of → drives up/down, robust).
//   latency/jitter/goodput = from the BEST PATH = the responding destination with the LOWEST
//     latency this interval. Meraki's Summary Report reports ONE reference destination; the far
//     AWS/internal targets a MX also pings (91/145ms, or 100%-loss dead IPs) would otherwise
//     inflate an AVERAGE (Ouaga proof: 8.8.8.8 32ms averaged with 91/145ms → 89ms vs Meraki 32).
//     Taking the nearest responding destination reads latency AND jitter as a matched pair.
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
      if (!b) { b = { startTime: ts, endTime: s.endTs || s.endTime || null, samples: [] }; byTs.set(ts, b); }
      b.samples.push({
        loss: (s.lossPercent != null && Number.isFinite(+s.lossPercent)) ? +s.lossPercent : null,
        lat: (s.latencyMs != null && Number.isFinite(+s.latencyMs)) ? +s.latencyMs : null,
        jit: (s.jitter != null && Number.isFinite(+s.jitter)) ? +s.jitter : null,
        good: (s.goodput != null && Number.isFinite(+s.goodput)) ? +s.goodput : null,
      });
    }
  }
  const out = [];
  for (const b of byTs.values()) {
    const losses = b.samples.map((x) => x.loss).filter((v) => v != null);
    // best path = responding destination with the lowest latency (dead 100%-loss targets carry
    // null latency and are naturally excluded); its latency/jitter/goodput move together.
    let best = null;
    for (const x of b.samples) { if (x.lat == null) continue; if (best == null || x.lat < best.lat) best = x; }
    out.push({
      startTime: b.startTime, endTime: b.endTime,
      lossPercent: losses.length ? Math.min(...losses) : null,   // best-of → up if any dest up
      latencyMs: best ? round2(best.lat) : null,
      jitter: best && best.jit != null ? round2(best.jit) : null,
      goodput: best && best.good != null ? round2(best.good) : null,
    });
  }
  out.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  return out;
}

// Resolution floor of a sample-counted availability: with N samples, ONE down sample is
// worth 100/N pts, so "no down sample seen" only proves availability >= 100 - 100/N. Used
// by the UI to print "≥ 99.9 %" instead of a "100 %" we cannot actually measure (Meraki's
// own probe-level figure on the same clean links reads 99.85-99.99). Floored to 0.1 pt;
// null when the sample count is unknown or non-positive.
function availabilityFloorPct(samples) {
  const n = Number(samples);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor((100 - 100 / n) * 10) / 10;
}

module.exports = { deriveAvailability, qualityAvailability, rFactor, rToMos, DEFAULT_MOS_CONFIG, statusColor, round2, mergeDestinationSeries, availabilityFloorPct };
