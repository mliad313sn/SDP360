'use strict';
// C-07 (F19, F28, G26) — accessible charts everywhere: the chart theme registers a Chart.js plugin that gives
// every canvas role="img", a one-line summary and a collapsible data table built from the chart's own data;
// TrendPanel adds one table per panel; animations stop under prefers-reduced-motion; the PPM diagrams share
// one keyboard model (roving index), extended to the risk matrix.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ChartTheme = require('../public/lib/chartTheme.js');
const TrendPanel = require('../public/lib/charts.js');
const PpmVisuals = require('../public/lib/ppmVisuals.js');
const { makeEl } = require('./_analytics-page-harness.js');

const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8').replace(/\r\n/g, '\n');

function fakeDoc() {
  const made = [];
  return {
    made,
    head: makeEl('head', 'HEAD'),
    createElement: (t) => { const e = makeEl('', t.toUpperCase()); made.push(e); return e; },
    getElementById: (id) => made.find((e) => e.id === id && e.parentNode) || null,
  };
}
/** card > h3 + wrap > canvas — the common page shape. */
function fakeChart(o = {}) {
  const doc = fakeDoc();
  const card = makeEl('', 'DIV'); const h3 = makeEl('', 'H3'); h3.textContent = 'Tickets per site';
  const wrap = makeEl('', 'DIV'); const cv = makeEl(o.id || '', 'CANVAS');
  card.appendChild(h3); card.appendChild(wrap); wrap.appendChild(cv);
  cv.ownerDocument = doc;
  cv.closest = (s) => (/card/.test(s) ? card : null);
  card.querySelector = (s) => (/h3/.test(s) ? h3 : null);
  if (o.aria) cv.setAttribute('aria-label', o.aria);
  if (o.mode) cv.setAttribute('data-chart-table', o.mode);
  const chart = {
    canvas: cv,
    options: { plugins: { title: o.title ? { display: true, text: o.title } : {} } },
    data: o.data || { labels: ['Ity', 'Mana', 'Hounde'], datasets: [{ label: 'Tickets', data: [5, null, 2] }] },
  };
  return { doc, card, wrap, cv, chart };
}
const tableOf = (doc, cv) => doc.made.find((e) => e.id === cv.id + '-table' && e.parentNode);

test('ChartTable lives in the theme (loaded on all 17 chart pages) and charts.js re-exports the same object', () => {
  assert.ok(ChartTheme.ChartTable && typeof ChartTheme.ChartTable.attach === 'function');
  assert.strictEqual(TrendPanel.ChartTable, ChartTheme.ChartTable);
  assert.ok(ChartTheme.a11yPlugin && ChartTheme.a11yPlugin.id === 'edvA11y');
});

test('apply() registers the a11y plugin once on Chart.js 4 (Chart.register)', () => {
  const reg = [];
  const Chart = { defaults: {}, register: (p) => reg.push(p) };
  ChartTheme.apply(Chart, { reducedMotion: false });
  ChartTheme.apply(Chart, { reducedMotion: false });
  assert.equal(reg.length, 1);
  assert.strictEqual(reg[0], ChartTheme.a11yPlugin);
});

test('G26 prefers-reduced-motion: apply() turns Chart.js animation off; otherwise it is left alone', () => {
  const calm = { defaults: { animation: { duration: 400 } }, register() {} };
  ChartTheme.apply(calm, { reducedMotion: true });
  assert.strictEqual(calm.defaults.animation, false);
  const busy = { defaults: { animation: { duration: 400 } }, register() {} };
  ChartTheme.apply(busy, { reducedMotion: false });
  assert.deepStrictEqual(busy.defaults.animation, { duration: 400 });
  assert.strictEqual(ChartTheme.prefersReducedMotion({ matchMedia: (q) => ({ matches: /reduce/.test(q) }) }), true);
  assert.strictEqual(ChartTheme.prefersReducedMotion({}), false, 'no matchMedia → motion kept');
});

test('F19/G26 plugin: any Chart.js canvas gets role=img, a summary label and a data table with one row per label', () => {
  const { doc, card, wrap, cv, chart } = fakeChart({ aria: 'Open tickets by site' });
  ChartTheme.a11yPlugin.afterUpdate(chart);
  assert.equal(cv.attrs.role, 'img');
  assert.ok(cv.id, 'an id is given so the table can be referenced');
  assert.match(cv.attrs['aria-label'], /^Open tickets by site — 3 rows\. Tickets: highest Ity \(5\)/);
  assert.match(cv.attrs['aria-label'], /1 not measured/);
  assert.equal(cv.attrs['aria-describedby'], cv.id + '-table');
  assert.equal(cv.attrs['data-chart-table'], 'auto');
  const det = tableOf(doc, cv);
  assert.ok(det && det.tagName === 'DETAILS');
  assert.equal(card.children.indexOf(det), card.children.indexOf(wrap) + 1, 'placed after the sized wrapper, not inside it');
  assert.equal((det.innerHTML.match(/<tr>/g) || []).length, 4, 'header + 3 rows');
  // an update (resize, new data) re-describes in place: same title, one table
  chart.data.labels.push('Ity 2'); chart.data.datasets[0].data.push(1);
  ChartTheme.a11yPlugin.afterUpdate(chart);
  assert.match(cv.attrs['aria-label'], /^Open tickets by site — 4 rows/, 'the original title is kept, not nested');
  assert.equal(doc.made.filter((e) => e.id === cv.id + '-table' && e.parentNode).length, 1);
  assert.ok(doc.head.children.some((e) => e.id === 'edv-chart-a11y-css'), 'table styles injected once');
});

test('plugin title falls back to the Chart.js title, then to the card heading', () => {
  const a = fakeChart({ title: 'Changes by type' });
  ChartTheme.a11yPlugin.afterUpdate(a.chart);
  assert.match(a.cv.attrs['aria-label'], /^Changes by type — /);
  const b = fakeChart();
  ChartTheme.a11yPlugin.afterUpdate(b.chart);
  assert.match(b.cv.attrs['aria-label'], /^Tickets per site — /);
});

test('plugin leaves page-managed (analytics) and opted-out canvases alone', () => {
  for (const mode of ['page', 'off']) {
    const { doc, cv, chart } = fakeChart({ id: 'c1', aria: 'Kept', mode });
    ChartTheme.a11yPlugin.afterUpdate(chart);
    assert.equal(cv.attrs['aria-label'], 'Kept');
    assert.equal(tableOf(doc, cv), undefined);
  }
  // a manual ChartTable.attach marks its target as page-managed
  const m = fakeChart({ id: 'c2' });
  ChartTheme.ChartTable.attach(m.cv, { title: 'T', labels: ['a'], datasets: [{ data: [1] }] }, m.doc);
  assert.equal(m.cv.attrs['data-chart-table'], 'page');
});

test('plugin reads {x,y} points (scatter/time) as their y value, labels from x when the chart has none', () => {
  const { cv, chart } = fakeChart({ aria: 'Scatter', data: { datasets: [{ label: 'P', data: [{ x: 'W1', y: 3 }, { x: 'W2', y: 7 }] }] } });
  ChartTheme.a11yPlugin.afterUpdate(chart);
  assert.match(cv.attrs['aria-label'], /2 rows\. P: highest W2 \(7\), lowest W1 \(3\)/);
});

test('plugin never throws on a chart without a canvas or data', () => {
  assert.doesNotThrow(() => ChartTheme.a11yPlugin.afterUpdate({}));
  assert.doesNotThrow(() => ChartTheme.a11yPlugin.afterUpdate({ canvas: makeEl('x', 'CANVAS') }));
});

test('G26 TrendPanel.tableSpec: one table per panel, one row per period, volume + rate series (targets are not data)', () => {
  const spec = { labels: ['Jan', 'Feb', 'Mar'], unit: '%', volume: [{ label: 'Inbound', data: [3, 4, null] }], rate: [{ label: 'SLA', data: [90, null, 80], target: 95 }] };
  const t = TrendPanel.tableSpec(spec, 'Helpdesk trend');
  assert.equal(t.title, 'Helpdesk trend');
  assert.deepStrictEqual(t.datasets.map((d) => d.label), ['Inbound', 'SLA']);
  assert.equal(t.datasets[1].unit, '%');
  const rows = ChartTheme.ChartTable.rows(t);
  assert.equal(rows.rows.length, 3);
  assert.deepStrictEqual(rows.rows[2], ['Mar', '—', '80']);
});

test('G26 TrendPanel.render attaches its table and marks both canvases page-managed (no duplicate per pane)', () => {
  const src = fs.readFileSync(path.join(PUB, 'lib', 'charts.js'), 'utf8');
  const body = src.slice(src.indexOf('function render('), src.indexOf('function tableSpec('));
  assert.match(body, /\.attach\(el, tableSpec\(s\)/);
  assert.match(body, /data-chart-table/);
  assert.match(body, /aria-describedby/);
});

test('F28 PpmVisuals.navIndex: arrows / Home / End move a roving focus, clamped; other keys ignored', () => {
  const n = PpmVisuals.navIndex;
  assert.equal(n('ArrowDown', 0, 5), 1);
  assert.equal(n('ArrowRight', 4, 5), 4, 'clamped at the end');
  assert.equal(n('ArrowUp', 0, 5), 0, 'clamped at the start');
  assert.equal(n('ArrowLeft', 3, 5), 2);
  assert.equal(n('Home', 3, 5), 0);
  assert.equal(n('End', 1, 5), 4);
  assert.equal(n('a', 1, 5), -1);
  assert.equal(n('ArrowDown', -1, 5), -1, 'focus outside the set → no move');
  // 2-D (risk grid of 3 columns): up/down jump a row
  assert.equal(n('ArrowDown', 1, 9, { cols: 3 }), 4);
  assert.equal(n('ArrowUp', 1, 9, { cols: 3 }), 1);
  assert.equal(n('ArrowRight', 1, 9, { cols: 3 }), 2);
});

test('F28 project + portfolio use the shared navIndex; the risk matrix is arrow-navigable on both pages', () => {
  for (const f of ['project.html', 'portfolio.html']) {
    const src = read(f);
    assert.match(src, /PpmVisuals\.navIndex\(/, f + ' uses the shared keyboard model');
    assert.match(src, /\$\("risk-matrix"\)\.addEventListener\("keydown"/, f + ' risk matrix keyboard');
  }
  const html = PpmVisuals.riskMatrixHtml(PpmVisuals.riskMatrix([{ id: 1, probability: 3, impact: 3 }, { id: 2, probability: 1, impact: 1 }]), (x) => String(x));
  assert.match(html, /Arrow keys move between cells/);
});

test('every Chart.js page loads lib/chartTheme.js, so every chart gets the plugin without page code', () => {
  const pages = fs.readdirSync(PUB).filter((f) => f.endsWith('.html')).filter((f) => /vendor\/chart\.js\/[\d.]+\/chart\.umd\.js/.test(read(f)));
  assert.ok(pages.length >= 17, 'found ' + pages.length);
  for (const f of pages) assert.match(read(f), /lib\/chartTheme\.js/, f);
});
