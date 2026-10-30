'use strict';
// G-21 — PURE session lifecycle (services/sessionLifecycle): stages, who may do what, four-eyes on
// minutes acceptance, frozen once accepted, a no-show never counts as held, effective windows.
const test = require('node:test');
const assert = require('node:assert/strict');
const SL = require('../services/sessionLifecycle');
const NOW = new Date('2026-10-28T12:00:00Z');
const runner = { id: 1, canRun: true, canDecide: true, isCommittee: false, isAdmin: false };
const chair2 = { id: 2, canRun: true, canDecide: true, isCommittee: false, isAdmin: false };
const committee = { id: 3, canRun: true, canDecide: false, isCommittee: true, isAdmin: false };
const admin = { id: 4, canRun: true, canDecide: true, isCommittee: true, isAdmin: true };
const viewer = { id: 5, canRun: false, canDecide: false, isCommittee: false, isAdmin: false };

test('stage: planned, missed after the grace, held, logged, accepted, cancelled', () => {
  assert.equal(SL.stage({ status: 'planned', scheduled_at: '2026-10-27T09:00:00Z' }, NOW), 'planned');
  assert.equal(SL.stage({ status: 'planned', scheduled_at: '2026-10-25T09:00:00Z' }, NOW), 'missed');
  assert.equal(SL.stage({ status: 'live' }, NOW), 'held');
  assert.equal(SL.stage({ status: 'closed' }, NOW), 'logged');
  assert.equal(SL.stage({ status: 'closed', minutes_accepted_at: 'x' }, NOW), 'accepted');
  assert.equal(SL.stage({ status: 'cancelled' }, NOW), 'cancelled');
});

test('check: start/close order, no held without a start, four-eyes acceptance, frozen once accepted', () => {
  const planned = { status: 'planned', scheduled_at: '2026-10-28T09:00:00Z' };
  assert.equal(SL.check(planned, 'start', viewer).status, 403);
  assert.equal(SL.check(planned, 'start', runner), null);
  assert.equal(SL.check(planned, 'close', runner).code, 'BAD_STAGE', 'never started = never held');
  const live = { ...planned, status: 'live' };
  assert.equal(SL.check(live, 'start', runner).code, 'BAD_STAGE');
  assert.equal(SL.check(live, 'close', runner), null);
  const logged = { ...live, status: 'closed', closed_by: 1 };
  assert.equal(SL.check(logged, 'close', runner).code, 'BAD_STAGE', 'closing twice would rewrite the minutes');
  assert.equal(SL.check(logged, 'accept', runner).code, 'SOD');
  assert.equal(SL.check(logged, 'accept', viewer).status, 403);
  assert.equal(SL.check(logged, 'accept', chair2), null);
  assert.equal(SL.check(logged, 'accept', committee), null);
  const accepted = { ...logged, minutes_accepted_at: '2026-10-28T10:00:00Z' };
  assert.equal(SL.check(accepted, 'edit', admin).code, 'FROZEN');
  assert.equal(SL.check(accepted, 'accept', chair2).code, 'BAD_STAGE');
  assert.equal(SL.check(accepted, 'reopen', chair2).status, 403);
  assert.equal(SL.check(accepted, 'reopen', admin, { reason: 'short' }).status, 400);
  assert.equal(SL.check(accepted, 'reopen', admin, { reason: 'decision text was wrong' }), null);
});

test('cancellation is an exception: reason required, approved by the committee, never by the canceller', () => {
  const planned = { status: 'planned', scheduled_at: '2026-10-29T09:00:00Z' };
  assert.equal(SL.check(planned, 'cancel', runner, { reason: '' }).status, 400);
  assert.equal(SL.check(planned, 'cancel', runner, { reason: 'site shutdown' }), null);
  assert.equal(SL.check({ status: 'live' }, 'cancel', runner, { reason: 'site shutdown' }).code, 'BAD_STAGE');
  const cancelled = { status: 'cancelled', cancelled_by: 3, exception_status: 'pending' };
  assert.equal(SL.check(cancelled, 'approve_exception', runner).status, 403);
  assert.equal(SL.check(cancelled, 'approve_exception', committee).code, 'SOD');
  assert.equal(SL.check(cancelled, 'approve_exception', admin), null);
});

test('compliance: a no-show never counts as held; excused vs unexcused; nothing due = null, not 0 %', () => {
  const c = SL.compliance([
    { status: 'closed', minutes_accepted_at: 'x' }, { status: 'closed' },
    { status: 'planned', scheduled_at: '2026-10-01T09:00:00Z' },
    { status: 'cancelled', exception_status: 'approved' }, { status: 'cancelled', exception_status: 'pending' },
    { status: 'planned', scheduled_at: '2026-11-05T09:00:00Z' }, { status: 'live' },
  ], NOW);
  assert.deepEqual([c.held, c.accepted, c.logged, c.missed, c.excused, c.unexcused, c.planned, c.in_progress], [2, 1, 1, 1, 1, 2, 1, 1]);
  assert.equal(c.held_pct, 50);
  assert.equal(SL.compliance([{ status: 'planned', scheduled_at: '2026-11-05T09:00:00Z' }], NOW).held_pct, null);
});

test('effective window: inclusive bounds, either optional', () => {
  assert.equal(SL.inEffectiveWindow({}, '2026-10-28T09:00:00Z'), true);
  assert.equal(SL.inEffectiveWindow({ effective_from: '2026-11-01' }, '2026-10-28'), false);
  assert.equal(SL.inEffectiveWindow({ effective_from: '2026-10-28', effective_to: '2026-10-28' }, '2026-10-28T23:00:00Z'), true);
  assert.equal(SL.inEffectiveWindow({ effective_to: '2026-10-27' }, '2026-10-28'), false);
  assert.equal(SL.inEffectiveWindow({}, 'garbage'), false);
});
