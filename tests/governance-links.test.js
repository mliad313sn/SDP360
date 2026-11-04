'use strict';
// C-15 (G23) — pure helpers: a decision's source links (session / PV) and engagement delays (days overdue + ageing).
// Null = unknown, never 0: an item without a usable due date has days_overdue null and lands in the 'unknown' bucket.
const { test } = require('node:test');
const assert = require('node:assert');
const GL = require('../services/governanceLinks');

test('decisionSourceLinks: a session decision links to its cockpit session with date and cadence', () => {
  const links = GL.decisionSourceLinks({ ref: 'DEC-2026-001', session_id: 7 }, { sessions: new Map([[7, { id: 7, scheduled_at: '2026-10-20T09:00:00Z', cadence_name: 'HGO weekly' }]]) });
  assert.deepEqual(links, [{ kind: 'session', label: 'Session 2026-10-20 · HGO weekly', href: 'cockpit.html?session=7' }]);
});

test('decisionSourceLinks: a PV source links to the meeting editor when its id is known, as text otherwise', () => {
  assert.deepEqual(GL.decisionSourceLinks({ session_id: null, source_kind: 'pv', source_ref: '42' }), [{ kind: 'pv', label: 'PV 42', href: 'meeting.html?id=42' }]);
  assert.deepEqual(GL.decisionSourceLinks({ source_kind: 'meeting', source_ref: 'HGO_Maintenance_PV_2026-05' }), [{ kind: 'pv', label: 'PV HGO_Maintenance_PV_2026-05', href: null }]);
});

test('decisionSourceLinks: session + other reference both kept; unknown session still linked by id; nothing → empty (unknown)', () => {
  const l = GL.decisionSourceLinks({ session_id: 9, source_kind: 'reference', source_ref: 'INC-12' });
  assert.equal(l.length, 2); assert.deepEqual(l[0], { kind: 'session', label: 'Session #9', href: 'cockpit.html?session=9' });
  assert.deepEqual(l[1], { kind: 'reference', label: 'INC-12', href: null });
  assert.deepEqual(GL.decisionSourceLinks({ session_id: null }), []);
  assert.deepEqual(GL.decisionSourceLinks(null), []);
});

test('daysOverdue: positive when late, 0 when on time (measured), null when the due date is missing or unreadable', () => {
  assert.equal(GL.daysOverdue('2026-10-01', '2026-10-11'), 10);
  assert.equal(GL.daysOverdue('2026-10-11', '2026-10-11'), 0);
  assert.equal(GL.daysOverdue('2026-12-01', '2026-10-11'), 0);
  assert.equal(GL.daysOverdue(null, '2026-10-11'), null);
  assert.equal(GL.daysOverdue('', '2026-10-11'), null);
  assert.equal(GL.daysOverdue('soon', '2026-10-11'), null);
  assert.equal(GL.daysOverdue('2026-02-31', '2026-10-11'), null);
});

test('engagementDelays: buckets, counts and max; unknown due dates never counted as on time', () => {
  const items = [
    { kind: 'decision', ref: 'DEC-1', due_date: '2026-10-10' },  // 1
    { kind: 'decision', ref: 'DEC-2', due_date: '2026-09-21' },  // 20
    { kind: 'action', ref: 'A', due_date: '2026-07-01' },        // 102
    { kind: 'action', ref: 'B', due_date: '2026-12-01' },        // on time
    { kind: 'action', ref: 'C', due_date: null },                // unknown
  ];
  const r = GL.engagementDelays(items, '2026-10-11');
  assert.equal(r.summary.total, 5); assert.equal(r.summary.overdue, 3); assert.equal(r.summary.unknown, 1);
  assert.deepEqual(r.summary.buckets, { on_time: 1, d1_7: 1, d8_30: 1, d31_90: 0, d90_plus: 1, unknown: 1 });
  assert.equal(r.summary.max_days_overdue, 102);
  assert.deepEqual(r.items.map(i => i.ref), ['A', 'DEC-2', 'DEC-1', 'B', 'C'], 'most overdue first, unknown last');
  assert.equal(r.items.find(i => i.ref === 'C').days_overdue, null); assert.equal(r.items.find(i => i.ref === 'C').bucket, 'unknown');
});

test('engagementDelays: no item → max null; only unknown due dates → max null; all on time → max 0 (measured)', () => {
  assert.equal(GL.engagementDelays([], '2026-10-11').summary.max_days_overdue, null);
  assert.equal(GL.engagementDelays([{ due_date: null }], '2026-10-11').summary.max_days_overdue, null);
  assert.equal(GL.engagementDelays([{ due_date: '2026-12-01' }], '2026-10-11').summary.max_days_overdue, 0);
});
