'use strict';
// E-A07 — switch prerequisites are plain-word WARNINGS (data), never a block and never an approval.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../services/switchPrereqs');

test('the audit §7.1 switches carry a prerequisite', () => {
  for (const k of ['site_code_shared_block', 'kpi_policy_enforced', 'alert_external_enabled', 'handoff_notify_enabled', 'authz_capability_mode', 'field_outbox_resolve_enabled']) {
    assert.ok(P.textFor(k), k);
  }
  assert.equal(P.textFor('smtp_host'), null);
});

test('warnings only for the switched-on value, and only when it changes', () => {
  assert.deepEqual(P.warningsFor({ site_code_shared_block: '0' }, { site_code_shared_block: '1' }), [], 'back to today never warns');
  assert.equal(P.warningsFor({ site_code_shared_block: '1' }, { site_code_shared_block: '0' }).length, 1);
  assert.deepEqual(P.warningsFor({ site_code_shared_block: '1' }, { site_code_shared_block: '1' }), [], 'unchanged → no warning');
  assert.equal(P.warningsFor({ authz_capability_mode: 'shadow' }, {}).length, 0);
  const w = P.warningsFor({ authz_capability_mode: 'enforce' }, { authz_capability_mode: 'shadow' });
  assert.equal(w.length, 1); assert.equal(w[0].key, 'authz_capability_mode'); assert.match(w[0].prerequisite, /shadow/);
});

test('no prerequisite text names an owner or claims an approval', () => {
  for (const [k, p] of Object.entries(P.PREREQS)) assert.ok(!/\bapproved\b|signed off/i.test(p.text), k);
});
