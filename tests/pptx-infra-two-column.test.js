'use strict';
// splitInfraKpiColumns — the pure layout decision behind the two-column
// Infrastructure-KPIs slide fix (Exploration tracks 30 KPIs and overflowed a
// single column). Short lists MUST stay single-column so every other site's
// slide renders byte-identical (golden fingerprint must not move).
const { test } = require('node:test');
const assert = require('node:assert');
const { splitInfraKpiColumns, INFRA_TWO_COL_THRESHOLD } = require('../reports-pptx-shared.js');

const mk = n => Array.from({ length: n }, (_, i) => ({ service: 'S' + i, kpi: 'Uptime', target: '99%', status_value: '100', status_color: 'green', trend: 'stable' }));

test('short list (typical site, 6 KPIs) stays single-column', () => {
  const r = splitInfraKpiColumns(mk(6));
  assert.equal(r.twoCol, false);
  assert.equal(r.columns.length, 1);
  assert.equal(r.columns[0].length, 6);
});

test('exactly at threshold stays single-column', () => {
  const r = splitInfraKpiColumns(mk(INFRA_TWO_COL_THRESHOLD));
  assert.equal(r.twoCol, false);
  assert.equal(r.columns.length, 1);
});

test('one past threshold splits into two balanced columns', () => {
  const r = splitInfraKpiColumns(mk(INFRA_TWO_COL_THRESHOLD + 1));
  assert.equal(r.twoCol, true);
  assert.equal(r.columns.length, 2);
  // ceil(n/2) on the left, remainder on the right — left never smaller
  assert.equal(r.columns[0].length, Math.ceil((INFRA_TWO_COL_THRESHOLD + 1) / 2));
  assert.ok(r.columns[0].length >= r.columns[1].length);
});

test('Exploration (30 KPIs) splits 15/15 preserving order', () => {
  const src = mk(30);
  const r = splitInfraKpiColumns(src);
  assert.equal(r.twoCol, true);
  assert.deepEqual([r.columns[0].length, r.columns[1].length], [15, 15]);
  // concatenating the columns reproduces the input order exactly
  assert.deepEqual([...r.columns[0], ...r.columns[1]].map(k => k.service), src.map(k => k.service));
});

test('odd count keeps the extra row on the left', () => {
  const r = splitInfraKpiColumns(mk(31));
  assert.deepEqual([r.columns[0].length, r.columns[1].length], [16, 15]);
});

test('empty / non-array input is a single (empty) column', () => {
  assert.deepEqual(splitInfraKpiColumns([]), { twoCol: false, columns: [[]] });
  assert.deepEqual(splitInfraKpiColumns(null), { twoCol: false, columns: [[]] });
  assert.deepEqual(splitInfraKpiColumns(undefined), { twoCol: false, columns: [[]] });
});
