'use strict';
// The French catalogue of server messages (committee field review P1-6): every message the governance
// lifecycles can return has a French text — checked against the REAL messages of the pure modules.
const { test } = require('node:test');
const assert = require('node:assert');
require('../public/lib/errorText.js');
const ET = globalThis.ErrorText;
const SL = require('../services/sessionLifecycle');
const HL = require('../services/handoffLifecycle');

test('session and handoff lifecycle messages are all translated', () => {
  const msgs = [];
  const add = (c) => { if (c && typeof c === 'object' && c.error) msgs.push(c.error); };
  const now = new Date('2026-10-28T12:00:00Z');
  add(SL.check({ status: 'planned', scheduled_at: '2026-10-29T09:00:00Z' }, 'close', { id: 1, canRun: true }, { now }));
  add(SL.check({ status: 'closed', closed_by: 1 }, 'accept', { id: 1, canDecide: true }, { now }));
  add(SL.check({ status: 'planned', scheduled_at: '2026-10-29T09:00:00Z' }, 'cancel', { id: 1, canRun: true }, { reason: 'x', now }));
  add(SL.check({ status: 'planned', scheduled_at: '2026-10-20T09:00:00Z' }, 'reschedule', { id: 1, canRun: true }, { now }));
  add(SL.check({ status: 'closed', minutes_accepted_at: '2026-10-20' }, 'edit', { id: 1 }, { now }));
  add(SL.check({ status: 'cancelled', cancelled_by: 1 }, 'approve_exception', { id: 1, isCommittee: true }, { now }));
  add(SL.check({ status: 'planned' }, 'start', { id: 1 }, { now }));
  add(SL.reopenStep([{ action: 'reopen_requested', actor_id: 1 }], { id: 1 }, { 'meetings.reopen_two_people': true }));
  const h = { status: 'requested', requested_by: 1, receiver_id: 2 };
  add(HL.check(h, 'accepted', { id: 3, hasSite: true }));
  add(HL.check(h, 'rejected', { id: 2, hasSite: true }, { reason: 'no' }));
  add(HL.check({ ...h, status: 'delivered', delivered_by: 2 }, 'verified', { id: 2, hasSite: true }));
  add(HL.check(h, 'accepted', { id: 2, hasSite: false }));
  // ADR-006 / committee #34
  add(HL.check({ ...h, status: 'delivered', delivered_by: 2 }, 'verified', { id: 5, hasSite: true, deputyFor: [1, 2] }));
  add(HL.check({ ...h, receiver_contact: 'Chef maintenance' }, 'accepted', { id: 2, hasSite: true }));
  add(HL.contactCheck('Chef', { 'handoffs.proxy_accept': false }));
  const R = require('../services/governanceRoles');
  add(R.validateDeputy({ user_id: 1, deputy_id: 1, start_date: '2026-10-01', end_date: '2026-10-02', reason: 'leave' }));
  add(R.validateDeputy({ user_id: 1, deputy_id: 2, start_date: '2026-01-01', end_date: '2026-12-31', reason: 'leave' }));
  assert.ok(msgs.length >= 10);
  for (const m of msgs) assert.notEqual(ET.fr(m), m, `no French text for: ${m}`);
  assert.match(ET.fr('a reason (12+ characters) is required to cancel a session'), /12 caractères/);
  assert.equal(ET.fr('something nobody wrote'), 'something nobody wrote', 'unknown messages pass through unchanged');
});
