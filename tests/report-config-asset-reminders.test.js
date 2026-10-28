'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../services/reportConfig');
async function freshDb() { return require('./_pg-fresh').fresh(['report_config']); }

test('asset reminder keys are in DEFAULTS, armed OFF', () => {
  assert.strictEqual(cfg.DEFAULTS.asset_reminder_send_enabled, '0');
  assert.strictEqual(cfg.DEFAULTS.asset_new_alert_enabled, '0');
});
test('setConfig round-trips both keys (else the admin write is silently dropped)', async () => {
  const db = (await freshDb());
  (await cfg.setConfig(db, { asset_reminder_send_enabled: '1', asset_new_alert_enabled: '1' }, 'u'));
  const all = (await cfg.getConfig(db));
  assert.deepStrictEqual([all.asset_reminder_send_enabled, all.asset_new_alert_enabled], ['1', '1']);
});
