'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const K = require('../services/kpiRag');

test('registry carries the five inherited policies verbatim', () => {
  assert.deepEqual([K.POLICIES['tracker-activity'].green, K.POLICIES['tracker-activity'].amber], [0.9, 0.75]);
  assert.deepEqual([K.POLICIES['site-score'].green, K.POLICIES['site-score'].amber], [70, 45]);
  assert.deepEqual([K.POLICIES['site-composite'].green, K.POLICIES['site-composite'].amber], [75, 55]);
  assert.deepEqual([K.POLICIES['sla-percent'].green, K.POLICIES['sla-percent'].amber], [90, 70]);
});

test('rag bands and NA', () => {
  assert.equal(K.rag(0.95), 'GREEN');
  assert.equal(K.rag(0.9), 'GREEN');
  assert.equal(K.rag(0.8), 'AMBER');
  assert.equal(K.rag(0.5), 'RED');
  assert.equal(K.rag(null), 'NA');
  assert.equal(K.rag(72, 'site-score'), 'GREEN');
  assert.equal(K.rag(72, 'site-composite'), 'AMBER');
  assert.equal(K.rag(0.8, { green: 0.7, amber: 0.5 }), 'GREEN');
  assert.throws(() => K.rag(1, 'nope'));
});

test('aggregate per KPI type', () => {
  assert.equal(K.aggregate([0, 1, 0], 'BOOLEAN'), 1);
  assert.equal(K.aggregate([1, 2, 3], 'COUNT'), 6);
  assert.equal(K.aggregate([50, 100], 'PERCENT'), 75);
  assert.equal(K.aggregate([1, 2, 3], 'MILESTONE'), 3);
  assert.equal(K.aggregate([0, 4, 0, 2], 'RATING'), 3);
  assert.equal(K.aggregate([], 'COUNT'), 0);
  assert.equal(K.aggregate(['x', 2], 'COUNT'), 2);
});

test('attainment: pro-rata COUNT, defaults, N/A before start, zero target, inverse', () => {
  // 12/year target, 6 of 12 months elapsed → target 6; value 6 → 1.0
  assert.equal(K.attainment(6, 12, 'COUNT', { elapsed: 6, span: 12 }), 1);
  assert.equal(K.attainment(3, 12, 'COUNT', { elapsed: 6, span: 12 }), 0.5);
  assert.equal(K.attainment(3, 12, 'COUNT', { elapsed: 0, span: 12 }), null, 'not started → NA');
  assert.equal(K.attainment(1, null, 'BOOLEAN'), 1, 'BOOLEAN default target 1');
  assert.equal(K.attainment(80, null, 'PERCENT'), 0.8, 'PERCENT default target 100');
  assert.equal(K.attainment(4, null, 'RATING'), 1);
  assert.equal(K.attainment(5, 0, 'CURRENCY'), null, 'zero target → NA');
  assert.equal(K.attainment(5, null, 'COUNT'), null, 'COUNT has no default target');
  assert.equal(K.attainment(2, 4, 'DURATION'), 2, 'lower is better: half the target time → 200 %');
  assert.equal(K.attainment(8, 4, 'DURATION'), 0.5);
});

test('definePolicy adds a committee policy and rejects inverted thresholds', () => {
  K.definePolicy('committee-2027', { green: 0.85, amber: 0.7, scale: 'ratio' });
  assert.equal(K.rag(0.86, 'committee-2027'), 'GREEN');
  assert.throws(() => K.definePolicy('bad', { green: 0.5, amber: 0.7 }));
});
