'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const cfg = require('../services/reportConfig');

function freshDb() { const db = new Database(':memory:'); cfg._initSchema(db); return db; }

test('defaults returned when unset', () => {
  const db = freshDb();
  const all = cfg.getConfig(db);
  assert.strictEqual(all.transport, 'smtp');
  assert.strictEqual(all.never_send_unconfirmed, '1');
});

test('set then get a value round-trips', () => {
  const db = freshDb();
  cfg.setConfig(db, { smtp_host: 'mail.edv-ops.com', from: 'it-reports@edv-ops.com' }, 'azize');
  const all = cfg.getConfig(db);
  assert.strictEqual(all.smtp_host, 'mail.edv-ops.com');
  assert.strictEqual(all.from, 'it-reports@edv-ops.com');
});

test('setConfig only writes known keys (ignores junk)', () => {
  const db = freshDb();
  cfg.setConfig(db, { smtp_host: 'x', not_a_key: 'y' }, 'azize');
  const all = cfg.getConfig(db);
  assert.strictEqual(all.smtp_host, 'x');
  assert.strictEqual(all.not_a_key, undefined);
});

test('blank smtp_pass does NOT overwrite a previously-set password', () => {
  const db = freshDb();
  cfg.setConfig(db, { smtp_pass: 's3cret' }, 'azize');
  assert.strictEqual(cfg.getConfig(db).smtp_pass, 's3cret');
  // Simulate a Save that round-trips the redacted (blank) password + a real edit.
  cfg.setConfig(db, { smtp_pass: '', smtp_host: 'mail.edv-ops.com' }, 'azize');
  const all = cfg.getConfig(db);
  assert.strictEqual(all.smtp_pass, 's3cret');          // preserved
  assert.strictEqual(all.smtp_host, 'mail.edv-ops.com'); // other edits applied
});
