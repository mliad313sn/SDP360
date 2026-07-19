// tests/report-config-uplift.test.js — the investment-forecast replacement-price
// uplift knob MUST be a DEFAULTS key, else setConfig's KEYS filter silently drops
// the admin's write (documented trap). Mirrors tests/report-config-rate.test.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const rc = require('../services/reportConfig');

test('asset_replacement_uplift_pct is a DEFAULTS key (default 0)', () => {
  assert.strictEqual(rc.DEFAULTS.asset_replacement_uplift_pct, '0');
  assert.ok(rc.KEYS.includes('asset_replacement_uplift_pct'),
    'KEYS (=Object.keys(DEFAULTS)) must include it or setConfig drops the write');
});
