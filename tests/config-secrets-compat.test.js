'use strict';
// A-03a — 2.0 must READ the 1.11 enc:v2 layout (`enc:v2:<salt>:<iv>:<tag>:<ct>`, scrypt with a
// random 16-byte salt per value). The fixture below re-implements the 1.11 writer exactly
// (origin/claude/confident-pascal-03veex services/configSecrets.js encryptValue, v2 branch).
// No assertion message ever prints a secret or a passphrase.
const test = require('node:test'); const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.argv.push('--dir', fs.mkdtempSync(path.join(os.tmpdir(), 'sdpcompat-')));
const cs = require('../services/configSecrets');
const pi = require('../tools/installer-v2/post-install.js');

const PASS = 'compat-passphrase-0123456789';
const WRONG = 'another-passphrase-9876543210';
const SECRET = 'smtp-password-value';

function seal111(plain, pass) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const k = crypto.scryptSync(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return 'enc:v2:' + [salt, iv, c.getAuthTag(), body].map(b => b.toString('base64')).join(':');
}
const box111 = seal111(SECRET, PASS);

test('fixture is a 4-part enc:v2 box', () => {
  assert.ok(box111.startsWith('enc:v2:'));
  assert.strictEqual(box111.slice(7).split(':').length, 4);
});

test('1.11 four-part enc:v2 box decrypts with the right passphrase', () => {
  assert.ok(cs.decryptValue(box111, cs.keyFrom(PASS)) === SECRET, '1.11 box did not open');
});

test('1.11 box with a wrong passphrase returns null, never the ciphertext', () => {
  assert.ok(cs.decryptValue(box111, cs.keyFrom(WRONG)) === null, 'wrong key must read as null');
});

test('2.0 three-part box still decrypts', () => {
  const k = cs.keyFrom(PASS);
  const box = cs.encryptValue(SECRET, k);
  assert.strictEqual(box.slice(7).split(':').length, 3, '2.0 still writes the 3-part layout');
  assert.ok(cs.decryptValue(box, k) === SECRET, '2.0 box did not open');
});

test('a five-part or two-part v2 body returns null', () => {
  const k = cs.keyFrom(PASS);
  const parts = box111.slice(7).split(':');
  assert.strictEqual(cs.decryptValue('enc:v2:' + [...parts, parts[0]].join(':'), k), null);
  assert.strictEqual(cs.decryptValue('enc:v2:' + parts.slice(0, 2).join(':'), k), null);
});

test('keyFrom result does not leak the passphrase through JSON or enumeration', () => {
  const k = cs.keyFrom(PASS);
  assert.ok(!JSON.stringify(k).includes(PASS), 'passphrase visible in JSON');
  assert.ok(!Object.keys(k).includes('_pass'), '_pass must be non-enumerable');
  assert.ok(!require('util').inspect(k).includes(PASS), 'passphrase visible in inspect');
});

test('planReencryption turns a 1.11 box into a 2.0 box with the same plaintext', () => {
  const k = cs.keyFrom(PASS);
  const plan = cs.planReencryption([{ key: 'smtp_pass', value: box111 }], { newKey: k });
  assert.strictEqual(plan.updates.length, 1);
  assert.strictEqual(plan.updates[0].from, 'v2-1.11');
  assert.strictEqual(plan.updates[0].value.slice(7).split(':').length, 3);
  assert.ok(cs.decryptValue(plan.updates[0].value, k) === SECRET, 're-sealed box lost the plaintext');
  // A 2.0 box without oldKey is still skipped (nothing to do).
  const again = cs.planReencryption([{ key: 'smtp_pass', value: plan.updates[0].value }], { newKey: k });
  assert.deepStrictEqual(again.skipped, ['smtp_pass']);
});

test('planReencryption reports a 1.11 box it cannot open as unreadable, never overwritten', () => {
  const plan = cs.planReencryption([{ key: 'smtp_pass', value: box111 }], { newKey: cs.keyFrom(WRONG) });
  assert.deepStrictEqual(plan.unreadable, ['smtp_pass']);
  assert.strictEqual(plan.updates.length, 0);
});

test('checkSecretRows reports a 1.11 box as readable with the right key', () => {
  const r = pi.checkSecretRows([{ key: 'smtp_pass', value: box111 }], PASS);
  assert.deepStrictEqual(r.encrypted, ['smtp_pass']);
  assert.deepStrictEqual(r.unreadable, []);
  const bad = pi.checkSecretRows([{ key: 'smtp_pass', value: box111 }], WRONG);
  assert.deepStrictEqual(bad.unreadable, ['smtp_pass']);
});

test('check-secrets summarizeVerify counts readable / unreadable / plaintext without values', () => {
  const { summarizeVerify } = require('../tools/pg/check-secrets');
  const k = cs.keyFrom(PASS);
  const s = summarizeVerify([
    { key: 'a', value: box111 }, { key: 'b', value: cs.encryptValue('secret-two-zz', k) },
    { key: 'c', value: seal111('secret-three-zz', WRONG) }, { key: 'd', value: 'secret-four-zz' }, { key: 'e', value: '' },
  ], k);
  assert.deepStrictEqual({ r: s.readable, u: s.unreadable, p: s.plaintext }, { r: 2, u: 1, p: 1 });
  assert.deepStrictEqual(s.unreadableKeys, ['c']);
  const j = JSON.stringify(s);
  assert.ok(!/secret-|smtp-password/.test(j) && !j.includes(PASS), 'summary must carry counts and key names only');
});
