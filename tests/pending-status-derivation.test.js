'use strict';
// The sync derives request_records.pending_status. The July-2026 diagnosis: an
// old CLOSED ticket whose Zoho "Request Pending Status" field is EMPTY was stored
// as OPEN (=1), so the ageing chart counted ~6000 closed tickets as open >60d in
// PG. computePendingStatus must fall back to Request Status when pending is blank,
// mirroring the browser's isClosed().
const { test } = require('node:test');
const assert = require('node:assert');
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'x';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'x';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'x';
const { computePendingStatus, CLOSED_STATUSES } = require('../zoho-sync.js');

test('explicit pending flag wins (case/whitespace tolerant)', () => {
  assert.equal(computePendingStatus('No', 'Open'), 0, 'No → closed even if status looks open');
  assert.equal(computePendingStatus('  NO ', 'In Progress'), 0);
  assert.equal(computePendingStatus('Yes', 'Closed'), 1, 'Yes → open (trusts the explicit flag)');
});

test('EMPTY pending falls back to Request Status — the bug fix', () => {
  // These were the ~6000 wrongly-open rows: closed status, blank pending flag.
  for (const s of ['Closed', 'Resolved', 'Cancelled', 'Confirm resolution', 'Confirmed resolution'])
    assert.equal(computePendingStatus('', s), 0, `empty pending + "${s}" → closed`);
  // Genuinely-open statuses stay open when pending is blank.
  for (const s of ['Open', 'On Hold', 'In Progress', 'Awaiting Reply'])
    assert.equal(computePendingStatus('', s), 1, `empty pending + "${s}" → open`);
});

test('both fields empty/unknown → open (safe default, rare)', () => {
  assert.equal(computePendingStatus('', ''), 1);
  assert.equal(computePendingStatus(null, null), 1);
  assert.equal(computePendingStatus(undefined, undefined), 1);
});

test('the OLD single-source logic would have failed this case', () => {
  // Old code: (pending||'yes').trim().toLowerCase()==='no' ? 0 : 1  → empty → 1 (WRONG for a Closed ticket)
  const oldLogic = (p) => (String(p || 'yes')).toLowerCase().trim() === 'no' ? 0 : 1;
  assert.equal(oldLogic(''), 1, 'old logic marks a blank-pending CLOSED ticket as open');
  assert.equal(computePendingStatus('', 'Closed'), 0, 'new logic marks it closed');
});

test('CLOSED_STATUSES is the exact browser vocabulary', () => {
  assert.deepEqual([...CLOSED_STATUSES].sort(),
    ['cancelled', 'closed', 'confirm resolution', 'confirmed resolution', 'resolved']);
});
