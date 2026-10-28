'use strict';
// Sub-project B, Task 5 — the two hygiene keys must be part of DEFAULTS so
// setConfig's KEYS filter accepts them (otherwise the admin card's writes are
// silently dropped and the digest is permanently inert).
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../services/reportConfig');

async function freshDb() { return require('./_pg-fresh').fresh(['report_config']); }

test('hygiene keys are in DEFAULTS (armed-off by default)', () => {
  assert.strictEqual(cfg.DEFAULTS.hygiene_recipients, '');
  assert.strictEqual(cfg.DEFAULTS.hygiene_send_enabled, '0');
});

test('setConfig round-trips hygiene_recipients + hygiene_send_enabled', async () => {
  const db = (await freshDb());
  (await cfg.setConfig(db, { hygiene_recipients: 'a@x.com', hygiene_send_enabled: '1' }, 'u'));
  const all = (await cfg.getConfig(db));
  assert.strictEqual(all.hygiene_recipients, 'a@x.com');
  assert.strictEqual(all.hygiene_send_enabled, '1');
});
