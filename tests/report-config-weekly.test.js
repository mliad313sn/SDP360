'use strict';
// Weekly-report email, Task 5 — the arm flag must be part of DEFAULTS so
// setConfig's KEYS filter accepts it. A key absent from DEFAULTS is SILENTLY
// dropped by setConfig (services/reportConfig.js:66), so the admin's save
// appears to work, nothing persists, and the scheduled send is permanently
// inert with no error anywhere. The round-trip test is what proves the key
// actually reached DEFAULTS — the assertion on DEFAULTS alone would not.
//
// There is deliberately NO weekly_report_recipients key: recipients come from
// the coordinator directory (report_recipients), same as the scoreboard.
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../services/reportConfig');

async function freshDb() { return require('./_pg-fresh').fresh(['report_config']); }

test('weekly_report_send_enabled is in DEFAULTS and armed OFF', () => {
  assert.strictEqual(cfg.DEFAULTS.weekly_report_send_enabled, '0');
  assert.ok(cfg.KEYS.includes('weekly_report_send_enabled'), 'KEYS derives from DEFAULTS');
});

test('getConfig on an empty DB reports the key as disarmed', async () => {
  const db = (await freshDb());
  assert.strictEqual((await cfg.getConfig(db)).weekly_report_send_enabled, '0');
});

test('setConfig PERSISTS weekly_report_send_enabled (proves it passed the KEYS filter)', async () => {
  const db = (await freshDb());
  (await cfg.setConfig(db, { weekly_report_send_enabled: '1' }, 'u'));
  assert.strictEqual((await cfg.getConfig(db)).weekly_report_send_enabled, '1',
    'a key missing from DEFAULTS would be silently dropped and still read "0" here');

  // ...and back off again, so the admin can disarm.
  (await cfg.setConfig(db, { weekly_report_send_enabled: '0' }, 'u'));
  assert.strictEqual((await cfg.getConfig(db)).weekly_report_send_enabled, '0');
});

test('adding the key did not disturb the neighbouring arm flags', () => {
  assert.strictEqual(cfg.DEFAULTS.scoreboard_send_enabled, '0');
  assert.strictEqual(cfg.DEFAULTS.hygiene_send_enabled, '0');
});
