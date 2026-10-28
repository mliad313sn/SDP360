'use strict';
// Consolidation — serious-exposure counts behind alerts A01 (unowned) and A02 (overdue, no exception).
const { test } = require('node:test');
const assert = require('node:assert');
const { seriousExposure, summary } = require('../services/commitmentMetrics');
const R = [
  { id: 1, severity: 'critical', status: 'captured', accountable_owner: '' },
  { id: 2, severity: 'high', status: 'in_progress', accountable_owner: 'a', due_date: '2026-01-01' },
  { id: 3, severity: 'high', status: 'in_progress', accountable_owner: 'a', due_date: '2026-01-01', exception_approved_by: 'boss' },
  { id: 4, severity: 'high', status: 'awaiting_verification', accountable_owner: 'a', due_date: '2026-01-01' },
  { id: 5, severity: 'low', status: 'captured' },
  { id: 6, severity: 'critical', status: 'verified_closed', due_date: '2026-01-01' },
  { id: 7, severity: 'high', status: 'in_progress', accountable_owner: 'a', due_date: '2026-12-31' },
];
test('A01 counts serious non-terminal commitments without an owner', () => {
  const x = seriousExposure(R, '2026-10-28'); assert.equal(x.serious_unowned, 1); assert.deepEqual(x.unowned_ids, [1]);
});
test('A02 counts overdue serious commitments, excluding approved exceptions, awaiting verification and terminal ones', () => {
  const x = seriousExposure(R, '2026-10-28'); assert.deepEqual(x.overdue_ids, [2]); assert.equal(x.serious_open, 5);
});
test('summary carries both counts; an empty store is a measured zero, not unknown', () => {
  assert.equal(summary(R, '2026-10-28').serious_overdue, 1);
  const e = summary([], '2026-10-28'); assert.equal(e.serious_unowned, 0); assert.equal(e.verified_on_time_pct, null);
});
