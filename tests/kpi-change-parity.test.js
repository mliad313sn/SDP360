'use strict';
// EX-04 — the change success rate has TWO definitions in use. They are computed from the SAME classifier
// (reports-db._changeOutcome) and differ ONLY by whether cancelled changes count as executed. Both are in
// the dictionary as DRAFT with decision D-01, so neither can pass for the official figure before it.
const test = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');
const { SEED } = require('../services/metricRegistry');

const row = (outcome) => ({ udf_json: JSON.stringify({ 'UDF:Change Implementation Outcome': outcome }) });
// 7 successful, 1 partial, 2 failed, 1 backed out, 3 cancelled, 2 still pending
const rows = [...Array(7).fill(row('Successful')), row('Partial'), row('Failed'), row('Failed'), row('Backed out'),
  row('Cancelled'), row('Cancelled'), row('Cancelled'), row(''), row('')];

test('deck and ITSM definitions differ only by the cancelled changes', () => {
  const r = rdb._computeSiteChanges(rows);
  assert.equal(r.executed, 7 + 1 + 3 + 3);              // deck: cancelled counted as executed
  assert.equal(r.executed_itsm, 7 + 1 + 3);             // ITSM doctrine: cancelled excluded
  assert.equal(r.executed - r.executed_itsm, r.cancelled);
  assert.equal(r.success_pct, Math.round(100 * 7 / 14));
  assert.equal(r.success_pct_itsm, Math.round(100 * 7 / 11));
});

test('nothing executed → both null (nothing to judge), never 0 %', () => {
  const r = rdb._computeSiteChanges([row(''), row('')]);
  assert.equal(r.success_pct, null); assert.equal(r.success_pct_itsm, null);
});

test('both definitions are in the dictionary as DRAFT, side by side, tied to decision D-01', () => {
  const deck = SEED.find((m) => m.key === 'changes.success_pct_deck');
  const itsm = SEED.find((m) => m.key === 'changes.success_pct_itsm');
  for (const m of [deck, itsm]) { assert.ok(m, 'registered'); assert.match(m.status, /^draft/); assert.equal(m.decision, 'D-01'); assert.match(m.certification, /not certified/); }
  assert.equal(deck.reader, itsm.reader, 'same reader — one classifier, two denominators');
});

test('the disputed programme scores say they are not certified until D-01..D-03', () => {
  for (const k of ['programme.site_score', 'programme.composite']) {
    const m = SEED.find((x) => x.key === k);
    assert.equal(m.decision, 'D-01/D-02/D-03'); assert.match(m.certification, /not certified/);
  }
});
