// tests/asset-hygiene-visuals.test.js
// C-12 / G20 — the Hygiene tab gains (a) a completeness BULLET per site (owner / acquisition date / cost /
// scanned present %) and (b) an anomaly PARETO (hygiene kinds by count + cumulative %). The data shaping is a
// pure UMD helper (public/lib/assetHygieneVisuals.js) so it is tested here without a browser.
// Rules pinned: null = not measured (never drawn as 0), no money and no "$" anywhere, every value escaped,
// the Pareto is ordered and its last cumulative point is 100 %, and the page wires both visuals with the
// shared ChartTable (accessible table alternative) from lib/charts.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');
const V = require('../public/lib/assetHygieneVisuals.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets.html'), 'utf8').replace(/\r\n/g, '\n');

test('bulletRows: four present-% measures per site, null stays null (not measured)', () => {
  const rows = V.bulletRows([
    { site: 'MANA', total: 10, owner_pct: 40, age_pct: 90, cost_pct: 0, scan_pct: 55.5, completeness: 46.4 },
    { site: '', total: 0, owner_pct: null, age_pct: null, cost_pct: null, scan_pct: null, completeness: null },
  ]);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0].measures.map(m => [m.key, m.pct, m.band]),
    [['owner', 40, 'bad'], ['age', 90, 'good'], ['cost', 0, 'bad'], ['scan', 55.5, 'mid']]);
  assert.strictEqual(rows[0].measures[2].pct, 0, 'a measured zero stays 0');
  assert.strictEqual(rows[1].label, '(no site)');
  assert.ok(rows[1].measures.every(m => m.pct === null && m.band === 'none'), 'no assets → not measured, never 0');
});

test('bulletRows: sorted worst completeness first, unmeasured last', () => {
  const rows = V.bulletRows([
    { site: 'A', total: 5, owner_pct: 90, age_pct: 90, cost_pct: 90, scan_pct: 90, completeness: 90 },
    { site: 'B', total: 0, owner_pct: null, age_pct: null, cost_pct: null, scan_pct: null, completeness: null },
    { site: 'C', total: 5, owner_pct: 10, age_pct: 10, cost_pct: 10, scan_pct: 10, completeness: 10 },
  ]);
  assert.deepStrictEqual(rows.map(r => r.site), ['C', 'A', 'B']);
});

test('bulletHtml: escaped, accessible, no money glyph, "—" for not measured', () => {
  const out = V.bulletHtml(V.bulletRows([
    { site: '<b>X</b>', total: 3, owner_pct: 33.3, age_pct: null, cost_pct: 100, scan_pct: 0, completeness: 44.4 },
  ]));
  assert.ok(!out.includes('<b>X</b>') && out.includes('&lt;b&gt;X&lt;/b&gt;'), 'site escaped');
  assert.ok(!out.includes('$'), 'no dollar glyph');
  assert.match(out, /role="img" aria-label="Owner: 33\.3% present"/);
  assert.match(out, /aria-label="Acquisition date: not measured"/);
  assert.match(out, /<caption>/);
  assert.match(out, /<th scope="col">Owner<\/th>/);
  assert.ok(out.includes('width:33.3%'));
  assert.strictEqual(V.bulletHtml([]).includes('No assets in scope'), true);
});

test('pareto: kinds by count desc, pct + cumulative %, last cumulative = 100', () => {
  const p = V.pareto({ no_cost: 50, no_owner: 30, ghost: 0, discovered: 20 },
    { discovered: 'Discovered', no_owner: 'No owner', no_cost: 'No cost data', ghost: 'Ghost' });
  assert.strictEqual(p.state, 'VALID');
  assert.strictEqual(p.total, 100);
  assert.deepStrictEqual(p.rows.map(r => [r.kind, r.count, r.pct, r.cum_pct]),
    [['no_cost', 50, 50, 50], ['no_owner', 30, 30, 80], ['discovered', 20, 20, 100], ['ghost', 0, 0, 100]]);
});

test('pareto: ties keep the declared kind order; non-numeric counts are not measured (dropped, not 0)', () => {
  const p = V.pareto({ b: 5, a: 5, c: null, d: 'x' }, { a: 'A', b: 'B', c: 'C', d: 'D' });
  assert.deepStrictEqual(p.rows.map(r => r.kind), ['a', 'b']);
  assert.deepStrictEqual(p.unmeasured, ['c', 'd']);
});

test('pareto: zero anomalies → ZERO state with null percentages; no input → NO_DATA', () => {
  const z = V.pareto({ a: 0, b: 0 }, { a: 'A', b: 'B' });
  assert.strictEqual(z.state, 'ZERO');
  assert.ok(z.rows.every(r => r.pct === null && r.cum_pct === null));
  assert.strictEqual(V.pareto(null, {}).state, 'NO_DATA');
});

test('paretoSpec: same numbers handed to ChartTable (counts + cumulative %)', () => {
  const p = V.pareto({ x: 3, y: 1 }, { x: 'X', y: 'Y' });
  const s = V.paretoSpec(p);
  assert.deepStrictEqual(s.labels, ['X', 'Y']);
  assert.deepStrictEqual(s.datasets[0].data, [3, 1]);
  assert.deepStrictEqual(s.datasets[1].data, [75, 100]);
  assert.strictEqual(s.datasets[1].unit, '%');
  assert.strictEqual(s.state, 'VALID');
  const ChartTable = require('../public/lib/charts.js').ChartTable;
  assert.match(ChartTable.html(s), /<td class="num">75%?<\/td>|>75</);
});

test('page: Hygiene tab hosts the bullet + Pareto, loads the helper and ChartTable, drills from the Pareto', () => {
  assert.match(html, /<script src="lib\/charts\.js" defer><\/script>/);
  assert.match(html, /<script src="lib\/assetHygieneVisuals\.js" defer><\/script>/);
  const pane = html.slice(html.indexOf('<section id="pane-hygiene"'), html.indexOf('<!-- Drill-down -->', html.indexOf('<section id="pane-hygiene"')));
  assert.match(pane, /id="hyg-bullets"/);
  assert.match(pane, /<canvas id="hyg-chartPareto"><\/canvas>/);
  assert.match(html, /ChartTable\.attach\(document\.getElementById\('hyg-chartPareto'\)/);
  assert.match(html, /const V = window\.AssetHygieneVisuals;/);
  assert.match(html, /V\.pareto\(s\.by_kind \|\| null, KIND_LABEL\)/);
  assert.match(html, /V\.bulletHtml\(V\.bulletRows\(s\.by_site/);
  // a Pareto bar opens the SAME drill as the tile of that kind (tile = drill parity)
  assert.match(html, /drillHygKind\(row\.kind/);
});
