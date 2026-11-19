'use strict';
// P03 step 7 — a switch left ON in the pilot longer than N days without a keep or removal decision fails this test.
// N belongs to the owner (docs/ops/switch-lots.json expiry.max_days_on_without_decision); while it is unset the
// check is NOT armed and says so. The pure check is proven on fixtures so arming it later needs no new code.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { expiryViolations } = require('../tools/agent/switch-lots');

const ROOT = path.join(__dirname, '..');

test('pure check: fails past N days, passes with a keep/remove decision, unarmed when N is unset', () => {
  const items = {
    a: { pilot_on_since: '2026-01-01' },
    b: { pilot_on_since: '2026-01-01', lifecycle_decision: 'keep' },
    c: { pilot_on_since: '2026-11-10' },
    d: { pilot_on_since: 'soon' },
    e: { owner: 'x' },
  };
  const v = expiryViolations(items, 30, '2026-11-19');
  assert.deepEqual(v.map((x) => x.key), ['a', 'd']);
  assert.equal(v[0].days, 322);
  assert.deepEqual(expiryViolations(items, null, '2026-11-19'), []);
  assert.deepEqual(expiryViolations(items, '', '2026-11-19'), []);
  assert.deepEqual(expiryViolations({ c: items.c }, 5, '2026-11-19').map((x) => x.key), ['c']);
});

test('the pilot has no switch past its expiry without a decision', (t) => {
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/ops/switch-lots.json'), 'utf8'));
  const side = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/ops/flag-decisions.json'), 'utf8'));
  const n = plan.expiry ? plan.expiry.max_days_on_without_decision : null;
  if (n == null) t.diagnostic('expiry not armed: the owner has not set expiry.max_days_on_without_decision');
  const today = new Date().toISOString().slice(0, 10);
  const v = expiryViolations(side.items, n, today);
  assert.deepEqual(v, [], v.map((x) => `${x.key}: ${x.reason}`).join('; '));
});
