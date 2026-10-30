'use strict';
// G03 — password check is constant-time and an unknown user still pays the hashing cost.
const test = require('node:test');
const assert = require('node:assert');
const { hashPassword, passwordMatches } = require('../reports-db');

const user = { salt: 'abcd1234', password_hash: hashPassword('right-pass-0000', 'abcd1234') };

test('right password matches, wrong or empty does not', () => {
  assert.strictEqual(passwordMatches('right-pass-0000', user), true);
  assert.strictEqual(passwordMatches('wrong-pass-0000', user), false);
  assert.strictEqual(passwordMatches('', user), false);
  assert.strictEqual(passwordMatches(null, user), false);
});

test('unknown user or malformed stored hash is refused without throwing', () => {
  assert.strictEqual(passwordMatches('x', null), false);
  assert.strictEqual(passwordMatches('x', { salt: 's', password_hash: 'zz' }), false);
});

test('an unknown user costs about as much as a known one (no username enumeration by timing)', () => {
  const t = (fn) => { const s = process.hrtime.bigint(); for (let i = 0; i < 3; i++) fn(); return Number(process.hrtime.bigint() - s); };
  const known = t(() => passwordMatches('wrong', user));
  const unknown = t(() => passwordMatches('wrong', null));
  assert.ok(unknown > known * 0.5, `unknown ${unknown} vs known ${known}`);
});
