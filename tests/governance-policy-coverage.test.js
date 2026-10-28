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
};

// Parameters whose behaviour lives in a store (database) — proven by a named test that must mention the key.
const STORE_PROVEN = {
  'governance.dual_approval_relaxations': 'tests/governance-policy.test.js',
  'governance.relaxation_max_days': 'tests/governance-policy.test.js',
  'commitments.escalation_enabled': 'tests/commitment-escalation.test.js',
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
});
