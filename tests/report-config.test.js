'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../services/reportConfig');

async function freshDb() { return require('./_pg-fresh').fresh(['report_config']); }

test('defaults returned when unset', async () => {
  const db = (await freshDb());
  const all = (await cfg.getConfig(db));
  assert.strictEqual(all.transport, 'smtp');
  assert.strictEqual(all.never_send_unconfirmed, '1');
});

test('set then get a value round-trips', async () => {
  const db = (await freshDb());
  (await cfg.setConfig(db, { smtp_host: 'mail.edv-ops.com', from: 'it-reports@edv-ops.com' }, 'azize'));
  const all = (await cfg.getConfig(db));
  assert.strictEqual(all.smtp_host, 'mail.edv-ops.com');
  assert.strictEqual(all.from, 'it-reports@edv-ops.com');
});

test('setConfig only writes known keys (ignores junk)', async () => {
  const db = (await freshDb());
  (await cfg.setConfig(db, { smtp_host: 'x', not_a_key: 'y' }, 'azize'));
  const all = (await cfg.getConfig(db));
  assert.strictEqual(all.smtp_host, 'x');
  assert.strictEqual(all.not_a_key, undefined);
});

test('blank smtp_pass does NOT overwrite a previously-set password', async () => {
  const db = (await freshDb());
  (await cfg.setConfig(db, { smtp_pass: 's3cret' }, 'azize'));
  assert.strictEqual((await cfg.getConfig(db)).smtp_pass, 's3cret');
  // Simulate a Save that round-trips the redacted (blank) password + a real edit.
  (await cfg.setConfig(db, { smtp_pass: '', smtp_host: 'mail.edv-ops.com' }, 'azize'));
  const all = (await cfg.getConfig(db));
  assert.strictEqual(all.smtp_pass, 's3cret');          // preserved
  assert.strictEqual(all.smtp_host, 'mail.edv-ops.com'); // other edits applied
});
