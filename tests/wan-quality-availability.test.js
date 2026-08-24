'use strict';
// WAN quality via the ITU-T G.107 "E-model": loss/latency/jitter → R-factor (0-100, our
// "Qualité %") → MOS (1..4.5). Replaces the earlier ad-hoc min-model. Pure, no I/O.
// effective_pct = mean R-factor over the window; a fully-down or MISSING interval scores R 0.
const { test } = require('node:test');
const assert = require('node:assert');
const { qualityAvailability, rFactor, rToMos } = require('../services/merakiWanQuality');

const rep = (n, o) => Array.from({ length: n }, () => ({ ...o }));

// ── rFactor / rToMos unit calibration ────────────────────────────────────────
test('rFactor: near-perfect link (loss 0, lat 50, jit 5) → R ~91 (narrowband ceiling ~93)', () => {
  const R = rFactor(0, 50, 5);                 // effLat=50+10+10=70 → 93.2-70/40
  assert.ok(R > 91 && R < 92, `got ${R}`);
});

test('rToMos: R ~91 → MOS ~4.4 (G.711 best); R 0 → 1', () => {
  assert.ok(rToMos(91.45) > 4.3 && rToMos(91.45) <= 4.5, `got ${rToMos(91.45)}`);
  assert.equal(rToMos(0), 1);
});

test('THE Dakar case: loss 0, latency 149ms, JITTER 93ms → R ~70.7, MOS ~3.6 ("Correct")', () => {
  // effLat = 149 + 2·93 + 10 = 345 → R = 93.2 − (345−120)/10 = 70.7. The jitter, not loss,
  // drives the score — exactly the weakest-link intuition, now via the standard model.
  const R = rFactor(0, 149, 93);
  assert.ok(R > 70 && R < 71.5, `R got ${R}`);
  const mos = rToMos(R);
  assert.ok(mos > 3.5 && mos < 3.75, `MOS got ${mos}`);
});

test('rFactor: 10% packet loss costs ~25 R points (G.711 factor 2.5)', () => {
  const clean = rFactor(0, 50, 5);
  const lossy = rFactor(10, 50, 5);
  assert.ok(Math.abs((clean - lossy) - 25) < 0.01, `delta ${clean - lossy}`);
});

test('rFactor: advantage_factor lifts R (satellite tolerance)', () => {
  const wired = rFactor(0, 300, 20, { advantage_factor: 0 });
  const sat = rFactor(0, 300, 20, { advantage_factor: 15 });
  assert.ok(sat - wired > 14.9 && sat - wired < 15.1, `delta ${sat - wired}`);
});

// ── qualityAvailability (per-interval R → mean → MOS) ─────────────────────────
test('all-clean series → binary 100, effective ~91 (R ceiling), MOS ~4.4', () => {
  const r = qualityAvailability(rep(100, { lossPercent: 0, latencyMs: 50, jitter: 5 }), { totalIntervals: 100 });
  assert.equal(r.availability_pct, 100);
  assert.ok(r.effective_pct > 91 && r.effective_pct < 92, `eff ${r.effective_pct}`);
  assert.ok(r.mos > 4.3 && r.mos <= 4.5, `mos ${r.mos}`);
});

test('fully-down series (loss 100) → 0% both, MOS 1', () => {
  const r = qualityAvailability(rep(100, { lossPercent: 100, latencyMs: null, jitter: null }), { totalIntervals: 100 });
  assert.equal(r.availability_pct, 0);
  assert.equal(r.effective_pct, 0);
  assert.equal(r.mos, 1);
});

test('THE Sabodala case: bursty loss → binary blind (100), E-model captures it (MOS < 3)', () => {
  // 76 min @ 19.5% loss (R ≈ 91.45 − 48.75 = 42.7) + 24 min clean (R ≈ 91.45) → mean R ~54, MOS ~2.8.
  const series = [...rep(76, { lossPercent: 19.5, latencyMs: 50, jitter: 5 }), ...rep(24, { lossPercent: 0, latencyMs: 50, jitter: 5 })];
  const r = qualityAvailability(series, { totalIntervals: 100 });
  assert.equal(r.availability_pct, 100, 'binary % Time Up (loss<100) is blind to the bursts');
  assert.ok(r.effective_pct > 52 && r.effective_pct < 57, `effective R ~54, got ${r.effective_pct}`);
  assert.ok(r.mos < 3, `bursty-loss link → MOS below "Correct", got ${r.mos}`);
  assert.ok(r.loss_pct_avg > 14 && r.loss_pct_avg < 16, 'avg loss ~14.8% matches Meraki Loss Rate');
  assert.equal(r.loss_pct_max, 19.5);
});

test('bad latency alone (400ms) → R ~63, MOS ~3.3 (degraded, not zero)', () => {
  const r = qualityAvailability(rep(100, { lossPercent: 0, latencyMs: 400, jitter: 5 }), { totalIntervals: 100 });
  assert.equal(r.availability_pct, 100, 'loss<100 → binary up');
  assert.ok(r.effective_pct > 61 && r.effective_pct < 65, `eff ${r.effective_pct}`);
  assert.ok(r.mos > 3.1 && r.mos < 3.5, `mos ${r.mos}`);
});

test('missing intervals count as R 0: 50 clean of 100 expected → effective ~half the clean R', () => {
  const r = qualityAvailability(rep(50, { lossPercent: 0, latencyMs: 50, jitter: 5 }), { totalIntervals: 100 });
  assert.ok(r.effective_pct > 45 && r.effective_pct < 46, `eff ${r.effective_pct}`);   // ~91.45/2
  assert.equal(r.availability_pct, 50);
  assert.equal(r.present, 50);
  assert.equal(r.total_intervals, 100);
});

test("missing='unknown' excludes absent intervals from the denominator", () => {
  const r = qualityAvailability(rep(50, { lossPercent: 0, latencyMs: 50, jitter: 5 }), { totalIntervals: 100, missing: 'unknown' });
  assert.ok(r.effective_pct > 91 && r.effective_pct < 92, 'only present clean samples → full clean R');
});

test('no samples at all → null (no data, never a fabricated 0/100); mos null', () => {
  const r = qualityAvailability([], { totalIntervals: 100 });
  assert.equal(r.availability_pct, null);
  assert.equal(r.effective_pct, null);
  assert.equal(r.mos, null);
});

test('mos config is a knob: a harsher codec_loss_factor lowers the effective R', () => {
  const series = rep(100, { lossPercent: 5, latencyMs: 50, jitter: 5 });
  const g711 = qualityAvailability(series, { totalIntervals: 100 });                                // factor 2.5
  const g729 = qualityAvailability(series, { totalIntervals: 100, mos: { codec_loss_factor: 4 } });  // more loss-sensitive
  assert.ok(g729.effective_pct < g711.effective_pct, 'a bigger loss factor drops the effective R');
});
