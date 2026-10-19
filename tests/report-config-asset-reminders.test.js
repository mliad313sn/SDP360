'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const cfg = require('../services/reportConfig');
function freshDb() { const db = new Database(':memory:'); cfg._initSchema(db); return db; }

test('asset reminder keys are in DEFAULTS, armed OFF', () => {
  assert.strictEqual(cfg.DEFAULTS.asset_reminder_send_enabled, '0');
  assert.strictEqual(cfg.DEFAULTS.asset_new_alert_enabled, '0');
});
test('setConfig round-trips both keys (else the admin write is silently dropped)', () => {
  const db = freshDb();
  cfg.setConfig(db, { asset_reminder_send_enabled: '1', asset_new_alert_enabled: '1' }, 'u');
  const all = cfg.getConfig(db);
  assert.deepStrictEqual([all.asset_reminder_send_enabled, all.asset_new_alert_enabled], ['1', '1']);
});
