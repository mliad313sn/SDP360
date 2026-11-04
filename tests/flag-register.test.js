'use strict';
// C-09 (G33) — docs/ops/FLAG-REGISTER.md is generated from the code and the pilot profile; it must be current
// and it must name every switch the pilot profile names.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const FR = require('../tools/agent/flag-register');

test('FLAG-REGISTER.md is up to date (node tools/agent/flag-register.js)', () => {
  const cur = fs.readFileSync(FR.OUT, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(cur, FR.build());
});

test('every switch named in PILOT-PROFILE.md appears in the register', () => {
  const reg = fs.readFileSync(FR.OUT, 'utf8');
  const { rows, notes } = FR.readProfile(fs.readFileSync(FR.PROFILE, 'utf8'));
  assert.ok(rows.size >= 40, 'profile table parsed');
  for (const k of [...rows.keys(), ...notes]) assert.ok(reg.includes('`' + k + '`'), `${k} missing from FLAG-REGISTER.md`);
  for (const k of ['SDP_CSP_REPORT_ONLY', 'SDP_CONFIG_BOX_VERSION', 'SDP_PDF_SANDBOX', 'governance.skip_inactive_holders']) assert.ok(notes.has(k), `${k} read from the profile notes`);
});

test('every report_config key, governance policy and *_enabled / ui_* switch is listed; secrets are never shown', () => {
  const reg = fs.readFileSync(FR.OUT, 'utf8');
  const { DEFAULTS, _SECRET_BLANK_KEEP } = require('../services/reportConfig');
  const { PARAMS } = require('../services/governancePolicy');
  for (const k of Object.keys(DEFAULTS)) assert.ok(reg.includes('| `' + k + '` |'), k);
  for (const p of PARAMS) assert.ok(reg.includes('| `' + p.key + '` |'), p.key);
  for (const k of _SECRET_BLANK_KEEP) assert.match(reg, new RegExp('\\| `' + k + '` \\| \\(secret — not shown\\)'));
  assert.match(reg, /page_viewed/);
});
