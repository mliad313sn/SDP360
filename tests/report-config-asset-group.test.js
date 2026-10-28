'use strict';
// Assets reports integration, Task 3 — the two "Assets — Groupe" digest keys must
// be part of DEFAULTS so setConfig's KEYS filter accepts them (otherwise the admin
// card's writes are silently dropped and the scheduled digest is permanently inert).
// Mirrors tests/report-config-hygiene.test.js.
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../services/reportConfig');

async function freshDb() { return require('./_pg-fresh').fresh(['report_config']); }

test('asset_group keys are in DEFAULTS (armed-off by default)', () => {
  assert.strictEqual(cfg.DEFAULTS.asset_group_recipients, '');
  assert.strictEqual(cfg.DEFAULTS.asset_group_send_enabled, '0');
  assert.ok(cfg.KEYS.includes('asset_group_recipients'), 'KEYS must include it or setConfig drops the write');
  assert.ok(cfg.KEYS.includes('asset_group_send_enabled'), 'KEYS must include it or setConfig drops the write');
});

test('setConfig round-trips asset_group_recipients + asset_group_send_enabled', async () => {
  const db = (await freshDb());
  (await cfg.setConfig(db, { asset_group_recipients: 'mgmt@x.com', asset_group_send_enabled: '1' }, 'u'));
  const all = (await cfg.getConfig(db));
  assert.strictEqual(all.asset_group_recipients, 'mgmt@x.com');
  assert.strictEqual(all.asset_group_send_enabled, '1');
});
