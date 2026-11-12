'use strict';
// P8 / goal B1 — SLA credit claims, PURE rules (services/wanSlaClaims.js): the credit matches the contract terms on
// fixtures (inclusive tier boundary, service-hours clipping, attribution), the lifecycle and its illegal moves, the
// evidence breakdown reconciles with the engine, money masking, value totals per currency, the notification gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../services/wanSlaClaims');
const { computeCircuitSla } = require('../services/wanSla');
const { SILVER, AUG1, SEP1 } = require('./_wanSlaFixtures');

const NOW = Date.parse('2026-10-01T00:00:00Z');
const circuit = { site_id: 5, sub_site: '', uplink: 'wan1', isp: 'TestISP', circuit_id: 'C-1', mrc_amount: 100000, currency: 'XOF', tier: SILVER };
const isp = (s, e, extra = {}) => ({ site_id: 5, sub_site: '', uplink: 'wan1', detected_start: s, restored_end: e, notified_at: null, attribution: 'isp', ...extra });
// August 2026 = 21 weekdays × 8 service hours = 604 800 s; 95.00 % ⇔ 30 240 s counted (8 h 24 min).
const AT_95 = [isp('2026-08-03T08:00:00Z', '2026-08-03T17:00:00Z'), isp('2026-08-04T08:00:00Z', '2026-08-04T08:24:00Z')];
const sla = (outages, extra = {}) => computeCircuitSla({ outages, circuit, tier: SILVER, monthStart: AUG1, monthEnd: SEP1, clockStart: 'detection', nowMs: NOW, ...extra });

test('credit matches the contract: tier boundary is inclusive (95.00 % → 10 %), one second less → 25 %', () => {
  const a = sla(AT_95);
  assert.equal(a.service_seconds, 604800);
  assert.equal(a.counted_downtime_s, 30240, '9 h on Mon minus the lunch hour = 8 h, + 24 min on Tue');
  assert.equal(a.availability_pct, 95);
  assert.equal(a.credit_pct, 10);
  assert.equal(a.amount, 10000, '10 % of the 100 000 XOF monthly charge');
  const b = sla([AT_95[0], isp('2026-08-04T08:00:00Z', '2026-08-04T08:30:00Z')]);
  assert.ok(b.availability_pct < 95);
  assert.equal(b.credit_pct, 25);
  assert.equal(b.amount, 25000);
});

test('service-hours clipping: a night / weekend outage counts 0, and non-ISP attribution never counts', () => {
  const night = sla([isp('2026-08-03T18:00:00Z', '2026-08-04T07:00:00Z'), isp('2026-08-08T08:00:00Z', '2026-08-08T17:00:00Z')]);
  assert.equal(night.counted_downtime_s, 0);
  assert.equal(night.credit_pct, 0);
  const site = sla(AT_95.map((o) => ({ ...o, attribution: 'site' })));
  const maint = sla(AT_95.map((o) => ({ ...o, attribution: 'maintenance' })));
  assert.equal(site.counted_downtime_s, 0); assert.equal(maint.counted_downtime_s, 0);
});

test('evidence breakdown: per-outage counted seconds add up EXACTLY to the engine figure, with the reason when 0', () => {
  const outs = [...AT_95, isp('2026-08-08T08:00:00Z', '2026-08-08T10:00:00Z'), isp('2026-08-10T09:00:00Z', '2026-08-10T09:05:00Z'),
    { ...isp('2026-08-11T08:00:00Z', '2026-08-11T12:00:00Z'), attribution: 'site' }];
  for (const clockStart of ['detection', 'notification']) {
    const e = sla(outs, { clockStart, triggerMinutes: 15 });
    const rows = W.outageBreakdown(outs, circuit, { monthStart: AUG1, monthEnd: SEP1, nowMs: NOW, clockStart, triggerMinutes: 15 });
    assert.equal(rows.reduce((s, r) => s + r.counted_s, 0), e.counted_downtime_s, clockStart);
  }
  const rows = W.outageBreakdown(outs, circuit, { monthStart: AUG1, monthEnd: SEP1, nowMs: NOW, clockStart: 'detection' });
  assert.match(rows[2].why, /service hours/);
  assert.match(rows[3].why, /15-minute floor/);
  assert.match(rows[4].why, /attribution site/);
});

test('lifecycle: legal moves, motive on every change, credited needs the credited amount', () => {
  const now = { nowIso: '2026-10-02T10:00:00Z' };
  const due = { status: 'due', currency: 'XOF', due_amount: 10000 };
  assert.throws(() => W.planTransition(due, { to: 'claimed', motive: '' }, now), (e) => e.reason === 'MOTIVE_REQUIRED');
  const p = W.planTransition(due, { to: 'claimed', motive: 'sent to ISP' }, now);
  assert.equal(p.patch.claimed_amount, 10000, 'nothing typed → the frozen due amount is claimed');
  assert.equal(p.patch.claimed_at, now.nowIso);
  const claimed = { status: 'claimed', currency: 'XOF', due_amount: 10000, claimed_amount: 10000 };
  assert.throws(() => W.planTransition(claimed, { to: 'credited', motive: 'invoice' }, now), (e) => e.reason === 'CREDITED_AMOUNT_REQUIRED');
  assert.equal(W.planTransition(claimed, { to: 'credited', motive: 'invoice 42', credited_amount: '8000' }, now).patch.credited_amount, 8000);
  assert.equal(W.planTransition(claimed, { to: 'disputed', motive: 'ISP refuses' }, now).patch.status, 'disputed');
  assert.equal(W.planTransition({ status: 'disputed', currency: 'XOF' }, { to: 'claimed', motive: 're-sent' }, now).patch.status, 'claimed');
  assert.equal(W.planTransition(due, { to: 'written_off', motive: 'below threshold' }, now).patch.written_off_at, now.nowIso);
});

test('lifecycle: illegal moves and terminal states are refused; only an explicit reopen leaves them', () => {
  const now = { nowIso: '2026-10-02T10:00:00Z' };
  assert.throws(() => W.planTransition({ status: 'due' }, { to: 'credited', motive: 'skip' }, now), (e) => e.code === 'CONFLICT' && e.reason === 'ILLEGAL_TRANSITION');
  assert.throws(() => W.planTransition({ status: 'due' }, { to: 'disputed', motive: 'skip' }, now), (e) => e.code === 'CONFLICT');
  assert.throws(() => W.planTransition({ status: 'credited' }, { to: 'claimed', motive: 'again' }, now), (e) => e.reason === 'TERMINAL');
  assert.throws(() => W.planTransition({ status: 'written_off' }, { to: 'claimed', motive: 'again' }, now), (e) => e.reason === 'TERMINAL');
  assert.throws(() => W.planTransition({ status: 'credited' }, { to: 'due', motive: 'x y z', reopen: true }, now), (e) => e.reason === 'ILLEGAL_TRANSITION');
  assert.equal(W.planTransition({ status: 'credited' }, { to: 'disputed', motive: 'credit reversed', reopen: true }, now).action, 'reopen');
  assert.throws(() => W.planTransition({ status: 'due' }, { to: 'nope', motive: 'abc' }, now), (e) => e.code === 'INVALID');
  assert.throws(() => W.planTransition({ status: 'due', currency: null, due_amount: null }, { to: 'claimed', motive: 'abc', claimed_amount: 5 }, now), (e) => e.reason === 'CURRENCY_REQUIRED');
  assert.throws(() => W.planTransition({ status: 'claimed', currency: 'XOF' }, { to: 'credited', motive: 'abc', credited_amount: -1 }, now), (e) => e.reason === 'BAD_AMOUNT');
});

test('evidence hash: stable for the same outages, changes when an outage or the contract changes', () => {
  const params = W.contractParams(circuit, { clockStart: 'notification', triggerMinutes: 15, tierName: 'SILVER' });
  const h = W.evidenceHash(AT_95, params);
  assert.equal(W.evidenceHash([...AT_95].reverse(), params), h, 'order-independent');
  assert.notEqual(W.evidenceHash([AT_95[0], { ...AT_95[1], restored_end: '2026-08-04T08:30:00Z' }], params), h);
  assert.notEqual(W.evidenceHash(AT_95, { ...params, mrc_amount: 1 }), h);
});

test('masking: no amount for a reader without the money right (invariant 2)', () => {
  const c = { id: 1, status: 'claimed', currency: 'XOF', due_amount: 10000, claimed_amount: 9000, credited_amount: null, calc: { amount: 10000, params: { mrc_amount: 100000 } } };
  const m = W.maskClaim(c, false);
  assert.equal(m.money_hidden, true);
  assert.equal(m.due_amount, null); assert.equal(m.claimed_amount, null); assert.equal(m.calc.amount, null); assert.equal(m.calc.params.mrc_amount, null);
  assert.equal(W.maskClaim(c, true).due_amount, 10000);
  assert.equal(c.due_amount, 10000, 'the source object is untouched');
});

test('value totals: per quarter and per currency (never added together); USD only when every amount has a rate; unknown counted', () => {
  const claims = [
    { period: '2026-07', status: 'credited', currency: 'XOF', due_amount: 10000, claimed_amount: 10000, credited_amount: 8000, claimed_at: 'x', created_at: '2026-08-01T00:00:00Z' },
    { period: '2026-08', status: 'claimed', currency: 'XOF', due_amount: 20000, claimed_amount: 20000, claimed_at: 'x', created_at: '2026-09-01T00:00:00Z' },
    { period: '2026-08', status: 'due', currency: 'EUR', due_amount: 100, created_at: '2026-09-21T00:00:00Z' },
    { period: '2026-09', status: 'due', currency: null, due_amount: null, created_at: '2026-09-25T00:00:00Z' },
  ];
  const v = W.valueTotals(claims, { rates: { XOF: 0.002, USD: 1 }, nowMs: NOW });
  assert.equal(v.length, 1);
  const q = v[0];
  assert.equal(q.quarter, '2026-Q3');
  assert.deepEqual(q.currencies.XOF, { due: 30000, claimed: 30000, recovered: 8000, written_off: 0 });
  assert.equal(q.currencies.EUR.due, 100);
  assert.equal(q.unknown_amounts, 1);
  assert.equal(q.usd_indicative, null, 'EUR has no rate and one amount is unknown → no USD total');
  const v2 = W.valueTotals(claims.slice(0, 2), { rates: { XOF: 0.002, USD: 1 }, nowMs: NOW });
  assert.deepEqual(v2[0].usd_indicative, { due: 60, claimed: 60, recovered: 16 });
  assert.equal(v2[0].aging.open_claims, 1);
  assert.equal(v2[0].aging.median_days_since_due, 30);
});

test('notification gate: never unarmed, never under STOP, never without a second-person approval or a recipient', () => {
  const approved = { notify_state: 'approved', notify_requested_by: 1, notify_approved_by: 2 };
  assert.equal(W.notifyGate({ armed: false, stop: false, claim: approved, to: 'isp@example.org' }).reason, 'UNARMED');
  assert.equal(W.notifyGate({ armed: true, stop: true, claim: approved, to: 'isp@example.org' }).reason, 'NOTIFICATIONS_STOPPED');
  assert.equal(W.notifyGate({ armed: true, stop: false, claim: { notify_state: 'requested', notify_requested_by: 1 }, to: 'isp@example.org' }).reason, 'NOT_APPROVED');
  assert.equal(W.notifyGate({ armed: true, stop: false, claim: { ...approved, notify_approved_by: 1 }, to: 'isp@example.org' }).reason, 'NOT_APPROVED');
  assert.equal(W.notifyGate({ armed: true, stop: false, claim: approved, to: null }).reason, 'NO_RECIPIENT');
  assert.equal(W.notifyGate({ armed: true, stop: false, claim: approved, to: 'isp@example.org' }).ok, true);
  const msg = W.renderNotification({ id: 7, site_id: 5, sub_site: '', uplink: 'wan1', period: '2026-08', isp: 'TestISP', circuit_id: 'C-1', currency: 'XOF', claimed_amount: 10000, evidence_hash: 'ab'.repeat(32), calc: { availability_pct: 95, credit_pct: 10, params: { availability_target_pct: 97 } } }, { siteName: 'Mana', isp_email: 'isp@example.org' });
  assert.match(msg.subject, /SLA credit claim — TestISP C-1 — Mana wan1 — 2026-08/);
  assert.match(msg.html, /10,000 XOF/);
});

test('periods: claims open on CLOSED months only; quarter helpers', () => {
  assert.equal(W.isClosedPeriod('2026-08', NOW), true);
  assert.equal(W.isClosedPeriod('2026-10', NOW), false, 'the current month is provisional');
  assert.equal(W.isClosedPeriod('2026-13', NOW), false);
  assert.equal(W.quarterOf('2026-11'), '2026-Q4');
  assert.deepEqual(W.periodsOfQuarter('2026-Q3'), ['2026-07', '2026-08', '2026-09']);
  assert.throws(() => W.normaliseLinks(['javascript:alert(1)']), (e) => e.reason === 'BAD_LINK');
  assert.deepEqual(W.normaliseLinks([{ label: 'Invoice', url: 'https://x.example/inv' }]), [{ label: 'Invoice', url: 'https://x.example/inv' }]);
});
