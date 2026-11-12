'use strict';
// E-I03 (audit I-03, catalogue R15) — PIR review record: pure windows (after = null, never 0, while not elapsed),
// store idempotence, SoD on sign-off (author refused), sign-off freezes the record.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const PIR = require('../services/pirReview');

test('after-window not elapsed → after null (not 0); before counted; the incident itself excluded', () => {
  const rows = [{ request_id: 'a', created_time: '2026-09-20T10:00:00Z' }, { request_id: 'mi', created_time: '2026-10-01T10:00:00Z' },
    { request_id: 'b', created_time: '2026-10-05T10:00:00Z' }, { request_id: 'old', created_time: '2026-01-01T00:00:00Z' }];
  const c = PIR.countWindows(rows, { occurredDay: '2026-10-01', windowDays: 30, today: '2026-10-10', requestId: 'mi' });
  assert.equal(c.before, 1); assert.equal(c.after, null);
  const d = PIR.countWindows(rows, { occurredDay: '2026-10-01', windowDays: 30, today: '2026-12-01', requestId: 'mi' });
  assert.equal(d.after, 1);
  const z = PIR.countWindows([], { occurredDay: '2026-10-01', windowDays: 30, today: '2026-12-01' });
  assert.equal(z.after, 0, 'elapsed and none = a measured zero');
  assert.deepEqual(PIR.countWindows([], { occurredDay: null, windowDays: 30, today: '2026-12-01' }).before, null);
});

test('window days bounded', () => { assert.equal(PIR.windowDays('3'), 90); assert.equal(PIR.windowDays(30), 30); assert.equal(PIR.windowDays(9999), 365); });

test('store: idempotent create, author cannot sign off (SELF_REVIEW), another person can, signed = read-only', async () => {
  const rdb = require('../reports-db');
  const st = PIR.makePirStore({ prepare: (sql) => rdb.pgHandle().prepare(sql) });
  const ctx = { request_id: 'PIR-T-1', site_id: 1, category: 'Network', sub_category: 'WAN', occurred_on: '2026-10-01' };
  const a = { id: 101, username: 'author' }, b = { id: 102, username: 'signer' };
  const r1 = await st.create(ctx, { decisions: '', window_days: 30, commitment_ids: [3, 3, 'x'] }, a);
  assert.equal(r1.created, true); assert.deepEqual(r1.review.commitment_ids, [3]);
  const r2 = await st.create(ctx, { decisions: 'other' }, b);
  assert.equal(r2.created, false); assert.equal(r2.review.id, r1.review.id);
  await assert.rejects(st.signOff(r1.review.id, b, { expectedVersion: 1, counts: {} }), /decisions/);
  const u = await st.update(r1.review.id, { decisions: 'Replace the WAN router; monitor 30 days' }, { expectedVersion: 1 });
  await assert.rejects(st.update(u.id, { decisions: 'x' }, { expectedVersion: 1 }), /stale/);
  await assert.rejects(st.signOff(u.id, a, { expectedVersion: u.version, counts: {} }), /SELF_REVIEW/);
  const s = await st.signOff(u.id, b, { note: 'checked', expectedVersion: u.version, counts: { before: 4, after: null } });
  assert.equal(s.signed, true); assert.equal(s.signed_off_by, 102); assert.equal(s.before_count, 4); assert.equal(s.after_count, null);
  await assert.rejects(st.update(s.id, { decisions: 'x' }, { expectedVersion: s.version }), /read-only/);
  await assert.rejects(st.signOff(s.id, { id: 103 }, { expectedVersion: s.version }), /already/);
});
