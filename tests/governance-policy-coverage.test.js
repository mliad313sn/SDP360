'use strict';
// Every governance policy parameter CHANGES behaviour (committee QA P1-5, GOVERNANCE-POLICIES.md last
// line). One probe per parameter: probe(value) → an observable outcome; the default and another valid
// value must give different outcomes. A parameter added to the registry without a probe here fails the
// "every parameter is covered" test — the rule cannot silently become decoration.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const GP = require('../services/governancePolicy');
const G = require('../services/publishGate');
const SL = require('../services/sessionLifecycle');
const HL = require('../services/handoffLifecycle');
const CL = require('../services/commitmentLifecycle');

const NOW = Date.parse('2026-10-28T12:00:00Z');
const outcome = (c) => (c == null ? 'ok' : `${c.status}:${c.code}`);
const pol = (key, value) => ({ [key]: value });

// freshness: a sync 5 h old → FRESH under a 6 h limit, STALE under the 3 h default (or the other way round)
const fresh = (mod) => (v) => { const lastOk = {}; for (const j of G.jobsFor([mod])) lastOk[j] = new Date(NOW - 5 * 3600e3).toISOString(); return G.freshness([mod], lastOk, NOW, pol(`freshness.${mod}_hours`, v)).fresh; };
const staleFr = { fresh: false, sources: [{ state: 'STALE' }] };

const PROBES = {
  'reports.four_eyes': [false, (v) => outcome(G.dutyConflict('publish', { created_by: 1 }, { id: 1 }, pol('reports.four_eyes', v)))],
  'reports.freshness_gate': [false, (v) => G.reportFreshnessDecision(staleFr, { isAdmin: false, policy: pol('reports.freshness_gate', v) }).allow],
  'reports.override_allowed': [false, (v) => G.reportFreshnessDecision(staleFr, { isAdmin: true, reason: 'x'.repeat(40), policy: pol('reports.override_allowed', v) }).allow],
  'reports.override_reason_min': [30, (v) => G.reportFreshnessDecision(staleFr, { isAdmin: true, reason: 'x'.repeat(20), policy: pol('reports.override_reason_min', v) }).allow],
  'reports.withdraw_reason_min': [20, (v) => G.withdrawReasonError('wrong figures', pol('reports.withdraw_reason_min', v))],
  'freshness.helpdesk_hours': [6, fresh('helpdesk')],
  'freshness.changes_hours': [6, fresh('changes')],
  'freshness.survey_hours': [6, fresh('survey')],
  'freshness.assets_hours': [4, fresh('assets')],
  'freshness.wan_hours': [4, fresh('wan')],
  'freshness.infra_hours': [4, fresh('infra')],
  'publication.four_eyes': [false, (v) => outcome(G.definitionConflict({ review_state: 'submitted', submitted_by: 1 }, { id: 1 }, pol('publication.four_eyes', v)))],
  'publication.override_allowed': [false, (v) => G.publishDecision({ review_state: 'submitted', submitted_by: 1 }, { id: 1 }, { isAdmin: true, overrideReason: 'x'.repeat(40), policy: pol('publication.override_allowed', v) }).allow],
  'publication.override_reason_min': [30, (v) => G.publishDecision({ review_state: 'submitted', submitted_by: 1 }, { id: 1 }, { isAdmin: true, overrideReason: 'x'.repeat(20), policy: pol('publication.override_reason_min', v) }).allow],
  'meetings.missed_grace_hours': [12, (v) => SL.stage({ status: 'planned', scheduled_at: new Date(NOW - 24 * 3600e3).toISOString() }, new Date(NOW), pol('meetings.missed_grace_hours', v))],
  'meetings.minutes_four_eyes': [false, (v) => outcome(SL.check({ status: 'closed', closed_by: 1 }, 'accept', { id: 1, canDecide: true }, { policy: pol('meetings.minutes_four_eyes', v), now: new Date(NOW) }))],
  'meetings.cancel_requires_approval': [false, (v) => SL.compliance([{ status: 'cancelled', exception_status: 'pending' }], new Date(NOW), pol('meetings.cancel_requires_approval', v)).excused],
  'meetings.cancel_reason_min': [20, (v) => outcome(SL.check({ status: 'planned', scheduled_at: new Date(NOW + 864e5).toISOString() }, 'cancel', { id: 1, canRun: true }, { reason: 'site shutdown', policy: pol('meetings.cancel_reason_min', v), now: new Date(NOW) }))],
  'meetings.reopen_reason_min': [30, (v) => outcome(SL.check({ status: 'closed', minutes_accepted_at: '2026-10-20T10:00:00Z' }, 'reopen', { id: 1, isAdmin: true }, { reason: 'decision text was wrong', policy: pol('meetings.reopen_reason_min', v), now: new Date(NOW) }))],
  'handoffs.reason_min': [20, (v) => outcome(HL.check({ status: 'requested', requested_by: 1, receiver_id: 2 }, 'rejected', { id: 2, hasSite: true }, { reason: 'not ours', policy: pol('handoffs.reason_min', v) }))],
  'handoffs.overdue_escalation': [false, (v) => HL.overdue([{ id: 1, status: 'requested', due_date: '2026-10-20' }], '2026-10-28', pol('handoffs.overdue_escalation', v)).length],
  'handoffs.escalation_grace_days': [14, (v) => HL.overdue([{ id: 1, status: 'requested', due_date: '2026-10-20' }], '2026-10-28', pol('handoffs.escalation_grace_days', v)).length],
  'meetings.reopen_two_people': [true, (v) => JSON.stringify(SL.reopenStep([{ action: 'accepted', actor_id: 2 }], { id: 1 }, pol('meetings.reopen_two_people', v)))],
  'commitments.serious_due_move_needs_admin': [false, (v) => outcome(CL.dueMoveCheck({ severity: 'high', baseline_due_date: '2026-10-01' }, '2026-12-01', { isAdmin: false, policy: pol('commitments.serious_due_move_needs_admin', v) }))],
  'commitments.exception_max_days': [10, (v) => CL.exceptionExpiry('2026-10-28T00:00:00Z', pol('commitments.exception_max_days', v))],
};

// Parameters whose behaviour lives in a store (database) — proven by a named test that must mention the key.
const STORE_PROVEN = {
  'governance.dual_approval_relaxations': 'tests/governance-policy.test.js',
  'governance.relaxation_max_days': 'tests/governance-policy.test.js',
  'commitments.escalation_enabled': 'tests/commitment-escalation.test.js',
  'meetings.group_decisions_public': 'tests/governance-policy-routes.smoke.test.js',
  'governance.dual_approval_tightening': 'tests/governance-policy-routes.smoke.test.js',
  'meetings.compliance_as_of': 'tests/governance-policy-routes.smoke.test.js',
};

test('every policy parameter is covered by a behaviour probe or a named store test', () => {
  const missing = GP.PARAMS.map((p) => p.key).filter((k) => !PROBES[k] && !STORE_PROVEN[k]);
  assert.deepEqual(missing, [], 'a new parameter needs a probe here');
  for (const [k, file] of Object.entries(STORE_PROVEN)) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.ok(src.includes(k) || (k === 'governance.dual_approval_relaxations' && /dual approval/i.test(src)) || (k === 'governance.relaxation_max_days' && /relaxation_max_days/.test(src)), `${file} proves ${k}`);
  }
});

for (const [key, [other, probe]] of Object.entries(PROBES)) {
  test(`${key}: default and ${JSON.stringify(other)} give different outcomes`, () => {
    const p = GP.PARAMS.find((x) => x.key === key);
    assert.ok(p, 'known parameter');
    assert.notDeepEqual(GP.coerce ? GP.coerce(p, other) : other, undefined);
    const a = probe(p.default), b = probe(other);
    assert.notDeepEqual(a, b, `${key}=${JSON.stringify(p.default)} → ${JSON.stringify(a)}; =${JSON.stringify(other)} → ${JSON.stringify(b)}`);
  });
}

test('boundaries: a reason of exactly the minimum passes, one character less fails', () => {
  const h = { status: 'requested', requested_by: 1, receiver_id: 2 }, a = { id: 2, hasSite: true }, P = pol('handoffs.reason_min', 12);
  assert.equal(HL.check(h, 'rejected', a, { reason: 'x'.repeat(12), policy: P }), null);
  assert.equal(HL.check(h, 'rejected', a, { reason: 'x'.repeat(11), policy: P }).status, 400);
  assert.equal(G.withdrawReasonError('x'.repeat(5)), null);
  assert.ok(G.withdrawReasonError('x'.repeat(4)));
  // a scheduled run (no creator) is published by someone other than its reviewer
  assert.equal(G.dutyConflict('publish', { created_by: null, reviewed_by: 7 }, { id: 7 }).code, 'SOD_PUBLISH_REVIEWED');
  assert.equal(G.dutyConflict('publish', { created_by: null, reviewed_by: 7 }, { id: 8 }), null);
  // a serious commitment: an earlier date, the baseline itself, or an admin are fine; later than the baseline is not
  const c = { severity: 'critical', baseline_due_date: '2026-11-15' };
  assert.equal(CL.dueMoveCheck(c, '2026-11-01'), null);
  assert.equal(CL.dueMoveCheck(c, '2026-11-15'), null);
  assert.equal(CL.dueMoveCheck(c, '2026-11-16').status, 403);
  assert.equal(CL.dueMoveCheck(c, '2026-11-16', { isAdmin: true }), null);
  assert.equal(CL.dueMoveCheck({ ...c, severity: 'medium' }, '2027-01-01'), null);
});

test('two-person reopening: request, the requester cannot confirm, another admin can; a new acceptance resets', () => {
  const P = { 'meetings.reopen_two_people': true };
  assert.equal(SL.reopenStep([{ action: 'accepted', actor_id: 5 }], { id: 1 }, P), 'request');
  const h = [{ action: 'accepted', actor_id: 5 }, { action: 'reopen_requested', actor_id: 1 }];
  assert.equal(SL.reopenStep(h, { id: 1 }, P).code, 'SOD');
  assert.equal(SL.reopenStep(h, { id: 2 }, P), 'reopen');
  assert.equal(SL.reopenStep([...h, { action: 'reopened', actor_id: 2 }, { action: 'accepted', actor_id: 5 }], { id: 2 }, P), 'request', 'an old request does not carry over');
});

test('rowsAsOf replays the history: last change before the date, cleared values and expired relaxations drop out', () => {
  const H = [
    { id: 1, scope: 'global', key: 'meetings.missed_grace_hours', new_value: '24', at: '2026-01-01T00:00:00Z' },
    { id: 2, scope: 'site:3', key: 'publication.four_eyes', new_value: 'false', at: '2026-02-01T00:00:00Z', expires_at: '2026-03-01T00:00:00Z' },
    { id: 3, scope: 'global', key: 'meetings.missed_grace_hours', new_value: null, at: '2026-04-01T00:00:00Z' },
  ];
  assert.deepEqual(GP.rowsAsOf(H, '2025-12-31T00:00:00Z'), {});
  assert.deepEqual(GP.rowsAsOf(H, '2026-02-15T00:00:00Z'), { global: { 'meetings.missed_grace_hours': 24 }, 'site:3': { 'publication.four_eyes': false } });
  assert.deepEqual(GP.rowsAsOf(H, '2026-03-15T00:00:00Z'), { global: { 'meetings.missed_grace_hours': 24 } }, 'relaxation expired');
  assert.deepEqual(GP.rowsAsOf(H, '2026-05-01T00:00:00Z'), {}, 'cleared → default');
});

test('an approved exception lapses: the A02 overdue alert comes back after commitments.exception_max_days', () => {
  const M = require('../services/commitmentMetrics');
  const row = { id: 1, site_id: 3, status: 'in_progress', severity: 'high', accountable_owner: 'x', due_date: '2026-09-01', exception_approved_by: 'boss', exception_expires_at: '2026-10-15T00:00:00Z' };
  assert.equal(M.seriousExposure([row], '2026-10-10').serious_overdue, 0, 'excused while the exception runs');
  assert.equal(M.seriousExposure([row], '2026-10-20').serious_overdue, 1, 'lapsed → overdue again');
  assert.equal(M.seriousExposure([{ ...row, exception_expires_at: null }], '2026-10-20').serious_overdue, 0, 'an exception approved before expiry existed keeps counting');
});
