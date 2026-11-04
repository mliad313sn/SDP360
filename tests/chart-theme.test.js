'use strict';
// A-22 — one Chart.js theme read from the design tokens (public/lib/chartTheme.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ChartTheme = require('../public/lib/chartTheme.js');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', '_tokens.css'), 'utf8').replace(/\r\n/g, '\n');
const VARS = {};
for (const m of CSS.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) if (!(m[1] in VARS)) VARS[m[1]] = m[2].replace(/\/\*.*?\*\//g, '').trim();
const getVar = (n) => VARS[n] || '';

function lum(h) {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const onWhite = (h) => 1.05 / (lum(h) + 0.05);

test('colors.rag equals the _tokens.css --rag-* values', () => {
  const c = ChartTheme.read(getVar);
  assert.deepStrictEqual(c.rag, { green: VARS['--rag-green'], amber: VARS['--rag-amber'], red: VARS['--rag-red'], na: VARS['--rag-na'] });
});

test('six series colours, read from the tokens, each ≥ 3:1 against white', () => {
  const c = ChartTheme.read(getVar);
  assert.strictEqual(c.series.length, 6);
  c.series.forEach((h, i) => {
    assert.strictEqual(h, VARS[`--chart-series-${i + 1}`]);
    assert.ok(onWhite(h) >= 3, `${h} = ${onWhite(h).toFixed(2)}:1`);
  });
});

test('missing CSS variables fall back to the hard defaults (which match the tokens)', () => {
  const c = ChartTheme.read(() => '');
  assert.deepStrictEqual(c, ChartTheme.read(getVar), 'the hard-coded fallbacks are the same values as _tokens.css');
  assert.deepStrictEqual(ChartTheme.read(), ChartTheme.read(() => ''), 'no getVar and no DOM → defaults');
});

test('apply() sets font ≥ 12 px, legend at the bottom, token colours and the page locale on a stub Chart', () => {
  const Chart = { defaults: { font: { size: 10, family: 'x' }, plugins: { legend: { position: 'top', labels: {} }, tooltip: {} }, scale: { grid: {} } } };
  ChartTheme.apply(Chart, { getVar, locale: 'fr-FR' });
  assert.ok(Chart.defaults.font.size >= 12);
  assert.match(Chart.defaults.font.family, /Libre Franklin/);
  assert.strictEqual(Chart.defaults.plugins.legend.position, 'bottom');
  assert.strictEqual(Chart.defaults.color, VARS['--chart-text']);
  assert.strictEqual(Chart.defaults.locale, 'fr-FR');
  assert.strictEqual(Chart.defaults.scale.grid.color, VARS['--chart-grid']);
  assert.strictEqual(ChartTheme.apply(null), false, 'no Chart → no throw');
});

test('alpha() turns a token hex into an rgba fill', () => {
  assert.strictEqual(ChartTheme.alpha('#145FAE', 0.5), 'rgba(20,95,174,0.5)');
  assert.strictEqual(ChartTheme.alpha('nonsense', 0.5), 'nonsense');
});
