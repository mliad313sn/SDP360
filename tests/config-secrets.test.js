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
  assert.ok(Buffer.isBuffer(keyFrom('sixteen-characters-or-more').v2)); // Step 4: { v2: scrypt, v1: sha256 }
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
  assert.ok(Buffer.isBuffer(k.v2) && k.v2.length === 32 && Buffer.isBuffer(k.v1) && k.v1.length === 32);
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
  assert.ok(plan.every(p => p.value.startsWith('enc:v2:'))); // Step 4 writes v2 (scrypt); v1 still reads
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

// ── Step 4 — v2 (scrypt) boxes, v1 compatibility, re-encryption plan, production key gate ──
test('v2: a v1 box still opens with the same passphrase; new boxes are v2; wrong key → null', () => {
  const { encryptValue, decryptValue, keyFrom, boxVersion } = require('../services/configSecrets');
  const k = keyFrom('a-passphrase-of-sixteen-chars');
  const crypto = require('crypto');
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', k.v1, iv);
  const body = Buffer.concat([c.update('legacy', 'utf8'), c.final()]);
  const v1 = 'enc:v1:' + [iv, c.getAuthTag(), body].map((b) => b.toString('base64')).join(':');
  assert.strictEqual(decryptValue(v1, k), 'legacy');
  const v2 = encryptValue('fresh', k);
  assert.strictEqual(boxVersion(v2), 2); assert.strictEqual(boxVersion(v1), 1);
  assert.strictEqual(decryptValue(v2, k), 'fresh');
  assert.strictEqual(decryptValue(v2, keyFrom('another-passphrase-of-16')), null);
});

test('planReencryption: v1 + plaintext → v2, v2 kept, unreadable reported and never overwritten; key rotation', () => {
  const { encryptValue, decryptValue, keyFrom, planReencryption } = require('../services/configSecrets');
  const k = keyFrom('a-passphrase-of-sixteen-chars'), k2 = keyFrom('rotated-passphrase-of-16');
  const rows = [{ key: 'a', value: 'plain' }, { key: 'b', value: encryptValue('x', k) }, { key: 'c', value: 'enc:v2:AAAA:BBBB:CCCC' }, { key: 'd', value: '' }];
  const plan = planReencryption(rows, { newKey: k });
  assert.deepEqual(plan.updates.map((u) => u.key), ['a']);
  assert.deepEqual(plan.skipped, ['b', 'c'], 'without an old key every v2 box is assumed sealed with the current key');
  const rot = planReencryption(rows, { newKey: k2, oldKey: k });
  assert.deepEqual(rot.updates.map((u) => u.key), ['a', 'b']);
  assert.deepEqual(rot.unreadable, ['c'], 'opens with neither key → reported, never overwritten');
  assert.strictEqual(decryptValue(rot.updates[1].value, k2), 'x');
});

test('assertProductionKey: mandatory only with NODE_ENV=production; bypass flag is explicit', () => {
  const { assertProductionKey } = require('../services/configSecrets');
  assert.strictEqual(assertProductionKey({}).ok, true);
  assert.strictEqual(assertProductionKey({ NODE_ENV: 'production' }).ok, false);
  assert.strictEqual(assertProductionKey({ NODE_ENV: 'production', SDP_CONFIG_KEY: 'a-passphrase-of-sixteen-chars' }).ok, true);
  assert.strictEqual(assertProductionKey({ NODE_ENV: 'production', SDP_ALLOW_PLAINTEXT_SECRETS: '1' }).bypass, true);
});

// ── A-28b — enc:v3: random salt per box + AAD = report_config key name; written only when
//    SDP_CONFIG_BOX_VERSION=3 (default 2 = today) ──
function _withBoxVersion(v, fn) {
  const prev = process.env.SDP_CONFIG_BOX_VERSION;
  if (v == null) delete process.env.SDP_CONFIG_BOX_VERSION; else process.env.SDP_CONFIG_BOX_VERSION = String(v);
  try { return fn(); } finally { if (prev === undefined) delete process.env.SDP_CONFIG_BOX_VERSION; else process.env.SDP_CONFIG_BOX_VERSION = prev; }
}

test('A-28b: v3 round-trips with its key name; two boxes of the same value differ in salt and iv', () => {
  const { encryptValue, decryptValue, boxVersion, isEncrypted } = require('../services/configSecrets');
  const a = encryptValue('hunter2', KEY, { keyName: 'smtp_pass', version: 3 });
  const b = encryptValue('hunter2', KEY, { keyName: 'smtp_pass', version: 3 });
  assert.ok(a.startsWith('enc:v3:') && isEncrypted(a));
  assert.strictEqual(boxVersion(a), 3);
  const pa = a.slice(7).split(':'), pb = b.slice(7).split(':');
  assert.strictEqual(pa.length, 4, 'enc:v3:<salt>:<iv>:<tag>:<ct>');
  assert.strictEqual(Buffer.from(pa[0], 'base64').length, 16, '16-byte salt');
  assert.notStrictEqual(pa[0], pb[0]); assert.notStrictEqual(pa[1], pb[1]);
  assert.ok(!a.includes('hunter2'));
  assert.strictEqual(decryptValue(a, KEY, { keyName: 'smtp_pass' }), 'hunter2');
});

test('A-28b: a v3 box moved under another key name (or read without one, or with another passphrase) does not open', () => {
  const { encryptValue, decryptValue, keyFrom } = require('../services/configSecrets');
  const box = encryptValue('smtp-secret', KEY, { keyName: 'smtp_pass', version: 3 });
  assert.strictEqual(decryptValue(box, KEY, { keyName: 'meraki_api_key' }), null, 'AAD binds the box to its key name');
  assert.strictEqual(decryptValue(box, KEY), null, 'no key name → null, never the ciphertext');
  assert.strictEqual(decryptValue(box, keyFrom('another-passphrase-of-16'), { keyName: 'smtp_pass' }), null);
  assert.strictEqual(decryptValue(box, null, { keyName: 'smtp_pass' }), null);
});

test('A-28b: v1/v2 still open; with SDP_CONFIG_BOX_VERSION unset new boxes are v2 (today), =3 → v3', () => {
  const { encryptValue, decryptValue, boxVersion } = require('../services/configSecrets');
  const v2 = _withBoxVersion(null, () => encryptValue('x', KEY, { keyName: 'smtp_pass' }));
  assert.strictEqual(boxVersion(v2), 2);
  assert.strictEqual(decryptValue(v2, KEY, { keyName: 'smtp_pass' }), 'x', 'a v2 box ignores the key name');
  assert.strictEqual(boxVersion(_withBoxVersion('2', () => encryptValue('x', KEY, { keyName: 'k' }))), 2);
  const v3 = _withBoxVersion('3', () => encryptValue('x', KEY, { keyName: 'smtp_pass' }));
  assert.strictEqual(boxVersion(v3), 3);
  assert.throws(() => encryptValue('x', KEY, { version: 3 }), /key name/, 'v3 without a key name is a programming error');
});

test('A-28b: planReencryption to v3 reports v2→v3 and never overwrites an unreadable box', () => {
  const { encryptValue, decryptValue, planReencryption, boxVersion } = require('../services/configSecrets');
  const rows = [
    { key: 'smtp_pass', value: encryptValue('a', KEY) },                                     // v2
    { key: 'meraki_api_key', value: encryptValue('b', KEY, { keyName: 'meraki_api_key', version: 3 }) },   // already v3
    { key: 'opmanager_api_key', value: 'plain' },
    { key: 'entra_client_secret', value: 'enc:v2:AAAA:BBBB:CCCC' },                         // unreadable
    { key: 'meridian_in_key', value: 'enc:v3:AAAA:BBBB:CCCC:DDDD' },                        // unreadable v3
  ];
  const plan = planReencryption(rows, { newKey: KEY, to: 'v3' });
  assert.deepStrictEqual(plan.updates.map((u) => [u.key, u.from, u.to]), [['smtp_pass', 'v2', 'v3'], ['opmanager_api_key', 'plaintext', 'v3']]);
  assert.deepStrictEqual(plan.skipped, ['meraki_api_key']);
  assert.deepStrictEqual(plan.unreadable, ['entra_client_secret', 'meridian_in_key']);
  for (const u of plan.updates) { assert.strictEqual(boxVersion(u.value), 3); assert.ok(decryptValue(u.value, KEY, { keyName: u.key }) != null); }
  // default target (v2, today): v2 boxes are kept, v3 box is kept too
  const today = _withBoxVersion(null, () => planReencryption(rows, { newKey: KEY }));
  assert.deepStrictEqual(today.updates.map((u) => u.key), ['opmanager_api_key']);
  assert.strictEqual(boxVersion(today.updates[0].value), 2);
  // explicit --to=v2 is the rollback path: v3 boxes are re-sealed as v2 on purpose
  const down = planReencryption(rows.filter((r) => r.key === 'meraki_api_key'), { newKey: KEY, to: 'v2' });
  assert.deepStrictEqual(down.updates.map((u) => [u.key, u.from, u.to]), [['meraki_api_key', 'v3', 'v2']]);
  assert.strictEqual(decryptValue(down.updates[0].value, KEY), 'b');
});

test('A-28b: reencrypt-secrets --to=v3 is refused unless SDP_CONFIG_BOX_VERSION=3', () => {
  const { parseTarget } = require('../tools/pg/reencrypt-secrets');
  assert.deepStrictEqual(parseTarget([], {}), { to: null });
  assert.match(parseTarget(['--to=v3'], {}).error, /SDP_CONFIG_BOX_VERSION=3/);
  assert.deepStrictEqual(parseTarget(['--to=v3'], { SDP_CONFIG_BOX_VERSION: '3' }), { to: 'v3' });
  assert.deepStrictEqual(parseTarget(['--to=v2'], {}), { to: 'v2' });
  assert.match(parseTarget(['--to=v9'], {}).error, /v2 or v3/);
});
