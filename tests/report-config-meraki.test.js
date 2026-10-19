'use strict';
// V1b-A Task 1 — meraki config keys in DEFAULTS + secret blank-keep membership.
const { test } = require('node:test');
const assert = require('node:assert');
const rc = require('../services/reportConfig');

test('meraki config keys are in DEFAULTS', () => {
  for (const k of ['meraki_api_key', 'meraki_org_id', 'meraki_base_url', 'meraki_missing_policy']) {
    assert.ok(Object.prototype.hasOwnProperty.call(rc.DEFAULTS, k), `${k} missing from DEFAULTS`);
  }
  assert.equal(rc.DEFAULTS.meraki_base_url, 'https://api.meraki.com/api/v1');
  assert.equal(rc.DEFAULTS.meraki_api_key, '');
  assert.equal(rc.DEFAULTS.meraki_missing_policy, 'down');   // calibration may flip to 'unknown'
});

test('meraki_api_key is blank-kept on save (empty value keeps the stored secret)', () => {
  assert.ok(rc._SECRET_BLANK_KEEP instanceof Set, '_SECRET_BLANK_KEEP is an exported Set');
  assert.ok(rc._SECRET_BLANK_KEEP.has('meraki_api_key'), 'meraki_api_key must be blank-kept like smtp_pass');
  // existing secrets still covered
  for (const k of ['smtp_pass', 'entra_client_secret', 'meridian_out_key', 'meridian_in_key']) {
    assert.ok(rc._SECRET_BLANK_KEEP.has(k), `${k} still blank-kept`);
  }
});
