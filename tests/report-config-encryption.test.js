'use strict';
// A-13 (audit 2026-09-24) — the secrets stop travelling in database dumps.
//
// What this pins is the behaviour at the storage boundary, because that is where the risk
// lives: what a `pg_dump` (or a restore point) actually contains.
const os = require('os'), fs = require('fs'), path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'rcfg-enc-'));
process.env.DASH_USER = process.env.DASH_USER || 'rcfg-enc-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'rcfg-enc-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const cfg = require('../services/reportConfig');

const freshDb = () => require('./_pg-fresh').fresh(['report_config']);
const stored = async (db, key) => {
  const r = (await db.prepare('SELECT value FROM report_config WHERE key=?').get(key));
  return r ? r.value : null;
};
const KEY = 'a-test-passphrase-that-is-long-enough';

test('with NO key: stored exactly as today — an install without a key is untouched', async () => {
  const db = await freshDb();
  (await cfg.setConfig(db, { smtp_pass: 'hunter2', smtp_host: 'smtp.example.com' }, 'test', { key: null }));
  assert.strictEqual((await stored(db, 'smtp_pass')), 'hunter2', 'plaintext, as before');
  assert.strictEqual((await cfg.getConfig(db, { key: null })).smtp_pass, 'hunter2');
});

test('with a key: the database no longer contains the secret', async () => {
  const db = await freshDb();
  (await cfg.setConfig(db, { smtp_pass: 'hunter2' }, 'test', { key: KEY }));
  const raw = (await stored(db, 'smtp_pass'));
  assert.ok(!raw.includes('hunter2'), 'a dump of this table is now useless on its own');
  assert.ok(raw.startsWith('enc:v2:'));
  assert.strictEqual((await cfg.getConfig(db, { key: KEY })).smtp_pass, 'hunter2', 'and the app still reads it');
});

test('only the secret-shaped keys are encrypted — the rest stay legible', async () => {
  const db = await freshDb();
  (await cfg.setConfig(db, { smtp_pass: 'hunter2', smtp_host: 'smtp.example.com', smtp_port: '587' }, 'test', { key: KEY }));
  assert.strictEqual((await stored(db, 'smtp_host')), 'smtp.example.com', 'a host is not a secret');
  assert.strictEqual((await stored(db, 'smtp_port')), '587');
});

test('every key in _SECRET_BLANK_KEEP is covered — a new secret cannot be forgotten', async () => {
  const db = await freshDb();
  const patch = {};
  for (const k of cfg._SECRET_BLANK_KEEP) patch[k] = 'value-of-' + k;
  (await cfg.setConfig(db, patch, 'test', { key: KEY }));
  for (const k of cfg._SECRET_BLANK_KEEP) {
    const raw = (await stored(db, k));
    assert.ok(raw && raw.startsWith('enc:v2:'), `${k} must be encrypted at rest`);
    assert.ok(!raw.includes('value-of-'), `${k} must not contain its own plaintext`);
  }
});

test('a value written BEFORE the key existed still reads — no flag day', async () => {
  const db = await freshDb();
  (await cfg.setConfig(db, { smtp_pass: 'legacy-plain' }, 'test', { key: null }));   // yesterday
  assert.strictEqual((await cfg.getConfig(db, { key: KEY })).smtp_pass, 'legacy-plain',
    'the key appears and the old value keeps working; it encrypts on the next save');
});

test('an encrypted value with NO key reads as empty, never as ciphertext', async () => {
  const db = await freshDb();
  (await cfg.setConfig(db, { smtp_pass: 'hunter2' }, 'test', { key: KEY }));
  const out = (await cfg.getConfig(db, { key: null }));
  assert.strictEqual(out.smtp_pass, '', 'nodemailer must not authenticate with a box');
  assert.ok(!String(out.smtp_pass).includes('enc:v'));
});

test('blank-keep still wins: saving a blank secret does not wipe the encrypted one', async () => {
  const db = await freshDb();
  (await cfg.setConfig(db, { smtp_pass: 'hunter2' }, 'test', { key: KEY }));
  (await cfg.setConfig(db, { smtp_pass: '', smtp_host: 'h2' }, 'test', { key: KEY }));
  assert.strictEqual((await cfg.getConfig(db, { key: KEY })).smtp_pass, 'hunter2');
  assert.strictEqual((await cfg.getConfig(db, { key: KEY })).smtp_host, 'h2');
});

test('the key is read from the environment when none is passed', async () => {
  const db = await freshDb();
  const prev = process.env.SDP_CONFIG_KEY;
  process.env.SDP_CONFIG_KEY = KEY;
  try {
    (await cfg.setConfig(db, { smtp_pass: 'from-env' }, 'test'));
    assert.ok((await stored(db, 'smtp_pass')).startsWith('enc:v2:'));
    assert.strictEqual((await cfg.getConfig(db)).smtp_pass, 'from-env');
  } finally {
    if (prev === undefined) delete process.env.SDP_CONFIG_KEY; else process.env.SDP_CONFIG_KEY = prev;
  }
});

// A-28b — with SDP_CONFIG_BOX_VERSION=3 setConfig writes enc:v3 bound to the key name; getConfig reads it,
// and a box swapped into another key's row reads as empty (never the other key's secret).
test('A-28b: SDP_CONFIG_BOX_VERSION=3 → enc:v3 at rest, read back; a swapped box reads as empty', async () => {
  const db = await freshDb();
  const prev = process.env.SDP_CONFIG_BOX_VERSION;
  process.env.SDP_CONFIG_BOX_VERSION = '3';
  try {
    (await cfg.setConfig(db, { smtp_pass: 'hunter2', meraki_api_key: 'mk-1' }, 'test', { key: KEY }));
  } finally { if (prev === undefined) delete process.env.SDP_CONFIG_BOX_VERSION; else process.env.SDP_CONFIG_BOX_VERSION = prev; }
  const raw = await stored(db, 'smtp_pass');
  assert.ok(raw.startsWith('enc:v3:'), raw.slice(0, 7));
  const c = await cfg.getConfig(db, { key: KEY });
  assert.strictEqual(c.smtp_pass, 'hunter2'); assert.strictEqual(c.meraki_api_key, 'mk-1');
  await db.prepare('UPDATE report_config SET value=? WHERE key=?').run(raw, 'meraki_api_key');
  assert.strictEqual((await cfg.getConfig(db, { key: KEY })).meraki_api_key, '', 'AAD: a box moved to another key does not open');
});
