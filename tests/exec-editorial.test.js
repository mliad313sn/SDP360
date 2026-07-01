'use strict';
const test = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

test('exec editorial: set then get round-trips per period', () => {
  rdb.setExecEditorial('2026-06',
    { highlights: ['2 major projects completed', 'SLA +2%'],
      focus: [{ title: 'UPS Upgrade – Lafigué', subtitle: 'Power reliability' }] },
    'tester');
  const got = rdb.getExecEditorial('2026-06');
  assert.deepEqual(got.highlights, ['2 major projects completed', 'SLA +2%']);
  assert.equal(got.focus[0].title, 'UPS Upgrade – Lafigué');
});

test('exec editorial: missing period → empty arrays', () => {
  const got = rdb.getExecEditorial('1999-01');
  assert.deepEqual(got, { highlights: [], focus: [] });
});

test('exec editorial: caps enforced (max 4 highlights, 3 focus)', () => {
  rdb.setExecEditorial('2026-07',
    { highlights: ['a','b','c','d','e','f'],
      focus: [{title:'1'},{title:'2'},{title:'3'},{title:'4'}] }, 'tester');
  const got = rdb.getExecEditorial('2026-07');
  assert.equal(got.highlights.length, 4);
  assert.equal(got.focus.length, 3);
});
