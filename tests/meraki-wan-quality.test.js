'use strict';
// V1b-A Task 3 — pure WAN quality derive (% Time Up + averages + status band).
// deriveAvailability turns Meraki loss/latency samples into a period availability%;
// the `missing`-interval policy ('down'|'unknown') is chosen by CALIBRATION (§7) —
// both are supported here. statusColor uses the REPORT band (not V1a's ±2 band).
const { test } = require('node:test');
const assert = require('node:assert');
const { deriveAvailability, statusColor, round2 } = require('../services/merakiWanQuality');

const S = (loss) => ({ startTime: '2026-08-09T00:00:00Z', endTime: '2026-08-09T01:00:00Z',
  lossPercent: loss, latencyMs: 20, jitter: 2, goodput: 1000 });

test('all up → 100', () => {
  const r = deriveAvailability([S(0), S(1.5), S(0)], { totalIntervals: 3, missing: 'down' });
  assert.equal(r.availability_pct, 100);
});

test('one loss=100 interval of 3 → 66.67 (down)', () => {
  const r = deriveAvailability([S(0), S(100), S(0)], { totalIntervals: 3, missing: 'down' });
  assert.equal(r.availability_pct, 66.67);
});

test("missing:'down' counts absent intervals as down (1 present of 4 → 25)", () => {
  const r = deriveAvailability([S(0)], { totalIntervals: 4, missing: 'down' });
  assert.equal(r.availability_pct, 25);
});

test("missing:'unknown' excludes absent intervals from the denominator (1 up / 2 present of 10 → 50)", () => {
  const r = deriveAvailability([S(0), S(100)], { totalIntervals: 10, missing: 'unknown' });
  assert.equal(r.availability_pct, 50);
});

test('empty → null (never 0)', () => {
  assert.strictEqual(deriveAvailability([], { totalIntervals: 5, missing: 'unknown' }).availability_pct, null);
  assert.strictEqual(deriveAvailability([], { totalIntervals: 5, missing: 'down' }).availability_pct, null);
});

const L = (loss, lat) => ({ startTime: 'x', endTime: 'y', lossPercent: loss, latencyMs: lat, jitter: 2, goodput: 1000 });

test('lossDownPct: loss >= threshold counts down (28% loss, threshold 20 → down); default 100 keeps it up', () => {
  assert.equal(deriveAvailability([S(0), S(28), S(0)], { totalIntervals: 3, missing: 'down', lossDownPct: 20 }).availability_pct, 66.67);
  assert.equal(deriveAvailability([S(0), S(28), S(0)], { totalIntervals: 3, missing: 'down' }).availability_pct, 100);
});

test('latencyDownMs: latency over the timeout counts down (2000ms, cap 1000 → down); no cap keeps it up', () => {
  assert.equal(deriveAvailability([L(0, 20), L(0, 2000), L(0, 20)], { totalIntervals: 3, missing: 'down', latencyDownMs: 1000 }).availability_pct, 66.67);
  assert.equal(deriveAvailability([L(0, 20), L(0, 2000), L(0, 20)], { totalIntervals: 3, missing: 'down' }).availability_pct, 100);
});

test('averages are over PRESENT samples; null when none', () => {
  const r = deriveAvailability([S(0), S(2)], { totalIntervals: 2, missing: 'down' });
  assert.equal(r.latency_ms_avg, 20);
  assert.equal(r.jitter_ms_avg, 2);
  assert.equal(r.goodput_avg, 1000);
  assert.equal(r.loss_pct_avg, 1);
  const empty = deriveAvailability([], { totalIntervals: 3, missing: 'down' });
  assert.strictEqual(empty.latency_ms_avg, null);
  assert.strictEqual(empty.loss_pct_avg, null);
});

test('null lossPercent sample is treated as down (not up)', () => {
  const r = deriveAvailability([S(0), { lossPercent: null, latencyMs: null }], { totalIntervals: 2, missing: 'down' });
  assert.equal(r.availability_pct, 50);          // only the loss=0 sample is up
});

test('statusColor uses the report band (>=t green, >=t*0.9 orange, else red, null none)', () => {
  assert.equal(statusColor(99, 98), 'green');
  assert.equal(statusColor(98, 98), 'green');
  assert.equal(statusColor(90, 98), 'orange');   // 90 >= 88.2
  assert.equal(statusColor(88, 98), 'red');      // 88 < 88.2
  assert.equal(statusColor(80, 98), 'red');
  assert.equal(statusColor(null, 98), 'none');
});

test('round2 rounds to 2 dp', () => {
  assert.equal(round2(66.666666), 66.67);
  assert.equal(round2(100), 100);
});

// ── multi-destination merge (connectivityMonitoringDestinations) ──────────────
const { mergeDestinationSeries } = require('../services/merakiWanQuality');
// Real getDeviceLossAndLatencyHistory field names: startTs/endTs (NOT startTime).
const T = (ts, loss, lat) => ({ startTs: ts, endTs: ts, lossPercent: loss, latencyMs: lat, jitter: 2, goodput: 1000 });

test('mergeDestinationSeries: interval is up if ANY destination responded (min loss)', () => {
  // dest A: up then down ; dest B: down then up  → both intervals up
  const merged = mergeDestinationSeries([
    [T('t1', 0, 20), T('t2', 100, null)],
    [T('t1', 100, null), T('t2', 5, 30)],
  ]);
  const byTs = Object.fromEntries(merged.map(m => [m.startTime, m]));
  assert.equal(byTs.t1.lossPercent, 0);      // best of {0,100}
  assert.equal(byTs.t2.lossPercent, 5);      // best of {100,5}
  const r = deriveAvailability(merged, { totalIntervals: 2, missing: 'down' });
  assert.equal(r.availability_pct, 100);     // up on both intervals via the good destination
});

test('mergeDestinationSeries: interval down only if ALL destinations down', () => {
  const merged = mergeDestinationSeries([
    [T('t1', 100, null), T('t2', 0, 20)],
    [T('t1', 100, null), T('t2', 0, 20)],
  ]);
  const r = deriveAvailability(merged, { totalIntervals: 2, missing: 'down' });
  assert.equal(r.availability_pct, 50);      // t1 down (both dests down), t2 up
});

test('mergeDestinationSeries: single destination is a no-op passthrough', () => {
  const merged = mergeDestinationSeries([[T('t1', 0, 20), T('t2', 2, 25)]]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].lossPercent, 0);
  assert.equal(merged[1].latencyMs, 25);
});

test('mergeDestinationSeries: latency/jitter from the BEST (lowest-latency) destination; sorted', () => {
  // Meraki's Summary Report reports ONE reference destination; averaging the far AWS/internal
  // targets a MX also pings inflated our latency (Ouaga: 8.8.8.8 32ms averaged with 91/145ms → 89ms).
  const merged = mergeDestinationSeries([
    [T('t2', 0, 40)],
    [T('t1', 0, 10), T('t2', 0, 20)],
  ]);
  assert.deepEqual(merged.map(m => m.startTime), ['t1', 't2']);   // sorted
  assert.equal(merged[1].latencyMs, 20);   // best path = min(40,20)
});

test('mergeDestinationSeries: empty → []', () => {
  assert.deepEqual(mergeDestinationSeries([]), []);
  assert.deepEqual(mergeDestinationSeries([[], []]), []);
});

test('mergeDestinationSeries: best-path takes latency AND jitter from the SAME (nearest) destination; loss best-of', () => {
  // The Ouaga case: a near public destination (32ms, jitter 2) + two far AWS ones (91/145ms,
  // higher jitter) + dead internal targets (100% loss, no latency). Merged must read the near
  // destination's latency+jitter as a pair, and loss = best-of (min).
  const S = (ts, loss, lat, jit) => ({ startTs: ts, endTs: ts, lossPercent: loss, latencyMs: lat, jitter: jit, goodput: 1000 });
  const near = [S('t1', 0.09, 32, 1.9)];
  const far1 = [S('t1', 0.21, 91, 5.0)];
  const far2 = [S('t1', 0.59, 145, 8.0)];
  const dead = [S('t1', 100, null, null)];
  const merged = mergeDestinationSeries([near, far1, far2, dead]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].latencyMs, 32, 'nearest destination latency, not the ~89ms average');
  assert.equal(merged[0].jitter, 1.9, 'jitter from that same nearest destination, not averaged');
  assert.equal(merged[0].lossPercent, 0.09, 'best-of loss (min across all)');
});

test('mergeDestinationSeries: keys on the REAL startTs field (prod bug 2026-08-16)', () => {
  // A raw Meraki sample uses startTs/endTs; keying on startTime dropped every one →
  // empty merge → null metrics. Must merge to a non-empty series carrying the values.
  const raw = [{ startTs: '2026-08-09T21:00:00Z', endTs: '2026-08-09T22:00:00Z', lossPercent: 0, latencyMs: 2.05, jitter: 0.99, goodput: 100000 }];
  const merged = mergeDestinationSeries([raw]);
  assert.equal(merged.length, 1, 'startTs sample is NOT dropped');
  assert.equal(merged[0].lossPercent, 0);
  assert.equal(merged[0].latencyMs, 2.05);
  assert.equal(merged[0].jitter, 0.99);
});
