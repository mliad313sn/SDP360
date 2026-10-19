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

// A key that is SET but rejected must say so. Measured on dotenv: a `#` truncates the
// value, a backslash is swallowed, surrounding quotes are stripped — so
// `SDP_CONFIG_KEY=abc#defghijklmnop` (17 characters as typed) reaches the process as
// `abc`, falls under the floor, and encryption silently does not happen while the
// operator believes it is on. Silence is the one outcome this must not have.
const { envKey } = require('../services/configSecrets');

test('a key set but too short warns, and still refuses to pretend', () => {
  const warned = [];
  const k = envKey({ SDP_CONFIG_KEY: 'abc' }, (m) => warned.push(m));
  assert.strictEqual(k, null, 'no half-strength key is ever used');
  assert.strictEqual(warned.length, 1);
  assert.match(warned[0], /SDP_CONFIG_KEY/);
  assert.match(warned[0], /16/, 'says what the floor is');
  assert.ok(!warned[0].includes('abc'), 'and never echoes the value itself');
});

test('no key at all is silent — that is a legitimate configuration', () => {
  const warned = [];
  assert.strictEqual(envKey({}, (m) => warned.push(m)), null);
  assert.strictEqual(warned.length, 0);
});

test('a usable key is silent and returns 32 bytes', () => {
  const warned = [];
  const k = envKey({ SDP_CONFIG_KEY: 'a-long-enough-passphrase' }, (m) => warned.push(m));
  assert.ok(Buffer.isBuffer(k) && k.length === 32);
  assert.strictEqual(warned.length, 0);
});

// The check an operator needs after setting the key: WHICH secrets are actually
// encrypted at rest. Setting SDP_CONFIG_KEY changes nothing on its own — a stored value
// only becomes a box when it is next SAVED — so "the key is accepted" and "the database
// no longer carries the secret" are two different facts, and only the second one matters.
const { describeSecretState } = require('../services/configSecrets');

test('describeSecretState tells the three states apart', () => {
  assert.strictEqual(describeSecretState('enc:v1:aaa:bbb:ccc').state, 'encrypted');
  assert.strictEqual(describeSecretState('hunter2').state, 'plaintext');
  assert.strictEqual(describeSecretState('').state, 'empty');
  assert.strictEqual(describeSecretState(null).state, 'empty');
});

test('it never echoes the secret it is describing', () => {
  const d = describeSecretState('hunter2');
  assert.ok(!JSON.stringify(d).includes('hunter2'), 'a diagnostic must not print the password');
  assert.match(d.label, /clair/i, 'and it says plainly that this one is exposed');
});

// The migration itself. Re-typing each secret in the admin console works, but it is the
// riskiest way to do it: the fields are redacted on GET and BLANK MEANS KEEP, so a Save
// with an untouched field encrypts nothing while looking like it did — and a typo in the
// SMTP password breaks Monday's mail. Re-encrypting in place needs no one to know the
// values.
const { planSecretEncryption } = require('../services/configSecrets');

test('plans an update only for the values that are plaintext and non-empty', () => {
  const plan = planSecretEncryption([
    { key: 'smtp_pass', value: 'hunter2' },
    { key: 'meraki_api_key', value: 'abc123' },
    { key: 'entra_client_secret', value: '' },
    { key: 'meridian_in_key', value: 'enc:v1:a:b:c' },
  ], KEY);
  assert.deepStrictEqual(plan.map(p => p.key), ['smtp_pass', 'meraki_api_key']);
  assert.ok(plan.every(p => p.value.startsWith('enc:v1:')));
});

test('the plan round-trips: what it writes decrypts back to what was there', () => {
  const [p] = planSecretEncryption([{ key: 'smtp_pass', value: 'hunter2' }], KEY);
  assert.strictEqual(decryptValue(p.value, KEY), 'hunter2');
});

test('no key → no plan at all, rather than a plan that destroys the values', () => {
  assert.deepStrictEqual(planSecretEncryption([{ key: 'smtp_pass', value: 'hunter2' }], null), []);
});

test('running it twice is a no-op — the second pass has nothing to do', () => {
  const rows = [{ key: 'smtp_pass', value: 'hunter2' }];
  const first = planSecretEncryption(rows, KEY);
  const after = [{ key: 'smtp_pass', value: first[0].value }];
  assert.deepStrictEqual(planSecretEncryption(after, KEY), []);
});
