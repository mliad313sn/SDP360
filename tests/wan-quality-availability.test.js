'use strict';
// Quality-weighted WAN availability (services/merakiWanQuality.qualityAvailability). Turns a
// fine-resolution loss/latency series into an EFFECTIVE availability that reflects degradation —
// unlike the binary "% Time Up" (loss<100) which reads a bursty-loss link as 100%. Pure, no I/O.
const { test } = require('node:test');
const assert = require('node:assert');
const { qualityAvailability } = require('../services/merakiWanQuality');

const rep = (n, o) => Array.from({ length: n }, () => ({ ...o }));

test('all-clean series → both binary and effective are 100%', () => {
  const r = qualityAvailability(rep(100, { lossPercent: 0, latencyMs: 50, jitter: 5 }), { totalIntervals: 100 });
  assert.equal(r.availability_pct, 100);
  assert.equal(r.effective_pct, 100);
});

test('fully-down series (loss 100) → 0% both', () => {
  const r = qualityAvailability(rep(100, { lossPercent: 100, latencyMs: null, jitter: null }), { totalIntervals: 100 });
  assert.equal(r.availability_pct, 0);
  assert.equal(r.effective_pct, 0);
});

test('THE Sabodala case: bursty loss → EFFECTIVE captures the degradation the binary misses', () => {
  // 76 min at 19.5% loss + 24 min clean → avg loss ~14.8% (matches Meraki), but binary loss<100
  // reads 100% up (never fully down), while the quality score reads ~26% ≈ Meraki's 24.43%.
  const series = [...rep(76, { lossPercent: 19.5, latencyMs: 50, jitter: 5 }), ...rep(24, { lossPercent: 0, latencyMs: 50, jitter: 5 })];
  const r = qualityAvailability(series, { totalIntervals: 100 });
  assert.equal(r.availability_pct, 100, 'binary % Time Up (loss<100) is blind to the bursts — the current bug');
  assert.ok(r.effective_pct > 24 && r.effective_pct < 28, `effective ~26% reflects the bursty degradation, got ${r.effective_pct}`);
  assert.ok(r.loss_pct_avg > 14 && r.loss_pct_avg < 16, 'avg loss ~14.8% matches Meraki Loss Rate');
  assert.equal(r.loss_pct_max, 19.5);
});

test('weakest-link: good loss but terrible latency → interval health governed by latency', () => {
  const r = qualityAvailability(rep(100, { lossPercent: 0, latencyMs: 400, jitter: 5 }), { totalIntervals: 100 });
  assert.equal(r.availability_pct, 100, 'loss<100 → binary up');
  assert.equal(r.effective_pct, 0, 'latency at the bad threshold → health 0 (weakest link)');
});

test('missing intervals count as down (health 0): 24 clean of 100 expected → 24% effective', () => {
  const r = qualityAvailability(rep(24, { lossPercent: 0, latencyMs: 50, jitter: 5 }), { totalIntervals: 100 });
  assert.equal(r.effective_pct, 24);
  assert.equal(r.availability_pct, 24);
  assert.equal(r.present, 24);
  assert.equal(r.total_intervals, 100);
});

test("missing='unknown' excludes absent intervals from the denominator", () => {
  const r = qualityAvailability(rep(24, { lossPercent: 0, latencyMs: 50, jitter: 5 }), { totalIntervals: 100, missing: 'unknown' });
  assert.equal(r.effective_pct, 100, 'only present samples counted → all clean → 100%');
});

test('no samples at all → null (no data, never a fabricated 0/100)', () => {
  const r = qualityAvailability([], { totalIntervals: 100 });
  assert.equal(r.availability_pct, null);
  assert.equal(r.effective_pct, null);
});

test('thresholds are configurable (calibration knob): a stricter loss.bad lowers the effective %', () => {
  const series = rep(100, { lossPercent: 5, latencyMs: 50, jitter: 5 });
  const lenient = qualityAvailability(series, { totalIntervals: 100 });                                   // bad=20 → h=(20-5)/19=0.79
  const strict = qualityAvailability(series, { totalIntervals: 100, thresholds: { loss: { good: 1, bad: 6 } } }); // bad=6 → h=(6-5)/5=0.20
  assert.ok(strict.effective_pct < lenient.effective_pct, 'tightening loss.bad drops the effective availability');
  assert.ok(strict.effective_pct > 18 && strict.effective_pct < 22, `~20% with bad=6, got ${strict.effective_pct}`);
});
