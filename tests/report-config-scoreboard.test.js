'use strict';
// The scheduled scoreboard email is armed-OFF by default. Its arm flag lives in
// reportConfig.DEFAULTS (so setConfig's KEYS filter accepts the admin's write).
// There is NO scoreboard_recipients key — recipients come from the coordinator
// directory, not report_config.
const test = require('node:test');
const assert = require('node:assert');
const { DEFAULTS, KEYS } = require('../services/reportConfig');

test('scoreboard_send_enabled defaults to OFF', () => {
  assert.strictEqual(DEFAULTS.scoreboard_send_enabled, '0');
});

test('scoreboard_send_enabled is a persistable config KEY', () => {
  assert.ok(KEYS.includes('scoreboard_send_enabled'));
});

test('there is NO scoreboard_recipients key (directory-driven)', () => {
  assert.ok(!('scoreboard_recipients' in DEFAULTS));
});
