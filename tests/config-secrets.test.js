'use strict';
// A-13 (audit 2026-09-24) — the residual risk the virtual PO could not accept.
//
// The six secret-shaped config values (smtp_pass, entra_client_secret, the two Meridian
// keys, meraki_api_key, opmanager_api_key) are redacted on GET and blank-kept on save,
// but they sit in `report_config` as plain text — so every pg_dump carries them, and a
// restore point is a file that hands someone the SSO client secret. That was accepted
// knowingly ("Option A"), which is why the AMDEC line stayed open at S=10.
//
// This closes it WITHOUT breaking an install that has no key: with SDP_CONFIG_KEY unset,
// everything behaves exactly as before. With a key, the value stored in the database is
// ciphertext, and a dump on its own is useless.
//
// The failure that matters most is the quiet one: an encrypted value with no key must
// NEVER be handed back as if it were the password. nodemailer authenticating with
// ciphertext would fail with a meaningless error at 07:00 on a Monday.
const test = require('node:test');
const assert = require('node:assert');
const { encryptValue, decryptValue, isEncrypted, keyFrom } = require('../services/configSecrets');

const KEY = keyFrom('a-test-passphrase-that-is-long-enough');

test('round-trips a value', () => {
  const box = encryptValue('hunter2', KEY);
  assert.strictEqual(decryptValue(box, KEY), 'hunter2');
});

test('the stored form does not contain the secret, and is recognisable', () => {
  const box = encryptValue('hunter2', KEY);
  assert.ok(!box.includes('hunter2'), 'that is the entire point of the change');
  assert.ok(isEncrypted(box));
  assert.ok(!isEncrypted('hunter2'), 'a plaintext legacy value is not mistaken for a box');
  assert.ok(!isEncrypted(''), 'nor is an empty one');
});

test('the same secret encrypts differently every time', () => {
  assert.notStrictEqual(encryptValue('same', KEY), encryptValue('same', KEY),
    'a fixed ciphertext would leak which sites share a password');
});

test('tampering is detected rather than silently decrypted', () => {
  const box = encryptValue('hunter2', KEY);
  const bad = box.slice(0, -4) + 'AAAA';
  assert.strictEqual(decryptValue(bad, KEY), null, 'a modified box yields null, never garbage');
});

test('the wrong key yields null, never a wrong-but-plausible string', () => {
  const box = encryptValue('hunter2', KEY);
  assert.strictEqual(decryptValue(box, keyFrom('a-different-passphrase-entirely')), null);
});

test('no key at all → null, and never the ciphertext itself', () => {
  const box = encryptValue('hunter2', KEY);
  const out = decryptValue(box, null);
  assert.strictEqual(out, null, 'handing the box to nodemailer would fail in a way nobody can read');
});

test('a plaintext value passes straight through — an install with no key is unaffected', () => {
  assert.strictEqual(decryptValue('hunter2', KEY), 'hunter2');
  assert.strictEqual(decryptValue('hunter2', null), 'hunter2');
});

test('an empty secret stays empty, never an encrypted empty string', () => {
  assert.strictEqual(encryptValue('', KEY), '');
});

test('keyFrom refuses a key too short to be worth having', () => {
  assert.strictEqual(keyFrom(''), null);
  assert.strictEqual(keyFrom('short'), null, 'a five-character key is a false sense of safety');
  assert.ok(Buffer.isBuffer(keyFrom('sixteen-characters-or-more')));
});
