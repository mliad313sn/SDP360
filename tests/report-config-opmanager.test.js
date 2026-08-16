'use strict';
// V1b-B Task 1 — OpManager REST config keys in DEFAULTS + secret blank-keep.
const { test } = require('node:test');
const assert = require('node:assert');
const rc = require('../services/reportConfig');

test('opmanager REST config keys are in DEFAULTS', () => {
  for (const k of ['opmanager_base_url', 'opmanager_api_key', 'opmanager_tls_insecure']) {
    assert.ok(Object.prototype.hasOwnProperty.call(rc.DEFAULTS, k), `${k} missing from DEFAULTS`);
  }
  assert.equal(rc.DEFAULTS.opmanager_api_key, '');
  assert.equal(rc.DEFAULTS.opmanager_tls_insecure, '1');
});

test('opmanager_api_key is blank-kept on save (secret)', () => {
  assert.ok(rc._SECRET_BLANK_KEEP.has('opmanager_api_key'), 'opmanager_api_key must be blank-kept');
});
