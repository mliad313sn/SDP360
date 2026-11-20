'use strict';
// Policy Control Center — the catalogue (pure). Completeness against the code: every report_config key and every
// governance policy has a catalogue entry or an exclusion with a reason; adding a key without one fails here.
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../tools/agent/policy-catalogue');
const PC = require('../services/policyCatalogue');
const RC = require('../services/reportConfig');
const GP = require('../services/governancePolicy');

test('every report_config key and governance policy is catalogued or excluded with a reason', () => {
  const r = T.check(T.readFile());
  assert.deepStrictEqual(r.missing, [], 'run node tools/agent/policy-catalogue.js --bootstrap and review the new entries');
  assert.deepStrictEqual(r.stale, []); assert.deepStrictEqual(r.noReason, []); assert.deepStrictEqual(r.badCat, []);
  const c = PC.coverage();
  assert.strictEqual(c.missing.length, 0);
  assert.strictEqual(c.catalogued + c.excluded, RC.KEYS.length + GP.PARAMS.length);
});

test('a new key without a catalogue entry fails the check', () => {
  const src = { RC, GP, rcKeys: [...RC.KEYS, 'brand_new_switch_enabled'], gpParams: GP.PARAMS };
  assert.deepStrictEqual(T.check(T.readFile(), src).missing, ['brand_new_switch_enabled']);
  const cat = T.readFile(); cat.excluded.brand_new_switch_enabled = 'x';
  assert.deepStrictEqual(T.check(cat, src).noReason, ['brand_new_switch_enabled'], 'an exclusion needs a real reason');
});

test('entries are honest: code defaults, PROPOSED recommendations, scopes only where a consumer reads them, secrets read-only', () => {
  const b = PC.build({ fresh: true });
  const e = b.by.get('hygiene_send_enabled');
  assert.strictEqual(e.default, RC.DEFAULTS.hygiene_send_enabled);
  assert.deepStrictEqual(e.scopes, ['global'], 'report_config is read globally only');
  assert.strictEqual(e.four_eyes, true); assert.strictEqual(e.four_eyes_rule, 'away_from_default');
  assert.ok(e.consumers.includes('tools/reports/send-hygiene.js'), 'consumers come from the repository scan');
  for (const x of b.entries) {
    if (x.recommendation) assert.strictEqual(x.recommendation.status, 'PROPOSED', x.key);
    if (x.owner_role) assert.strictEqual(x.owner_role.status, 'PROPOSED', x.key);
    if (x.source === 'report_config') assert.deepStrictEqual(x.scopes, ['global'], x.key);
    assert.ok(b.categories[x.category], x.key + ' has a known category');
  }
  const gp = b.by.get('handoffs.reason_min');
  assert.deepStrictEqual(gp.scopes, ['global', 'site']);
  assert.deepStrictEqual(b.by.get('freshness.helpdesk_hours').scopes, ['global'], 'a source property is global');
  const sec = b.by.get('smtp_pass');
  assert.strictEqual(sec.secret, true); assert.strictEqual(sec.editable, false); assert.strictEqual(sec.default, null);
  assert.ok(b.kpi_policies.length > 0 && b.kpi_policies.every((k) => k.editable === false && k.managed_by === 'kpi-builder.html'));
  assert.strictEqual(b.by.get('wan_poll_last_run'), undefined, 'runtime state is excluded');
});

test('validation: enum, bool, bounds, json, secrets, control characters', () => {
  const b = PC.build();
  assert.strictEqual(PC.validateConfigValue(b.by.get('hygiene_send_enabled'), true), '1');
  assert.throws(() => PC.validateConfigValue(b.by.get('hygiene_send_enabled'), 'yes'), /one of 0, 1/);
  assert.strictEqual(PC.validateConfigValue(b.by.get('site_codes_from_registry'), 'shadow'), 'shadow');
  assert.throws(() => PC.validateConfigValue(b.by.get('sync_truncation_tolerance_pct'), 150), /maximum 100/);
  assert.throws(() => PC.validateConfigValue(b.by.get('sync_truncation_tolerance_pct'), 'abc'), /number/);
  assert.strictEqual(PC.validateConfigValue(b.by.get('sync_truncation_tolerance_pct'), 15), '15');
  assert.throws(() => PC.validateConfigValue(b.by.get('opm_targets'), '{bad'), /JSON/);
  assert.throws(() => PC.validateConfigValue(b.by.get('smtp_pass'), 'x'), /secret/);
  assert.throws(() => PC.validateConfigValue(b.by.get('default_email_domain'), 'a\u0001b'), /control/);
  assert.strictEqual(PC.validateConfigValue(b.by.get('a10_gate_lead_days'), ''), '', 'empty = off where the default is empty');
});

test('four-eyes: only a high-risk report_config change AWAY from the default needs a second person', () => {
  const e = PC.build().by.get('hygiene_send_enabled');
  assert.strictEqual(PC.needsSecondPerson(e, '0', '1'), true);
  assert.strictEqual(PC.needsSecondPerson(e, '1', '0'), false, 'back to the best-practice default is immediate');
  assert.strictEqual(PC.needsSecondPerson(e, '1', '1'), false);
  assert.strictEqual(PC.needsSecondPerson(PC.build().by.get('ui_week_labels'), 'legacy', 'explicit'), false, 'low-risk rule');
});

test('descriptions are read from the reportConfig comments', () => {
  const src = "// ── X\n//    helpdesk_sla_definition: 'flag' (stored Overdue Status) | 'due_vs_resolved'\nDEFAULTS.helpdesk_sla_definition = 'flag';\n  foo_bar: '0',   // inline text here\n";
  assert.match(PC.describeFromSource(src, 'helpdesk_sla_definition'), /stored Overdue Status/);
  assert.strictEqual(PC.describeFromSource(src, 'foo_bar'), 'inline text here');
});
