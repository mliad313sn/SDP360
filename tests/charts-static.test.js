'use strict';
// A-22 — one chart theme, no dual axis on the helpdesk trends, no RAG hex in Chart.js configs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { fnSource } = require('./_fn-source.js');
const TrendPanel = require('../public/lib/charts.js');
const ChartTheme = require('../public/lib/chartTheme.js');

const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8').replace(/\r\n/g, '\n');
const INDEX = read('index.html');
const REPORTS = read('reports.html');

/** Every `new Chart( … )` call, paren-balanced. Throws when none is found (no vacuous pass). */
function chartBlocks(src) {
  const out = []; let i = 0;
  for (;;) {
    i = src.indexOf('new Chart(', i); if (i < 0) break;
    let j = i + 'new Chart('.length, d = 1;
    while (d && j < src.length) { if (src[j] === '(') d++; else if (src[j] === ')') d--; j++; }
    out.push(src.slice(i, j)); i = j;
  }
  if (!out.length) throw new Error('no new Chart( block found');
  return out;
}

test('index.html and reports.html helpdesk trends no longer use a second y-axis', () => {
  const trend = fnSource(INDEX, 'renderTrend');
  const hd = fnSource(REPORTS, 'renderHdCharts');
  for (const [name, body] of [['index renderTrend', trend], ['reports renderHdCharts', hd]]) {
    assert.ok(body.includes('TrendPanel.render('), `${name} uses TrendPanel`);
    assert.ok(!/yAxisID/.test(body) && !/\by2\b/.test(body), `${name}: no yAxisID / y2`);
  }
  assert.ok(/<div class="chart-wrap" id="cTrend"><\/div>/.test(INDEX));
  assert.ok(/<div id="hdc-trend"><\/div>/.test(REPORTS));
});

test('every page that loads Chart.js loads lib/chartTheme.js right after it (same defer/nonce)', () => {
  const pages = fs.readdirSync(PUB).filter((f) => f.endsWith('.html'));
  const chartPages = pages.filter((f) => /chart\.umd\.js/.test(read(f)));
  assert.ok(chartPages.length >= 17, 'found the Chart.js pages: ' + chartPages.length);
  for (const f of chartPages) {
    const s = read(f);
    const m = /<script\b([^>]*)src="vendor\/chart\.js\/[^"]+"([^>]*)><\/script>\s*<script\b([^>]*)src="lib\/chartTheme\.js"([^>]*)><\/script>/.exec(s);
    assert.ok(m, `${f}: chartTheme.js immediately after Chart.js`);
    assert.strictEqual(/\bdefer\b/.test(m[1] + m[2]), /\bdefer\b/.test(m[3] + m[4]), `${f}: same defer`);
    assert.strictEqual(/nonce=/.test(m[1] + m[2]), /nonce=/.test(m[3] + m[4]), `${f}: same nonce`);
  }
  for (const s of [INDEX, REPORTS]) assert.match(s, /src="lib\/chartTheme\.js"[^>]*><\/script>\s*<script\b[^>]*src="lib\/charts\.js"/);
});

test('no RAG hex literal inside a new Chart( … ) config of index.html or reports.html', () => {
  const HEX = ['#DC2626', '#D90038', '#E74C3C', '#EF4444', '#16A34A', '#27AE60', '#22C55E', '#10B981', '#D97706', '#E87722', '#EF631A', '#F59E0B', '#F39C12'];
  for (const [name, src] of [['index.html', INDEX], ['reports.html', REPORTS]]) {
    for (const blk of chartBlocks(src)) for (const h of HEX) assert.ok(!blk.toUpperCase().includes(h), `${name}: ${h} in a Chart config`);
  }
});

test('no chart font under 12 px inside a new Chart( … ) config of index.html or reports.html', () => {
  for (const [name, src] of [['index.html', INDEX], ['reports.html', REPORTS]]) {
    for (const blk of chartBlocks(src)) assert.ok(!/size\s*:\s*(\d|1[01])(\.\d+)?\s*[,}]/.test(blk), `${name}: font < 12 px`);
  }
  for (const [name, body] of [['index', fnSource(INDEX, 'renderTrend')], ['reports', fnSource(REPORTS, 'renderHdCharts')]]) {
    assert.ok(!/size\s*:\s*(\d|1[01])(\.\d+)?\s*[,}]/.test(body), `${name}: trend font < 12 px`);
  }
});

test('TrendPanel: volume bars over rate lines, one y-axis each, nulls stay gaps, colours from the theme', () => {
  const c = ChartTheme.read(() => '');
  const cfg = TrendPanel.buildConfigs({ labels: ['W1', 'W2', 'W3'], unit: '%',
    volume: [{ label: 'Inbound', data: [3, 0, 5] }, { label: 'Closed', data: [2, 1, 4] }],
    rate: [{ label: 'Res %', data: [10, null, 20], target: 10 }, { label: 'FR %', data: [null, null, 5] }] }, c);
  assert.deepStrictEqual(Object.keys(cfg.volume.options.scales).sort(), ['x', 'y']);
  assert.deepStrictEqual(Object.keys(cfg.rate.options.scales).sort(), ['x', 'y']);
  assert.ok(cfg.volume.data.datasets.every((d) => d.type === 'bar' && !d.yAxisID));
  const lines = cfg.rate.data.datasets.filter((d) => !/target/.test(d.label));
  assert.strictEqual(lines.length, 2);
  assert.ok(lines.every((d) => d.spanGaps === false), 'null points are gaps');
  assert.deepStrictEqual(lines[0].data, [10, null, 20], 'data passed through untouched (null stays null)');
  assert.strictEqual(cfg.volume.data.datasets[0].borderColor, c.series[0]);
  assert.strictEqual(lines[0].borderColor, c.series[2], 'rate lines continue the categorical order');
  const tgt = cfg.rate.data.datasets.filter((d) => /target/.test(d.label));
  assert.strictEqual(tgt.length, 1, 'a target line only when a target is given');
  assert.deepStrictEqual(tgt[0].data, [10, 10, 10]);
  assert.strictEqual(tgt[0].borderColor, c.target);
  assert.ok(tgt[0].borderDash && tgt[0].borderDash.length, 'dashed target');
  assert.strictEqual(cfg.rate.options.scales.y.max, 100);
  assert.strictEqual(cfg.rate.options.scales.y.ticks.callback(40), '40%');
  assert.strictEqual(cfg.rate.options.plugins.tooltip.callbacks.label({ dataset: { label: 'Res %' }, raw: 12 }), ' Res %: 12%');
  assert.strictEqual(cfg.rate.options.plugins.tooltip.callbacks.label({ dataset: { label: 'Res %' }, raw: null }), ' Res %: — not measured');
  assert.strictEqual(cfg.rate.options.plugins.legend.position, 'bottom');
});

test('TrendPanel: per-dataset extras and per-panel options merge without dropping the theme', () => {
  const cfg = TrendPanel.buildConfigs({ labels: ['a'], volume: [{ label: 'v', data: [1], extra: { datalabels: { color: '#000' } } }],
    rate: [{ label: 'r', data: [1] }], rateOptions: { plugins: { datalabels: { display: false } } } });
  assert.deepStrictEqual(cfg.volume.data.datasets[0].datalabels, { color: '#000' });
  assert.strictEqual(cfg.rate.options.plugins.datalabels.display, false);
  assert.strictEqual(cfg.rate.options.plugins.legend.position, 'bottom', 'merge keeps the theme keys');
});
