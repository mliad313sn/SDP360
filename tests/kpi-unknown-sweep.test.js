'use strict';
// P08 §5 — ratchet: every server-side `|| 0` / `?? 0` / `COALESCE(…, 0)` is justified by a rule of
// tools/kpi/unknown-sweep.js or by a reviewed note in docs/agent-execution/P08-unknown-sweep.json.
// A NEW hit fails here until it is classified (or fixed): unknown is never silently 0.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../tools/kpi/unknown-sweep');

test('no unjustified unknown→0 in readers / composers', () => {
  const r = S.check();
  assert.ok(!r.baselineMissing, `reviewed baseline file is missing: ${r.baseline} — restore it; the hits below are not a code regression`);
  assert.ok(r.hits.length > 100, 'the scan must actually find the known hits (scope not empty)');
  assert.deepEqual(r.unjustified.map((h) => `${h.file}:${h.line} ${h.text}`), []);
  const todo = r.hits.filter((h) => !h.rule && r.reviewed[h.key] && r.reviewed[h.key].verdict === 'TODO');
  assert.deepEqual(todo.map((h) => `${h.file}:${h.line}`), [], 'baseline entries still marked TODO');
});

test('a ratio / score line is never auto-justified by a rule', () => {
  assert.equal(S.classify('  const pct = total ? x / total : 0; out.score = s || 0;', 'services/x.js'), null);
  assert.equal(S.classify('    m.set(k, (m.get(k) || 0) + 1);', 'services/x.js').id, 'tally');
  assert.equal(S.classify('  // keep `|| 0` out of verdicts', 'services/x.js').id, 'comment');
});

test('the defects fixed by the sweep stay fixed (signoff_pct null when no PV)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'meetings-db.js'), 'utf8');
  assert.match(src, /signoff_pct:[^\n]*\* 100\) : null,/);
});
