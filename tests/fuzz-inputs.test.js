'use strict';
// G21 — property / fuzz tests on the functions that face untrusted input: field envelopes (phones), CSV export
// cells (formula injection), AI prompt sanitising and log redaction. Seeded PRNG → reproducible; 2 000 cases each.
const test = require('node:test');
const assert = require('node:assert');
const F = require('../services/fieldOutbox');
const csv = require('../public/lib/csvSafe');
const S = require('../services/aiSanitize');
const { redactMessage } = require('../services/safeUrl');

function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const ALPHA = ['a', 'Z', '0', '9', ' ', '\n', '\t', '=', '+', '-', '@', '"', "'", ',', ';', '<', '>', '/', '\\', '%', '{', '}', '[', ']', 'é', '€', '\u0000', '\u202e', '😀', '.', ':'];
function str(r, max = 80) { let o = ''; const n = Math.floor(r() * max); for (let i = 0; i < n; i++) o += ALPHA[Math.floor(r() * ALPHA.length)]; return o; }
function val(r, d = 0) {
  const k = Math.floor(r() * (d > 2 ? 5 : 8));
  return [() => str(r), () => Math.floor(r() * 1e9) - 5e8, () => r() < 0.5, () => null, () => undefined, () => [val(r, d + 1), val(r, d + 1)], () => ({ [str(r, 6)]: val(r, d + 1), kind: str(r, 8) }), () => NaN][k]();
}

test('validateEnvelope never throws and only accepts known kinds with a uuid', () => {
  const r = prng(20261029);
  for (let i = 0; i < 2000; i++) {
    const env = r() < 0.3 ? { uuid: str(r, 40), kind: F.KINDS[Math.floor(r() * F.KINDS.length)], payload: val(r) } : val(r);
    let v; assert.doesNotThrow(() => { v = F.validateEnvelope(env); }, JSON.stringify(env));
    if (v && v.ok) { assert.ok(F.KINDS.includes(env.kind)); assert.match(String(env.uuid), /^[0-9a-f-]{36}$/i); }
  }
});

test('payloadHash is deterministic and key-order independent', () => {
  const r = prng(7);
  for (let i = 0; i < 500; i++) {
    const a = { x: str(r), y: Math.floor(r() * 100), z: [str(r), 1] };
    const b = { z: a.z, y: a.y, x: a.x };
    assert.strictEqual(F.payloadHash(a), F.payloadHash(b));
  }
});

test('CSV cells: nothing that a spreadsheet would run as a formula survives', () => {
  const r = prng(42);
  for (let i = 0; i < 2000; i++) {
    const s = (r() < 0.5 ? ['=', '+', '-', '@', '\t', '\r'][Math.floor(r() * 6)] : '') + str(r);
    const out = String(csv.neutralize(s));
    // a plain number ("-5", "+3.2") stays numeric by design; anything else starting with a trigger is quoted
    assert.ok(!/^[=+\-@\t\r]/.test(out) || /^[+-]?\d+(\.\d+)?$/.test(out), JSON.stringify(out));
  }
});

test('AI sanitiser never throws, never grows past the cap, never lets an e-mail through', () => {
  const r = prng(99);
  for (let i = 0; i < 2000; i++) {
    const s = str(r, 200) + (r() < 0.5 ? ` ${str(r, 6).replace(/\W/g, '') || 'a'}@ex${i}.org ` : '') + str(r, 50);
    let out; assert.doesNotThrow(() => { out = S.sanitiseForPrompt(s, { names: [str(r, 12)] }); });
    assert.ok(out.length <= S.MAX_FIELD);
    assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(out), out);
  }
});

test('log redaction removes every planted secret value', () => {
  const r = prng(5);
  for (let i = 0; i < 2000; i++) {
    const secret = 'S' + Math.floor(r() * 1e12).toString(36) + 'x9';
    const msg = str(r, 60) + ['token=', 'Authorization: Bearer ', 'password: ', 'https://h.example/a?key=', 'Bearer '][i % 5] + secret + str(r, 30);
    assert.ok(!redactMessage(msg, []).includes(secret), msg);
  }
});
