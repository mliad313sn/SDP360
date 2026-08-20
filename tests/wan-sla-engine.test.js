'use strict';

const assert = require('node:assert');
const { test } = require('node:test');
const {
  serviceSecondsBetween,
  clipToService,
  computeCircuitSla,
  resolutionBreaches,
} = require('../services/wanSla');
const { SILVER, SILVER_OFFICE, SILVER_MINE, AUG1, SEP1 } = require('./_wanSlaFixtures');

test('serviceSecondsBetween counts only in-window time (Mon–Fri 8h = 40h/week)', () => {
  const from = Date.parse('2026-08-10T00:00:00Z'); // Monday
  const to   = Date.parse('2026-08-17T00:00:00Z'); // next Monday
  assert.equal(serviceSecondsBetween(SILVER_OFFICE, from, to), 40 * 3600);
});
test('clipToService keeps only the in-window part of an outage', () => {
  // Fri 2026-08-14 16:30→18:00 → only 16:30–17:00 = 30 min
  const s = Date.parse('2026-08-14T16:30:00Z'), e = Date.parse('2026-08-14T18:00:00Z');
  assert.equal(clipToService(SILVER_OFFICE, [s, e]), 30 * 60);
});
test('clipToService splits across the lunch gap', () => {
  // Fri 12:30→14:30 → 12:30–13:00 (30m) + 14:00–14:30 (30m) = 60 min
  const s = Date.parse('2026-08-14T12:30:00Z'), e = Date.parse('2026-08-14T14:30:00Z');
  assert.equal(clipToService(SILVER_OFFICE, [s, e]), 60 * 60);
});
test('clipToService returns 0 for a fully out-of-hours outage (weekend, office)', () => {
  const s = Date.parse('2026-08-15T09:00:00Z'), e = Date.parse('2026-08-15T10:00:00Z'); // Saturday
  assert.equal(clipToService(SILVER_OFFICE, [s, e]), 0);
});
test('mine calendar (Mon–Sun) counts weekend service hours', () => {
  const s = Date.parse('2026-08-15T09:00:00Z'), e = Date.parse('2026-08-15T10:00:00Z'); // Saturday
  assert.equal(clipToService(SILVER_MINE, [s, e]), 3600);
});
test('clipToService spanning midnight into the next service day', () => {
  // Thu 16:30 → Fri 08:30 : Thu 16:30–17:00 (30m) + Fri 08:00–08:30 (30m) = 60 min
  const s = Date.parse('2026-08-13T16:30:00Z'), e = Date.parse('2026-08-14T08:30:00Z');
  assert.equal(clipToService(SILVER_OFFICE, [s, e]), 60 * 60);
});

// ── Task 2: core pure engine — computeCircuitSla + resolutionBreaches ──────────

const circ = { mrc_amount: 100000, currency: 'XOF' };
const base = {
  circuit: circ, tier: SILVER, maintenance: [], monthStart: AUG1, monthEnd: SEP1,
  clockStart: 'notification', triggerMinutes: 15, nowMs: SEP1,
};

test('one 3h in-hours ISP outage, notification clock → counted 2h45', () => {
  const o = { attribution: 'isp', detected_start: '2026-08-11T09:00:00Z',   // Tue
              restored_end: '2026-08-11T12:00:00Z', notified_at: '2026-08-11T09:15:00Z' };
  const r = computeCircuitSla({ ...base, outages: [o] });
  assert.equal(r.counted_downtime_s, 2 * 3600 + 45 * 60);        // 09:15→12:00 in-hours
  assert.equal(r.currency, 'XOF');
  // 2h45 of counted downtime out of ~168 service-hours is well within the SILVER
  // budget (5.04h/month) → availability ~98.4% → met, no credit.
  assert.ok(r.availability_pct != null && r.availability_pct > 97);
  assert.equal(r.met, true);
  assert.equal(r.credit_due, false);
  assert.equal(r.amount, Math.round(circ.mrc_amount * r.credit_pct / 100));  // 0
});
test('detection clock counts the full detected window', () => {
  const o = { attribution: 'isp', detected_start: '2026-08-11T09:00:00Z',
              restored_end: '2026-08-11T12:00:00Z', notified_at: '2026-08-11T09:15:00Z' };
  const r = computeCircuitSla({ ...base, clockStart: 'detection', outages: [o] });
  assert.equal(r.counted_downtime_s, 3 * 3600);              // full 09:00→12:00
});
test("attribution 'site' is excluded", () => {
  const o = { attribution: 'site', detected_start: '2026-08-11T09:00:00Z', restored_end: '2026-08-11T15:00:00Z', notified_at: null };
  const r = computeCircuitSla({ ...base, outages: [o] });
  assert.equal(r.counted_downtime_s, 0);
  assert.equal(r.met, true);
});
test('sub-15-min outage does not count (min_outage floor)', () => {
  const o = { attribution: 'isp', detected_start: '2026-08-11T09:00:00Z', restored_end: '2026-08-11T09:10:00Z', notified_at: null };
  const r = computeCircuitSla({ ...base, outages: [o] });
  assert.equal(r.counted_downtime_s, 0);
});
test('outage spanning the month boundary counts only the in-month part', () => {
  // starts Jul 31, restores Aug 1 08:30 → only Aug 1 08:00–08:30 in-window & in-month
  const o = { attribution: 'isp', detected_start: '2026-07-31T09:00:00Z', restored_end: '2026-08-01T08:30:00Z', notified_at: '2026-07-31T09:15:00Z' };
  const r = computeCircuitSla({ ...base, outages: [o] });
  // Aug 1 2026 is a Saturday → office closed → 0 in-window in August for this outage
  assert.equal(r.counted_downtime_s, 0);
});
test('credit band boundary is inclusive (>=): availability exactly 95.0% → 10% band', () => {
  const svc = computeCircuitSla({ ...base, outages: [] }).service_seconds;
  assert.equal(svc, 604800);   // 21 weekdays × 8h (office, Aug 2026)
  // 5% of service = 30240s = a full Monday (28800s) + 24 min into Tuesday morning.
  const o = { attribution: 'isp', detected_start: '2026-08-10T08:00:00Z',  // Mon
              restored_end: '2026-08-11T08:24:00Z', notified_at: null };
  const r = computeCircuitSla({ ...base, clockStart: 'detection', outages: [o] });
  assert.equal(r.counted_downtime_s, 30240);
  assert.equal(r.availability_pct, 95);
  assert.equal(r.credit_pct, 10);
  assert.equal(r.credit_due, true);
});
test('credit band boundary is inclusive (>=): availability exactly 97.0% → met, 0% band', () => {
  // 3% of service = 18144s = 5h morning (18000s) + 2m24s into the afternoon window.
  const o = { attribution: 'isp', detected_start: '2026-08-10T08:00:00Z',  // Mon
              restored_end: '2026-08-10T14:02:24Z', notified_at: null };
  const r = computeCircuitSla({ ...base, clockStart: 'detection', outages: [o] });
  assert.equal(r.counted_downtime_s, 18144);
  assert.equal(r.availability_pct, 97);
  assert.equal(r.met, true);
  assert.equal(r.credit_pct, 0);
  assert.equal(r.credit_due, false);
});
test('MRC 0 → amount null, tier still shown', () => {
  const o = { attribution: 'isp', detected_start: '2026-08-11T09:00:00Z', restored_end: '2026-08-11T16:00:00Z', notified_at: '2026-08-11T09:15:00Z' };
  const r = computeCircuitSla({ ...base, circuit: { mrc_amount: 0, currency: 'XOF' }, outages: [o] });
  assert.equal(r.amount, null);
  assert.ok(r.credit_pct >= 0);
});
test('service_seconds 0 → availability null (never 0)', () => {
  const emptyCal = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
  const r = computeCircuitSla({ ...base, tier: { ...SILVER, hours_default: emptyCal }, outages: [] });
  assert.equal(r.availability_pct, null);
});
test('current-month provisional uses elapsed service seconds (no elapsed-fraction artifact)', () => {
  // nowMs mid-month, no outages → availability 100 (NOT ~50)
  const midAug = Date.parse('2026-08-17T00:00:00Z');
  const r = computeCircuitSla({ ...base, nowMs: midAug, outages: [] });
  assert.equal(r.availability_pct, 100);
});
test('resolutionBreaches: >12h total-interruption breaches crit1, <12h does not', () => {
  const o13 = { attribution: 'isp', detected_start: '2026-08-11T00:00:00Z', restored_end: '2026-08-11T13:00:00Z' };
  const o11 = { attribution: 'isp', detected_start: '2026-08-12T00:00:00Z', restored_end: '2026-08-12T11:00:00Z' };
  assert.equal(resolutionBreaches([o13, o11], SILVER), 1);
});

// Per-circuit overrides (parametrable per site AND per ISP): a circuit may override the
// tier's availability target / credit cap / model / min-outage, so two ISPs on the same
// tier can carry different contractual realities. Circuit wins, tier is the default.
test('per-circuit overrides win over the tier (target %, credit cap)', () => {
  const o = { attribution: 'isp', detected_start: '2026-08-05T09:00:00Z', restored_end: '2026-08-05T12:00:00Z' }; // 3h, Wed, office hours
  const common = { outages: [o], tier: SILVER, maintenance: [], monthStart: AUG1, monthEnd: SEP1, clockStart: 'detection', nowMs: Date.parse('2026-09-15T00:00:00Z') };
  // Circuit A — stricter ISP contract: target 99.9 %, credit capped at 20 %.
  const rA = computeCircuitSla({ ...common, circuit: { hours: SILVER_OFFICE, availability_target_pct: 99.9, credit_cap_pct: 20, mrc_amount: 1000 } });
  assert.equal(rA.met, rA.availability_pct >= 99.9, 'met is measured against the CIRCUIT target (99.9), not the tier (97)');
  assert.equal(rA.gap_pp, Math.round((99.9 - rA.availability_pct) * 100) / 100, 'gap_pp uses the circuit target');
  assert.ok(rA.credit_pct <= 20, 'credit capped at the per-circuit cap (20), not the tier cap (100)');
  // Circuit B — no override → tier default (97) → the SAME outage now MEETS.
  const rB = computeCircuitSla({ ...common, circuit: { hours: SILVER_OFFICE, mrc_amount: 1000 } });
  assert.equal(rB.availability_pct, rA.availability_pct, 'same outage → same availability');
  assert.equal(rB.met, rB.availability_pct >= 97, 'without override, the tier target (97) applies');
  assert.notEqual(rA.met, rB.met, 'the per-circuit target changes the verdict for the same outage');
});
