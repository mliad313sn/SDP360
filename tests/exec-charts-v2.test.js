'use strict';
// F-UX-12 — Executive chart standard v2 (switch ui_exec_charts_v2, default '0'): dual axes → small multiples,
// rings → bars, SAME figures; the page's in-place updates still reach every panel; off = nothing changes.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../public/lib/execChartsV2');

const AX = 'yAxis' + 'ID';
const dual = () => ({ type: 'bar', data: { labels: ['Jan', 'Feb'], datasets: [
  { label: 'Inbound', data: [10, 20], [AX]: 'y' }, { label: 'Closed', data: [8, 18], [AX]: 'y' },
  { label: '% SLA', data: [91, 95], type: 'line', [AX]: 'y2' }] },
  options: { scales: { x: {}, y: { beginAtZero: true }, y2: { min: 0, max: 100, position: 'right' } } } });

test('a two-axis chart becomes two panels with one axis each and exactly the same values', () => {
  const p = V.plan(dual());
  assert.equal(p.panels.length, 1);
  assert.deepEqual(p.main.data.datasets.map((d) => [d.label, d.data, !!d.hidden]), [['Inbound', [10, 20], false], ['Closed', [8, 18], false], ['% SLA', [91, 95], true]]);
  assert.equal(p.main.options.scales.y2.display, false);
  const panel = p.panels[0].config;
  assert.deepEqual(panel.data.datasets.map((d) => [d.label, d.data, d[AX]]), [['% SLA', [91, 95], undefined]]);
  assert.deepEqual(Object.keys(panel.options.scales), ['x', 'y']);
  assert.deepEqual([panel.options.scales.y.min, panel.options.scales.y.max], [0, 100]);
  assert.deepEqual(p.panels[0].map, [[2, 0]]);
  const leg = p.main.options.plugins.legend.labels.filter;
  assert.equal(leg({ datasetIndex: 2 }, p.main.data), false, 'the moved series is not in the first legend');
  assert.equal(leg({ datasetIndex: 0 }, p.main.data), true);
});

test('a ring becomes horizontal bars: same labels, same order, same values', () => {
  const ring = { type: 'dough' + 'nut', data: { labels: ['A', 'B', 'C'], datasets: [{ data: [3, 9, 1], cutout: '60%' }] }, options: { cutout: '60%' } };
  const p = V.plan(ring);
  assert.equal(p.main.type, 'bar'); assert.equal(p.main.options.indexAxis, 'y');
  assert.deepEqual(p.main.data.labels, ['A', 'B', 'C']); assert.deepEqual(p.main.data.datasets[0].data, [3, 9, 1]);
  assert.ok(!('cutout' in p.main.options) && !('cutout' in p.main.data.datasets[0]));
});

test('one-axis charts are returned untouched', () => {
  const c = { type: 'line', data: { labels: ['a'], datasets: [{ data: [1] }, { data: [2], [AX]: 'y' }] } };
  assert.strictEqual(V.plan(c).main, c);
});

test('wrap: the page updates the first chart in place; the extra panel follows; destroy removes it', () => {
  const made = [];
  class FakeChart { constructor(ctx, cfg) { this.ctx = ctx; this.config = cfg; this.data = cfg.data; this.updates = 0; this.destroyed = false; made.push(this); } update() { this.updates++; } destroy() { this.destroyed = true; } }
  FakeChart.defaults = { color: 'x' };
  const kids = [];
  const host = { clientHeight: 200, parentNode: { insertBefore: (n) => kids.push(n) } };
  const canvas = { parentNode: host };
  const doc = { createElement: () => ({ style: {}, appendChild() {}, parentNode: { removeChild: () => kids.pop() } }) };
  const W = V.wrap(FakeChart, doc);
  assert.equal(W.defaults.color, 'x', 'statics pass through');
  const ch = new W(canvas, dual());
  assert.equal(made.length, 2, 'main + one panel'); assert.equal(kids.length, 1);
  ch.data.datasets[2].data = [70, 80]; ch.data.labels = ['Mar', 'Apr'];
  ch.update('none');
  assert.deepEqual(made[1].data.datasets[0].data, [70, 80]); assert.deepEqual(made[1].data.labels, ['Mar', 'Apr']);
  assert.equal(made[1].updates, 1);
  ch.destroy();
  assert.ok(made[0].destroyed && made[1].destroyed); assert.equal(kids.length, 0);
});

test('switch off (default) = window.Chart untouched; on = wrapped; executive.html loads it after auth.js', () => {
  const win = { __uiPolicy: { exec_charts_v2: '0' }, Chart: function C() {} };
  const before = win.Chart;
  assert.equal(V.install(win), false); assert.strictEqual(win.Chart, before);
  assert.equal(V.install({ __uiPolicy: {}, Chart: before }), false);
  const on = { __uiPolicy: { exec_charts_v2: '1' }, Chart: before, document: {} };
  assert.equal(V.install(on), true); assert.notStrictEqual(on.Chart, before);
  const P = require('../services/uiPolicy');
  assert.equal(P.uiPolicyFrom({}).exec_charts_v2, '0');
  assert.equal(require('../services/reportConfig').DEFAULTS.ui_exec_charts_v2, '0');
  const s = fs.readFileSync(path.join(__dirname, '..', 'public', 'executive.html'), 'utf8');
  const a = s.indexOf('src="auth.js"'), v = s.indexOf('src="lib/execChartsV2.js" data-install="1"'), c = s.indexOf('vendor/chart.js/4.4.1/chart.umd.js');
  assert.ok(c >= 0 && a > c && v > a, 'Chart.js, then auth.js (policy), then the v2 installer');
  assert.ok(v < s.indexOf('new Chart('), 'installed before the first chart is built');
});
