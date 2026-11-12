'use strict';
// W1-INTEGRITY — a tracker whose scoring fails stays on the governance agenda as NOT MEASURED (null + reason),
// it is never dropped silently (W0 engine matrix: routes/governance.js:138 quiet catch).
const { test } = require('node:test');
const assert = require('node:assert');
const { trackerFacts } = require('../services/trackerFacts');

test('a scoring error yields a not-measured row with a reason and the correlation id; others are unchanged', async () => {
  const trackers = [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }, { key: 'c', name: 'C' }, { key: 'd', name: 'D' }];
  const score = async (k) => {
    if (k === 'b') throw new Error('boom');
    if (k === 'c') return null;
    if (k === 'd') return { units: {}, fleet: { mean: null } };
    return { units: { HGO: { score: 0.8, rag: 'GREEN' } }, fleet: { mean: 0.5 } };
  };
  const out = await trackerFacts(trackers, { score, unitCode: 'HGO', rag: () => 'AMBER', onError: () => 'cid-1' });
  assert.equal(out.length, 4, 'nothing is dropped');
  assert.deepEqual(out[0], { key: 'a', name: 'A', score: 0.8, rag: 'GREEN' });
  assert.deepEqual(out[1], { key: 'b', name: 'B', score: null, rag: 'NA', not_measured: true, reason: 'scoring_failed', correlation_id: 'cid-1' });
  assert.equal(out[2].score, null); assert.equal(out[2].reason, 'no_score');
  assert.equal(out[3].score, null, 'an unknown fleet mean is null, never 0'); assert.equal(out[3].rag, 'NA');
  const fleet = await trackerFacts([{ key: 'a', name: 'A' }], { score, rag: () => 'AMBER' });
  assert.deepEqual(fleet[0], { key: 'a', name: 'A', score: 0.5, rag: 'AMBER' });
});

test('the governance route uses it (no quiet catch around scoreTracker any more)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'governance.js'), 'utf8');
  assert.ok(src.includes("require('../services/trackerFacts')"));
  assert.ok(!/scoreTracker\(t\.key\);[^\n]*catch \(_\) \{\}/.test(src));
});
