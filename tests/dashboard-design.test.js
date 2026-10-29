'use strict';
// Design review 2026-10-29 — the dashboard viewer helpers: worst-first ordering with not-measured last,
// short period labels, dots that do not rely on colour alone, tile context (target + change), previous window.
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../public/lib/dashboardRender');
const D = require('../services/dashboardData');

test('rows: red, amber, green, then not measured; within a colour the worse value first', () => {
  const rows = [{ site: 'n', value: null }, { site: 'g', value: 95, rag: 'GREEN' }, { site: 'r', value: 40, rag: 'RED' }, { site: 'a2', value: 85, rag: 'AMBER' }, { site: 'a1', value: 80, rag: 'AMBER' }];
  assert.deepEqual(R.sortRows(rows).map((r) => r.site), ['r', 'a1', 'a2', 'g', 'n']);
  assert.deepEqual(R.sortRows(rows, false).map((r) => r.site), ['r', 'a2', 'a1', 'g', 'n'], 'lower is better: the higher value is worse');
});

test('labels, dots and tile context', () => {
  assert.equal(R.shortLabel('2026-W31'), 'W31'); assert.equal(R.shortLabel('2026-07'), 'Jul'); assert.equal(R.shortLabel('x'), 'x');
  assert.match(R.ragDot('RED'), /aria-label="red">✕</); assert.match(R.ragDot(null), /not measured/);
  assert.equal(R.kpiContext({ value: null, target: 2 }), '', 'no verdict on nothing');
  const c = R.kpiContext({ value: 92, unit: '%', target: 90, vs_target: { rag: 'GREEN' }, previous: { label: '2026-W30', delta: -1.2 } });
  assert.match(c, /target 90 %/); assert.match(c, /edv-delta bad">▼ 1.2 pts vs W30/);
  assert.match(R.kpiContext({ value: 3, previous: { label: '2026-06', delta: -2 }, higher_is_better: false }), /edv-delta good">▼ 2 vs Jun/, 'fewer overdue issues is good');
});

test('previous window across year boundaries', () => {
  assert.equal(D.previousWindow('2026-W31'), '2026-W30');
  assert.equal(D.previousWindow('2026-W01'), '2025-W52');
  assert.equal(D.previousWindow('2026-01'), '2025-12');
  assert.equal(D.previousWindow('latest'), null);
});
