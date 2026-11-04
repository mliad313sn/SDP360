'use strict';
// A-22 — KPI card + bullet bar (public/lib/kpiCard.js): null ≠ 0, stale withholds colour, reuse of DashboardRender.
const test = require('node:test');
const assert = require('node:assert');
const KpiCard = require('../public/lib/kpiCard.js');
const DR = require('../public/lib/dashboardRender.js');

test('null value renders "— not measured" and no RAG colour', () => {
  const h = KpiCard.kpiCard({ label: 'Res. SLA', value: null, unit: '%', target: 90 });
  assert.match(h, /— not measured/);
  assert.ok(!/rag-(green|amber|red)/.test(h));
  assert.ok(!/0 %/.test(h), 'never shows a zero');
});

test('delta and target text come from DashboardRender.kpiContext', () => {
  const d = { label: 'Res. SLA', value: 92.4, unit: '%', target: 90, vs_target: { rag: 'GREEN' }, previous: { delta: 1.2, label: '2026-W31' } };
  const h = KpiCard.kpiCard(d);
  assert.ok(h.includes(DR.kpiContext(d)));
  assert.match(h, /target 90 %/);
  assert.match(h, /▲ \+1\.2 pts vs W31/);
  assert.match(h, /92\.4 %/);
  assert.match(h, /edv-kpi-card rag-green/);
});

test('stale freshness shows the stale badge and withholds colour', () => {
  const d = { label: 'WAN', value: 97, unit: '%', target: 97, vs_target: { rag: 'GREEN' }, freshness: 'STALE', rag_if_fresh: 'GREEN' };
  const h = KpiCard.kpiCard(d);
  assert.ok(h.includes(DR.staleBadge(d)));
  assert.match(h, /colour withheld/);
  assert.ok(!/class="edv-kpi-card rag-green/.test(h));
  assert.match(h, /edv-kpi-card rag-na/);
});

test('sparkline omits null points instead of drawing zero', () => {
  const svg = KpiCard.sparkline([10, 20, null, 30, 40]);
  const lines = svg.match(/<polyline points="([^"]+)"/g) || [];
  assert.strictEqual(lines.length, 2, 'the null splits the line in two segments');
  const pts = lines.join(' ').match(/[\d.]+,[\d.]+/g);
  assert.strictEqual(pts.length, 4, 'four drawn points for four measured values');
  assert.strictEqual(KpiCard.sparkline([null, null]), '', 'nothing measured → nothing drawn');
  assert.match(KpiCard.sparkline([null, 5, null]), /<circle/, 'a lone measured point is a dot');
});

test('bulletBar with null actual renders "— not measured"', () => {
  const h = KpiCard.bulletBar({ label: 'FRT SLA', actual: null, target: 80, max: 100, unit: '%' });
  assert.match(h, /— not measured/);
  assert.ok(!/edv-bullet__fill/.test(h));
  assert.ok(!/rag-(green|amber|red)/.test(h));
});

test('bulletBar width is clamped to 0..100 % of the scale', () => {
  assert.match(KpiCard.bulletBar({ label: 'x', actual: 150, target: 80, max: 100 }), /edv-bullet__fill" style="width:100%"/);
  assert.match(KpiCard.bulletBar({ label: 'x', actual: -20, target: 80, max: 100 }), /edv-bullet__fill" style="width:0%"/);
  assert.match(KpiCard.bulletBar({ label: 'x', actual: 50, target: 80, max: 100 }), /width:50%.*left:80%/);
});

test('bulletBar RAG band comes from KpiRag (kpi-target policy: ≥ 100 % green, ≥ 90 % amber)', () => {
  assert.match(KpiCard.bulletBar({ label: 'x', actual: 92, target: 90, max: 100 }), /edv-bullet rag-green/);
  assert.match(KpiCard.bulletBar({ label: 'x', actual: 85, target: 90, max: 100 }), /edv-bullet rag-amber/);
  assert.match(KpiCard.bulletBar({ label: 'x', actual: 50, target: 90, max: 100 }), /edv-bullet rag-red/);
  assert.match(KpiCard.bulletBar({ label: 'x', actual: 50, max: 100 }), /edv-bullet rag-na/, 'no target → no verdict');
});

test('labels are escaped', () => {
  assert.ok(!KpiCard.kpiCard({ label: '<b>x</b>', value: 1 }).includes('<b>x</b>'));
  assert.ok(!KpiCard.bulletBar({ label: '<b>x</b>', actual: 1 }).includes('<b>x</b>'));
});
