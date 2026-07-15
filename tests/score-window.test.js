// tests/score-window.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { rollingWindow, prevDay } = require('../services/scoreWindow');

test('3-month rolling window ending at asOf', () => {
  assert.deepStrictEqual(rollingWindow('2026-07-14'), { from: '2026-04-14', to: '2026-07-14' });
});
test('crosses a year boundary', () => {
  assert.deepStrictEqual(rollingWindow('2026-02-10'), { from: '2025-11-10', to: '2026-02-10' });
});
test('clamps a day that does not exist in the from-month', () => {
  // 31 May minus 3 months = 28 Feb (2026 is not a leap year), never 31 Feb / 3 Mar
  assert.deepStrictEqual(rollingWindow('2026-05-31'), { from: '2026-02-28', to: '2026-05-31' });
});
test('leap year: 31 May 2024 → 29 Feb 2024', () => {
  assert.deepStrictEqual(rollingWindow('2024-05-31'), { from: '2024-02-29', to: '2024-05-31' });
});
test('months param is honoured', () => {
  assert.deepStrictEqual(rollingWindow('2026-07-14', 1), { from: '2026-06-14', to: '2026-07-14' });
});
test('rejects a malformed asOf', () => {
  assert.throws(() => rollingWindow('14/07/2026'), /asOf/i);
});

// prevDay — needed by prevScore (the previous window ends the day before this
// one starts). Lives here so NOBODY reaches for `new Date(from) - 86400e3`.
test('prevDay steps back one day', () => {
  assert.strictEqual(prevDay('2026-07-14'), '2026-07-13');
});
test('prevDay crosses a month boundary', () => {
  assert.strictEqual(prevDay('2026-03-01'), '2026-02-28');
});
test('prevDay crosses a year boundary', () => {
  assert.strictEqual(prevDay('2026-01-01'), '2025-12-31');
});
test('prevDay handles a leap day', () => {
  assert.strictEqual(prevDay('2024-03-01'), '2024-02-29');
});
