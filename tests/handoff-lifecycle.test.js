'use strict';
// G-22 — PURE handoff state machine (services/handoffLifecycle).
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../services/handoffLifecycle');
const h = (o) => ({ status: 'requested', requested_by: 1, receiver_id: 2, ...o });
const req = { id: 1, isAdmin: false, active: true, hasSite: true };
const rec = { id: 2, isAdmin: false, active: true, hasSite: true };
const other = { id: 3, isAdmin: false, active: true, hasSite: true };
const admin = { id: 9, isAdmin: true, active: true, hasSite: false };

test('only the named receiver accepts; reasons required; terminal states are final', () => {
  assert.equal(L.check(h(), 'accepted', req).status, 403);
  assert.equal(L.check(h(), 'accepted', other).status, 403);
  assert.equal(L.check(h(), 'accepted', admin).status, 403, 'not even the admin accepts on the receiver\'s behalf');
  assert.equal(L.check(h(), 'accepted', rec), null);
  assert.equal(L.check(h(), 'rejected', rec, { reason: '' }).status, 400);
  assert.equal(L.check(h(), 'rejected', rec, { reason: 'not our scope' }), null);
  assert.equal(L.check(h({ status: 'verified' }), 'accepted', admin).code, 'BAD_STAGE');
  assert.equal(L.check(h({ status: 'requested' }), 'verified', req).code, 'BAD_STAGE');
});

test('verification by the requesting side, never by the deliverer; admin may verify if it did not deliver', () => {
  const d = h({ status: 'delivered', delivered_by: 2 });
  assert.equal(L.check(d, 'verified', rec).status, 403);
  assert.equal(L.check(d, 'verified', req), null);
  assert.equal(L.check(h({ status: 'delivered', delivered_by: 9 }), 'verified', admin).code, 'SOD');
  assert.equal(L.check(d, 'accepted', req, { reason: 'redo it' }), null, 'rework');
});

test('permission downgrade and inactive accounts', () => {
  assert.equal(L.check(h(), 'accepted', { ...rec, hasSite: false }).status, 403);
  assert.equal(L.check(h(), 'accepted', { ...rec, active: false }).status, 403);
});

test('reassignment and overdue escalation', () => {
  assert.equal(L.checkReassign(h(), rec, 4, { reason: 'on leave' }).status, 403);
  assert.equal(L.checkReassign(h(), req, 1, { reason: 'on leave' }).status, 400, 'requester cannot be receiver');
  assert.equal(L.checkReassign(h({ status: 'delivered' }), req, 4, { reason: 'on leave' }).code, 'BAD_STAGE');
  assert.equal(L.checkReassign(h(), req, 4, { reason: 'on leave' }), null);
  const rows = [h({ id: 1, due_date: '2026-10-01' }), h({ id: 2, due_date: '2026-10-28' }), h({ id: 3, status: 'escalated', due_date: '2026-01-01' }), h({ id: 4, status: 'verified', due_date: '2026-01-01' }), h({ id: 5 })];
  assert.deepEqual(L.overdue(rows, '2026-10-28').map((x) => x.id), [1]);
});
