'use strict';
// Security review (CISO, 2026-10-29): a caller-supplied ?limit= reaches a LIMIT clause. Negative,
// fractional or absurd values must be clamped, never turned into a 500 (LIMIT -5) or an unbounded read.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('every interpolated LIMIT on a caller-supplied limit is clamped to at least 1 and floored', () => {
  const dirs = ['services', 'routes'];
  const offenders = [];
  for (const d of dirs) for (const f of fs.readdirSync(path.join(__dirname, '..', d)).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(__dirname, '..', d, f), 'utf8');
    const re = /Number\(limit\)/g; let m;
    while ((m = re.exec(src))) {
      const around = src.slice(Math.max(0, m.index - 40), m.index + 40);
      if (!/Math\.max\(1,/.test(around) || !/Math\.floor\(Number\(limit\)\)/.test(around)) offenders.push(`${d}/${f}: ${around.replace(/\s+/g, ' ')}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the clamp expression behaves', () => {
  const clamp = (limit) => Math.max(1, Math.min(2000, Math.floor(Number(limit)) || 500));
  assert.equal(clamp(-5), 1); assert.equal(clamp('abc'), 500); assert.equal(clamp(undefined), 500);
  assert.equal(clamp(1.7), 1); assert.equal(clamp(10_000_000), 2000); assert.equal(clamp('25'), 25);
});
