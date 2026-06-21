'use strict';

// Unit tests for the shared PPTX RAG/trend helpers (reports-pptx-shared.js).
// These pure functions were deduplicated out of reports-weekly-pptx.js and
// reports-monthly-pptx.js; these tests lock their behaviour so a future edit
// to the shared copy can't silently change either deck.

const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../reports-pptx-shared');

test('statusColor maps RAG words to hex, else neutral grey', () => {
  assert.strictEqual(H.statusColor('green'),  '2D9C4A');
  assert.strictEqual(H.statusColor('orange'), 'E87722');
  assert.strictEqual(H.statusColor('red'),    'D0312D');
  assert.strictEqual(H.statusColor('GREEN'),  '2D9C4A'); // case-insensitive
  assert.strictEqual(H.statusColor('none'),   'AAAAAA');
  assert.strictEqual(H.statusColor(''),       'AAAAAA');
  assert.strictEqual(H.statusColor(undefined),'AAAAAA');
});

test('trendArrow maps trend words to glyphs', () => {
  assert.strictEqual(H.trendArrow('up'),        '▲');
  assert.strictEqual(H.trendArrow('down'),      '▼');
  assert.strictEqual(H.trendArrow('stable'),    '→');
  assert.strictEqual(H.trendArrow('no_change'), 'No change');
  assert.strictEqual(H.trendArrow('whatever'),  '—');
  assert.strictEqual(H.trendArrow(undefined),   '—');
});

test('trendColor: up=green, down=red, else grey', () => {
  assert.strictEqual(H.trendColor('up'),     '2D9C4A');
  assert.strictEqual(H.trendColor('down'),   'D0312D');
  assert.strictEqual(H.trendColor('stable'), '666666');
  assert.strictEqual(H.trendColor(''),       '666666');
});

test('computeTrends overrides trend by numeric comparison, keeps non-numeric', () => {
  const cur  = [
    { service: 'WAN1', status_value: '99.4', trend: 'stable' },
    { service: 'WAN2', status_value: '90,0', trend: 'up' },     // comma decimal
    { service: 'LAN',  status_value: '100',  trend: 'down' },
    { service: 'Bkp',  status_value: 'N/A',  trend: 'up' },     // non-numeric → keep
  ];
  const prev = [
    { service: 'wan1', status_value: '98.0' },  // case-insensitive match → up
    { service: 'WAN2', status_value: '95.0' },  // 90 < 95 → down
    { service: 'LAN',  status_value: '100' },   // equal → stable
    { service: 'Bkp',  status_value: '100' },
  ];
  const out = H.computeTrends(cur, prev);
  assert.strictEqual(out[0].trend, 'up');
  assert.strictEqual(out[1].trend, 'down');
  assert.strictEqual(out[2].trend, 'stable');
  assert.strictEqual(out[3].trend, 'up');      // unchanged (non-numeric)
  // does not mutate input
  assert.strictEqual(cur[0].trend, 'stable');
});

test('computeTrends returns current unchanged when no prev', () => {
  const cur = [{ service: 'A', status_value: '1' }];
  assert.deepStrictEqual(H.computeTrends(cur, []), cur);
  assert.deepStrictEqual(H.computeTrends(cur, null), cur);
  assert.deepStrictEqual(H.computeTrends([], cur), []);
  assert.deepStrictEqual(H.computeTrends(null, cur), []);
});

test('autoStatusColor: numeric thresholds then stored-color fallback', () => {
  assert.deepStrictEqual(H.autoStatusColor('99', '98', 'red'),  { color: '2D9C4A', hasColor: true }); // >= target
  assert.deepStrictEqual(H.autoStatusColor('95', '100', 'red'), { color: 'E87722', hasColor: true }); // >= 90%
  assert.deepStrictEqual(H.autoStatusColor('80', '100', 'red'), { color: 'D0312D', hasColor: true }); // < 90%
  // non-numeric → stored color
  assert.deepStrictEqual(H.autoStatusColor('N/A', '', 'green'), { color: '2D9C4A', hasColor: true });
  assert.deepStrictEqual(H.autoStatusColor('N/A', '', 'none'),  { color: 'AAAAAA', hasColor: false });
  assert.deepStrictEqual(H.autoStatusColor('N/A', '', ''),      { color: 'AAAAAA', hasColor: false });
  // percent signs tolerated
  assert.deepStrictEqual(H.autoStatusColor('99%', '98%', 'red'), { color: '2D9C4A', hasColor: true });
});
