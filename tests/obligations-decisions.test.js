'use strict';
// E-G02 — obligations view: open governance decisions (opt-in), shown once, href + focus back-links.
const test = require('node:test');
const assert = require('node:assert');
const O = require('../services/obligations');
const asOf = '2026-11-06';

test('decisions not asked (default): registers map and items are exactly as before', () => {
  const r = O.compose({ sessionActions: [{ id: 1, session_id: 9, title: 'A', status: 'open' }], asOf });
  assert.equal('decisions' in r.registers, false);
  assert.equal(r.items[0].sources, undefined, 'no new field on the session action');
  assert.equal(r.items.length, 1);
});

test('decisions read: an open decision with no action is its own line; due unknown → null, not overdue', () => {
  const r = O.compose({ decisions: [{ id: 3, ref: 'DEC-2026-003', title: 'Buy UPS', status: 'open', due_date: null, session_id: 4 },
    { id: 4, ref: 'DEC-2026-004', title: 'Closed one', status: 'done' }], asOf });
  assert.equal(r.registers.decisions, 'read');
  assert.equal(r.items.length, 1);
  const d = r.items[0];
  assert.equal(d.register, 'decision'); assert.equal(d.due_date, null); assert.equal(d.overdue, false);
  assert.equal(d.href, 'cockpit.html?session=4'); assert.equal(d.focus, 'decision:3');
});

test('a decision that produced a session action or a commitment is shown once, under it', () => {
  const r = O.compose({
    commitments: [{ id: 50, ref: 'C-50', title: 'Commit', status: 'open' }],
    sessionActions: [{ id: 7, session_id: 2, title: 'Order UPS', status: 'open', decision_ref: 'DEC-1' }],
    decisions: [{ id: 1, ref: 'DEC-1', title: 'D1', status: 'open' }, { id: 2, ref: 'DEC-2', title: 'D2', status: 'in_progress', commitment: { id: 50 } }],
    asOf,
  });
  assert.equal(r.items.filter((x) => x.register === 'decision').length, 0, 'no duplicate line');
  assert.deepEqual(r.items.find((x) => x.register === 'session_action').sources.map((s) => s.ref), ['DEC-1']);
  assert.deepEqual(r.items.find((x) => x.register === 'commitment').sources.map((s) => s.ref), ['DEC-2']);
});

test('decisions not readable → null in the registers map (never "nothing owed"); href / focus on every line', () => {
  const r = O.compose({ decisions: null, handoffs: [{ id: 5, ref: 'H-5', title: 'H', status: 'requested' }], asOf });
  assert.equal(r.registers.decisions, null);
  assert.equal(r.items[0].href, 'handoffs.html?id=5'); assert.equal(r.items[0].focus, 'handoff:5');
  assert.equal(O.focusHref(12, 'commitment', 50), 'obligations.html?site=12&focus=commitment%3A50');
});
