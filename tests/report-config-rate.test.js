'use strict';
// Task 0 — xof_usd_rate must be part of DEFAULTS so setConfig's KEYS filter
// accepts it (otherwise the admin card's rate write is silently dropped and the
// Finance surfaces fall back to the default rate with no error).
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../services/reportConfig');

async function freshDb() { return require('./_pg-fresh').fresh(['report_config']); }

test('xof_usd_rate is in DEFAULTS', () => {
  assert.strictEqual(cfg.DEFAULTS.xof_usd_rate, '0.00165');
});

test('setConfig round-trips xof_usd_rate', async () => {
  const db = (await freshDb());
  (await cfg.setConfig(db, { xof_usd_rate: '0.0017' }, 'u'));
  const all = (await cfg.getConfig(db));
  assert.strictEqual(all.xof_usd_rate, '0.0017');
});
