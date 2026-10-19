'use strict';
// V1a Task 1 — OPManager infra config keys present in DEFAULTS (so setConfig's KEYS
// filter accepts them) + opm_targets is valid JSON.
const { test } = require('node:test');
const assert = require('node:assert');
const cfg = require('../services/reportConfig');

test('OPM config keys are in DEFAULTS + KEYS', () => {
  for (const k of ['opm_availability_view_id', 'opm_targets', 'opm_stale_days']) {
    assert.ok(k in cfg.DEFAULTS, `${k} missing from DEFAULTS`);
    assert.ok(cfg.KEYS.includes(k), `${k} missing from KEYS`);
  }
});

test('opm_targets default is valid JSON with the 4 families', () => {
  const t = JSON.parse(cfg.DEFAULTS.opm_targets);
  for (const f of ['lan', 'wifi', 'wan', 'servers']) assert.equal(typeof t[f], 'number', `${f} target`);
});
