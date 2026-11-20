'use strict';
// N-R4-1 (P11 round 4, security): the Policy Center four-eyes rule must not let ONE super_admin relax a hardened
// security rule by "resetting to the default" when that default is the weaker value. Each four-eyes key names its
// stricter value (strict_value) or direction (strict_direction) in docs/ops/policy-catalogue.json; a change is
// immediate only TOWARDS it; anything else — reset to a weak default included — needs a second super_admin; a
// four-eyes key that names neither always needs a second super_admin (fail closed).
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../tools/agent/policy-catalogue');
const PC = require('../services/policyCatalogue');
const RC = require('../services/reportConfig');

const by = () => PC.build({ fresh: true }).by;

test('relaxing to a WEAK code default needs a second person (dashkey, dash-key injection, exports, throttle, two-person delete)', () => {
  const b = by();
  const cases = [
    ['dashkey_scope_mode', 'restrict', 'open'],
    ['dashkey_scope_mode', 'restrict', 'shadow'],
    ['ui_inject_dash_key', '0', '1'],
    ['export_policy_strict', '1', '0'],
    ['auth_account_throttle_enabled', '1', '0'],
    ['authz_capability_mode', 'enforce', 'off'],
    ['access_require_approval', '1', '0'],
    ['soft_delete_two_person', '1', '0'],
    ['breakglass_timebox_enabled', '1', '0'],
  ];
  for (const [k, cur, next] of cases) {
    assert.strictEqual(String(RC.DEFAULTS[k]) === next || k === 'dashkey_scope_mode', true, `${k}: case targets the weak side`);
    assert.strictEqual(PC.needsSecondPerson(b.get(k), cur, next), true, `${k} ${cur}→${next} must need a second super_admin`);
  }
});

test('hardening towards the stricter value stays immediate', () => {
  const b = by();
  assert.strictEqual(PC.needsSecondPerson(b.get('dashkey_scope_mode'), 'open', 'restrict'), false);
  assert.strictEqual(PC.needsSecondPerson(b.get('ui_inject_dash_key'), '1', '0'), false);
  assert.strictEqual(PC.needsSecondPerson(b.get('export_policy_strict'), '0', '1'), false);
  assert.strictEqual(PC.needsSecondPerson(b.get('hygiene_send_enabled'), '1', '0'), false, 'disarming an outbound send');
  assert.strictEqual(PC.needsSecondPerson(b.get('hygiene_send_enabled'), '0', '1'), true, 'arming an outbound send');
  assert.strictEqual(PC.needsSecondPerson(b.get('auth_pbkdf2_iterations'), '100000', '200000'), false, 'higher = stricter');
  assert.strictEqual(PC.needsSecondPerson(b.get('auth_pbkdf2_iterations'), '200000', '100000'), true, 'back down to the default is relaxing');
  assert.strictEqual(PC.needsSecondPerson(b.get('breakglass_session_minutes'), '60', '30'), false, 'lower = stricter');
  assert.strictEqual(PC.needsSecondPerson(b.get('breakglass_session_minutes'), '30', '60'), true);
});

test('a four-eyes key whose stricter side is unknown always needs a second person (fail closed)', () => {
  const b = by();
  const e = b.get('xof_usd_rate');
  assert.strictEqual(e.four_eyes, true); assert.strictEqual(e.strict_value, null); assert.strictEqual(e.strict_direction, null);
  assert.strictEqual(PC.needsSecondPerson(e, '0.002', String(RC.DEFAULTS.xof_usd_rate)), true, 'reset to default is not assumed safe');
  assert.strictEqual(PC.needsSecondPerson(e, String(RC.DEFAULTS.xof_usd_rate), '0.002'), true);
  assert.strictEqual(e.four_eyes_rule, 'second_person_always');
  assert.strictEqual(b.get('dashkey_scope_mode').four_eyes_rule, 'towards_strict');
  assert.strictEqual(PC.needsSecondPerson(b.get('ui_week_labels'), 'legacy', 'explicit'), false, 'not a four-eyes rule');
});

test('catalogue check refuses a strict marker on a non-four-eyes key, an unknown direction, or a value outside allowed', () => {
  assert.deepStrictEqual(T.check(T.readFile()).badStrict, []);
  const cat = T.readFile();
  cat.keys.ui_week_labels = { ...cat.keys.ui_week_labels, strict_value: 'legacy' };
  cat.keys.dashkey_scope_mode = { ...cat.keys.dashkey_scope_mode, strict_value: 'closed' };
  cat.keys.auth_pbkdf2_iterations = { ...cat.keys.auth_pbkdf2_iterations, strict_direction: 'up' };
  assert.deepStrictEqual(T.check(cat).badStrict.sort(), ['auth_pbkdf2_iterations', 'dashkey_scope_mode', 'ui_week_labels']);
});
