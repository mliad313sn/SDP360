'use strict';
// 2027 Goal 02 — pure commitment state machine: transition table, actor privileges, severity rule,
// self-verification refusal, technical completion ≠ verification, source status never verifies.
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../services/commitmentLifecycle');

const editor = { id: 1, username: 'it.editor', canEdit: true, isAdmin: false };
const reviewer = { id: 2, username: 'biz.reviewer', canEdit: false, isAdmin: false };
const stranger = { id: 3, username: 'someone', canEdit: false, isAdmin: false };
const superA = { id: 4, username: 'boss', canEdit: false, isAdmin: true };
const base = (o = {}) => ({ status: 'captured', severity: 'medium', accountable_owner: 'it.owner', execution_owners: ['it.tech'], reviewer: 'biz.reviewer', created_by: 'it.editor', due_date: '2026-11-30', treatment_plan: 'plan', ...o });

test('table-driven transitions: allowed / refused with status codes', () => {
  const rows = [
    // [from, to, actor, reason, expectOk, expectStatus]
    ['captured', 'triaged', editor, null, true],
    ['captured', 'committed', editor, null, true],
    ['captured', 'in_progress', editor, null, false, 400],
    ['captured', 'triaged', stranger, null, false, 403],
    ['captured', 'cancelled_with_reason', editor, null, false, 400],
    ['captured', 'cancelled_with_reason', editor, 'duplicate', true],
    ['committed', 'in_progress', editor, null, true],
    ['in_progress', 'awaiting_verification', editor, null, true],
    ['in_progress', 'verified_closed', superA, null, false, 400],
    ['awaiting_verification', 'verified_closed', reviewer, null, true],
    ['awaiting_verification', 'verified_closed', editor, null, false, 403],
    ['awaiting_verification', 'verified_closed', stranger, null, false, 403],
    ['awaiting_verification', 'rejected_for_rework', reviewer, null, false, 400],
    ['awaiting_verification', 'rejected_for_rework', reviewer, 'no evidence', true],
    ['awaiting_verification', 'accepted_risk_exception', reviewer, 'residual accepted', true],
    ['rejected_for_rework', 'in_progress', editor, null, true],
    ['verified_closed', 'reopened', reviewer, 'regressed', true],
    ['verified_closed', 'reopened', editor, 'regressed', false, 403],
    ['cancelled_with_reason', 'reopened', editor, 'x', false, 403],
    ['cancelled_with_reason', 'reopened', superA, 'x', true],
    ['reopened', 'in_progress', editor, null, true],
    ['blocked', 'in_progress', editor, null, true],
    ['deferred', 'committed', editor, null, true],
  ];
  for (const [from, to, actor, reason, ok, st] of rows) {
    const r = L.checkTransition(base({ status: from }), to, actor, { reason });
    assert.equal(r.ok, ok, `${from} → ${to} by ${actor.username}: ${r.reason || 'ok'}`);
    if (!ok) assert.equal(r.status, st, `${from} → ${to} status`);
  }
});

test('every status has an entry in the table and every target is a known status', () => {
  for (const s of L.STATUSES) assert.ok(Array.isArray(L.TRANSITIONS[s]), s);
  for (const s of Object.keys(L.TRANSITIONS)) for (const t of L.TRANSITIONS[s]) assert.ok(L.STATUSES.includes(t.to));
  assert.ok(!Object.values(L.TRANSITIONS).flat().some((t) => t.to === 'verified_closed' && t.who !== 'review'), 'only a reviewer reaches verified_closed');
});

test('no self-verification — owner, executor, creator, even a super_admin', () => {
  const aw = base({ status: 'awaiting_verification' });
  for (const self of [{ username: 'it.owner', isAdmin: true }, { username: 'IT.TECH', isAdmin: true }, { username: 'it.editor', isAdmin: true }]) {
    const r = L.checkTransition(aw, 'verified_closed', self);
    assert.equal(r.ok, false); assert.equal(r.status, 403); assert.match(r.reason, /cannot verify/);
  }
  const r = L.checkTransition(base({ status: 'awaiting_verification', reviewer: 'boss' }), 'verified_closed', { username: 'boss', isAdmin: true });
  assert.equal(r.ok, true, 'a reviewer who did not do the work may verify');
});

test('severity rule: high / critical needs owner + due date (or approved exception) + treatment plan', () => {
  const hi = base({ severity: 'high', accountable_owner: null, due_date: null, treatment_plan: null });
  assert.deepEqual(L.severityGaps(hi), ['accountable_owner', 'due_date', 'treatment_plan']);
  for (const to of ['triaged', 'committed']) { const r = L.checkTransition(hi, to, editor); assert.equal(r.ok, false); assert.equal(r.status, 400); }
  assert.equal(L.checkTransition(hi, 'cancelled_with_reason', editor, { reason: 'dup' }).ok, true, 'cancelling stays possible');
  assert.equal(L.checkTransition(base({ severity: 'critical', due_date: null, exception_approved_by: 'boss' }), 'committed', editor).ok, true, 'approved exception replaces the date');
  assert.equal(L.checkTransition(base({ severity: 'low', accountable_owner: null, due_date: null, treatment_plan: null }), 'triaged', editor).ok, true, 'low severity is not gated');
  assert.equal(L.checkTransition(base({ status: 'deferred', severity: 'high', treatment_plan: null }), 'committed', editor).ok, false, 'entering committed re-checks the rule');
});

test('technical completion ≠ verification; a closed source never verifies', () => {
  assert.equal(L.sourceStatusSuggestion('Closed'), 'awaiting_verification');
  assert.equal(L.sourceStatusSuggestion('resolved'), 'awaiting_verification');
  assert.equal(L.sourceStatusSuggestion('open'), null);
  for (const s of ['closed', 'resolved', 'done', 'completed', 'successful']) assert.notEqual(L.sourceStatusSuggestion(s), 'verified_closed');
  assert.equal(L.isVerified('awaiting_verification'), false);
});

test('allowedTransitions lists only what the actor may fire', () => {
  const aw = base({ status: 'awaiting_verification' });
  assert.deepEqual(L.allowedTransitions(aw, editor), []);
  assert.deepEqual(L.allowedTransitions(aw, reviewer).map((t) => t.to).sort(), ['accepted_risk_exception', 'rejected_for_rework', 'verified_closed']);
});

test('reviewer rights follow the unique identity only: a namesake or a typed id never verifies (committee security P1-3)', () => {
  const L = require('../services/commitmentLifecycle');
  const c = { status: 'awaiting_verification', severity: 'medium', accountable_owner: 'it.owner', execution_owners: ['it.tech'], created_by: 'it.editor', due_date: '2026-11-30', treatment_plan: 'p' };
  assert.equal(L.isReviewer({ ...c, reviewer: 'A. Ouedraogo' }, { username: 'ouedraogo.b', full_name: 'A. Ouedraogo', id: 12 }), false, 'full name is not an identity');
  assert.equal(L.isReviewer({ ...c, reviewer: '12' }, { username: 'ouedraogo.b', id: 12 }), false, 'a typed id is not an identity');
  assert.equal(L.isReviewer({ ...c, reviewer: 'Ouedraogo.B' }, { username: 'ouedraogo.b', id: 12 }), true, 'username, case-insensitive');
  assert.equal(L.isReviewer({ ...c, reviewer: 'b.o@edv.example' }, { username: 'x', email: 'B.O@edv.example' }), true, 'e-mail');
  // refusals stay broad: the doer named by full name still cannot verify
  assert.equal(L.isSelf({ ...c, execution_owners: ['A. Ouedraogo'] }, { username: 'ouedraogo.b', full_name: 'A. Ouedraogo' }), true);
});
