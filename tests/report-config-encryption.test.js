'use strict';
// A-13 (audit 2026-09-24) — the secrets stop travelling in database dumps.
//
// What this pins is the behaviour at the storage boundary, because that is where the risk
// lives: what a `pg_dump` (or a restore point) actually contains.
const os = require('os'), fs = require('fs'), path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'rcfg-enc-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'rcfg-enc-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'rcfg-enc-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const cfg = require('../services/reportConfig');

const freshDb = () => new Database(':memory:');
const stored = (db, key) => {
  const r = db.prepare('SELECT value FROM report_config WHERE key=?').get(key);
  return r ? r.value : null;
};
const KEY = 'a-test-passphrase-that-is-long-enough';

test('with NO key: stored exactly as today — an install without a key is untouched', () => {
  const db = freshDb();
  cfg.setConfig(db, { smtp_pass: 'hunter2', smtp_host: 'smtp.example.com' }, 'test', { key: null });
  assert.strictEqual(stored(db, 'smtp_pass'), 'hunter2', 'plaintext, as before');
  assert.strictEqual(cfg.getConfig(db, { key: null }).smtp_pass, 'hunter2');
});

test('with a key: the database no longer contains the secret', () => {
  const db = freshDb();
  cfg.setConfig(db, { smtp_pass: 'hunter2' }, 'test', { key: KEY });
  const raw = stored(db, 'smtp_pass');
  assert.ok(!raw.includes('hunter2'), 'a dump of this table is now useless on its own');
  assert.ok(raw.startsWith('enc:v1:'));
  assert.strictEqual(cfg.getConfig(db, { key: KEY }).smtp_pass, 'hunter2', 'and the app still reads it');
});

test('only the secret-shaped keys are encrypted — the rest stay legible', () => {
  const db = freshDb();
  cfg.setConfig(db, { smtp_pass: 'hunter2', smtp_host: 'smtp.example.com', smtp_port: '587' }, 'test', { key: KEY });
  assert.strictEqual(stored(db, 'smtp_host'), 'smtp.example.com', 'a host is not a secret');
  assert.strictEqual(stored(db, 'smtp_port'), '587');
});

test('every key in _SECRET_BLANK_KEEP is covered — a new secret cannot be forgotten', () => {
  const db = freshDb();
  const patch = {};
  for (const k of cfg._SECRET_BLANK_KEEP) patch[k] = 'value-of-' + k;
  cfg.setConfig(db, patch, 'test', { key: KEY });
  for (const k of cfg._SECRET_BLANK_KEEP) {
    const raw = stored(db, k);
    assert.ok(raw && raw.startsWith('enc:v1:'), `${k} must be encrypted at rest`);
    assert.ok(!raw.includes('value-of-'), `${k} must not contain its own plaintext`);
  }
});

test('a value written BEFORE the key existed still reads — no flag day', () => {
  const db = freshDb();
  cfg.setConfig(db, { smtp_pass: 'legacy-plain' }, 'test', { key: null });   // yesterday
  assert.strictEqual(cfg.getConfig(db, { key: KEY }).smtp_pass, 'legacy-plain',
    'the key appears and the old value keeps working; it encrypts on the next save');
});

test('an encrypted value with NO key reads as empty, never as ciphertext', () => {
  const db = freshDb();
  cfg.setConfig(db, { smtp_pass: 'hunter2' }, 'test', { key: KEY });
  const out = cfg.getConfig(db, { key: null });
  assert.strictEqual(out.smtp_pass, '', 'nodemailer must not authenticate with a box');
  assert.ok(!String(out.smtp_pass).includes('enc:v1:'));
});

test('blank-keep still wins: saving a blank secret does not wipe the encrypted one', () => {
  const db = freshDb();
  cfg.setConfig(db, { smtp_pass: 'hunter2' }, 'test', { key: KEY });
  cfg.setConfig(db, { smtp_pass: '', smtp_host: 'h2' }, 'test', { key: KEY });
  assert.strictEqual(cfg.getConfig(db, { key: KEY }).smtp_pass, 'hunter2');
  assert.strictEqual(cfg.getConfig(db, { key: KEY }).smtp_host, 'h2');
});

test('the key is read from the environment when none is passed', () => {
  const db = freshDb();
  const prev = process.env.SDP_CONFIG_KEY;
  process.env.SDP_CONFIG_KEY = KEY;
  try {
    cfg.setConfig(db, { smtp_pass: 'from-env' }, 'test');
    assert.ok(stored(db, 'smtp_pass').startsWith('enc:v1:'));
    assert.strictEqual(cfg.getConfig(db).smtp_pass, 'from-env');
  } finally {
    if (prev === undefined) delete process.env.SDP_CONFIG_KEY; else process.env.SDP_CONFIG_KEY = prev;
  }
});
