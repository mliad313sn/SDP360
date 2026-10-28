'use strict';
// Asset Depreciation Task 1 — asset_depreciation_config must be in DEFAULTS so
// setConfig's KEYS filter accepts it (otherwise the admin card's policy write is
// silently dropped and the depreciation reader falls back to the default config
// with no error). The stored value is a JSON blob parsed by
// depreciation.parseDepreciationConfig at read time.
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../services/reportConfig');
const { DEFAULT_DEPRECIATION_CONFIG, parseDepreciationConfig } = require('../services/depreciation');

async function freshDb() { return require('./_pg-fresh').fresh(['report_config']); }

test('asset_depreciation_config default is the DEFAULT_DEPRECIATION_CONFIG JSON', () => {
  assert.strictEqual(
    cfg.DEFAULTS.asset_depreciation_config,
    JSON.stringify(DEFAULT_DEPRECIATION_CONFIG));
  // and it parses back to the same object
  assert.deepStrictEqual(
    parseDepreciationConfig(cfg.DEFAULTS.asset_depreciation_config),
    DEFAULT_DEPRECIATION_CONFIG);
});

test('setConfig round-trips a custom asset_depreciation_config', async () => {
  const db = (await freshDb());
  const custom = { default: { method: 'straight_line', useful_life_months: 36, salvage_pct: 0 }, by_type: {} };
  (await cfg.setConfig(db, { asset_depreciation_config: JSON.stringify(custom) }, 'u'));
  const all = (await cfg.getConfig(db));
  assert.deepStrictEqual(JSON.parse(all.asset_depreciation_config), custom);
});
