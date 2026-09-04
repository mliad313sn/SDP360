'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Meraki "% Time Up" — supervised calibration (PURE, no I/O).
//
// Meraki's Summary-Report "% Time Up" is UI/CSV-only (confirmed: API spec v1.73 beta
// scanned, dashboard XHR/cometd sniffed — nothing to reuse). Live data (2026-09-04, 30
// points across 5 sites) also REFUTED two hypotheses: it is neither the loss<100 rule
// (Sabodala wan2: Meraki 22% vs ours 100%) nor the uplink active/failed status (our
// event-based figure: 100%). It behaves like a PER-SAMPLE rule (loss above a LOW
// threshold and/or latency above a cap = "down"), so we identify that rule the honest
// way: treat Meraki's number as ground truth and grid-search the rule family exposed by
// deriveAvailability (lossDownPct × latencyDownMs × missing policy × destination mode)
// for the combination that minimises the error over MANY (site × uplink × window) points.
//
// Inputs are plain objects so the operator harness (tools/meraki/calibrate-timeup.js)
// fetches/archives the series and this module never touches the network.
// ─────────────────────────────────────────────────────────────────────────────
const { deriveAvailability } = require('./merakiWanQuality');

// Rolling windows as the Meraki UI shows them ("past day / week / month" from the capture
// instant). Resolutions = the finest Meraki accepts for that span (60/600/3600 s).
const WINDOWS = {
  day:   { seconds: 86400,       resolution: 60 },
  week:  { seconds: 7 * 86400,   resolution: 600 },
  month: { seconds: 30 * 86400,  resolution: 3600 },
};
const WINDOW_ALIASES = { 'last day': 'day', 'past day': 'day', 'past week': 'week', 'past month': 'month', 'last month': 'month', 'last week': 'week' };

function normalizeWindow(label) {
  const k = String(label || '').trim().toLowerCase();
  return WINDOWS[k] ? k : (WINDOW_ALIASES[k] || null);
}

// t0/t1 (unix seconds) + resolution + expected interval count for a window label ending at
// `capturedAt` (Date | ISO | unix ms).
function windowFor(label, capturedAt) {
  const w = normalizeWindow(label);
  if (!w) throw new Error(`unknown window label "${label}"`);
  const t1Ms = capturedAt instanceof Date ? capturedAt.getTime() : (typeof capturedAt === 'number' ? capturedAt : Date.parse(capturedAt));
  if (!Number.isFinite(t1Ms)) throw new Error(`bad capturedAt "${capturedAt}"`);
  const { seconds, resolution } = WINDOWS[w];
  const t1 = Math.floor(t1Ms / 1000), t0 = t1 - seconds;
  return { window: w, t0, t1, resolution, totalIntervals: Math.max(1, Math.round(seconds / resolution)) };
}

// Meraki UI uplink labels → API uplink ids.
function normalizeUplink(label) {
  const s = String(label || '').trim().toLowerCase();
  if (/^wan\d$/.test(s)) return s;
  const m = s.match(/(?:internet|wan)\s*(\d)/);
  return m ? `wan${m[1]}` : null;
}

// Default rule family. lossCaps: a sample with loss >= cap is "down". latencyCaps: a sample
// with latency > cap is "down" (null = no latency rule). missing: how absent intervals count.
// dest: which series to score — the primary monitored destination alone, or all destinations
// merged (min loss per timestamp = "up if ANY destination answered").
const DEFAULT_GRID = {
  lossCaps: [1, 2, 3, 4, 5, 7.5, 10, 15, 20, 30, 50, 100],
  latencyCaps: [null, 100, 150, 200, 300, 500, 1000, 2000],
  missing: ['down', 'unknown'],
  dest: ['primary', 'merged'],
};

// points: [{ key, target, totalIntervals, series: { primary: [...], merged: [...] } }]
//   target = Meraki % Time Up for that (site, uplink, window); series entries are the
//   deriveAvailability sample shape [{ lossPercent, latencyMs, jitter }, …].
// Returns combos ranked by mean absolute error (ties → smaller max error), each with the
// per-point residuals, plus an identifiability note when several combos tie at the top.
function gridSearch(points, grid = DEFAULT_GRID) {
  const pts = (points || []).filter(p => p && Number.isFinite(Number(p.target)) && p.series);
  if (!pts.length) return { combos: [], best: null, note: 'no scorable points' };
  const combos = [];
  for (const dest of grid.dest) for (const missing of grid.missing) for (const lossCap of grid.lossCaps) for (const latCap of grid.latencyCaps) {
    const residuals = [];
    for (const p of pts) {
      const series = p.series[dest];
      if (!Array.isArray(series)) continue;
      const d = deriveAvailability(series, { totalIntervals: p.totalIntervals, missing, lossDownPct: lossCap, latencyDownMs: latCap });
      if (d.availability_pct == null) continue;
      residuals.push({ key: p.key, target: Number(p.target), derived: d.availability_pct, err: Math.round((d.availability_pct - Number(p.target)) * 100) / 100 });
    }
    if (!residuals.length) continue;
    const abs = residuals.map(r => Math.abs(r.err));
    combos.push({
      dest, missing, lossCap, latencyCap: latCap,
      n: residuals.length,
      mae: Math.round((abs.reduce((a, b) => a + b, 0) / abs.length) * 100) / 100,
      maxAbs: Math.round(Math.max(...abs) * 100) / 100,
      residuals,
    });
  }
  combos.sort((a, b) => a.mae - b.mae || a.maxAbs - b.maxAbs || b.n - a.n);
  const best = combos[0] || null;
  // Identifiability: combos within 0.1 pt MAE of the best are indistinguishable on this data.
  const ties = best ? combos.filter(c => c.mae - best.mae <= 0.1).length : 0;
  const note = !best ? 'no combo scored'
    : ties > 1 ? `${ties} combos tie within 0.1 pt MAE — add points with real degradation/outages to separate them`
    : 'unique best combo';
  return { combos, best, ties, note };
}

// Ground-truth CSV → rows. Tolerant to the operator's transcription headers
// (Site, Period, Label, % Time Up, Captured At …). Returns [{ site, uplink, window,
// capturedAt, target, loss, latency, jitter }], skipping rows it cannot read.
function parseGroundTruthCsv(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const split = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(s => s.trim()); };
  const head = split(lines[0]).map(h => h.toLowerCase());
  const col = (...names) => head.findIndex(h => names.some(n => h === n || h.startsWith(n)));
  const iSite = col('site'), iPeriod = col('period', 'window'), iLabel = col('label', 'uplink'), iUp = col('% time up', 'timeup', 'time up'),
    iCap = col('captured', 'capture'), iLoss = col('loss'), iLat = col('latency'), iJit = col('jitter');
  const rows = [];
  for (const l of lines.slice(1)) {
    const c = split(l);
    const window = normalizeWindow(c[iPeriod]);
    const uplink = normalizeUplink(c[iLabel]);
    const target = Number(c[iUp]);
    if (!c[iSite] || !window || !uplink || !Number.isFinite(target)) continue;
    rows.push({
      site: c[iSite], uplink, window, target,
      capturedAt: iCap >= 0 && c[iCap] ? c[iCap] : null,
      loss: iLoss >= 0 ? Number(c[iLoss]) : null,
      latency: iLat >= 0 ? Number(c[iLat]) : null,
      jitter: iJit >= 0 ? Number(c[iJit]) : null,
    });
  }
  return rows;
}

module.exports = { WINDOWS, DEFAULT_GRID, normalizeWindow, normalizeUplink, windowFor, gridSearch, parseGroundTruthCsv };
