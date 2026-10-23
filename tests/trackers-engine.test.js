'use strict';
// Step 7 — the business-tracker engine reproduces the IT Activity Tracker 2026 engine (every KPI type, shared items,
// inactive items, windows that start late), the definition validator, the migration, the templates and the
// Excel / slides exchange. No database.
const test = require('node:test');
const assert = require('node:assert');
const Engine = require('../public/lib/trackerEngine');
const tdef = require('../services/trackers/definition');
const { fromLegacy } = require('../services/trackers/legacyImport');
const { compare } = require('../services/trackers/legacyCompare');
const { TEMPLATES, instantiate } = require('../services/trackers/templates');
const exchange = require('../services/trackers/exchange');

const KINDS = ['COUNT', 'PERCENT', 'BOOLEAN', 'MILESTONE', 'CURRENCY', 'RATING'];
function randomTracker(seed) {
  const D = JSON.parse(JSON.stringify(require('../tracker-init.json')));
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  D.activities.forEach((a, i) => { a.kpi = KINDS[(i + seed) % 6]; if (i % 5 === 0) { a.start = 3; a.end = 9; } if (i % 7 === 0) a.shared = true; });
  D.inputs = { 2026: {} };
  for (const site of D.sites) {
    D.inputs[2026][site] = D.activities.map(a => Array.from({ length: 12 }, () => (rnd() < 0.3 ? 0
      : a.kpi === 'BOOLEAN' ? (rnd() < 0.5 ? 0.5 : 1) : a.kpi === 'PERCENT' ? Math.round(rnd() * 100) : a.kpi === 'RATING' ? Math.ceil(rnd() * 5) : Math.round(rnd() * 20))));
    D.targets[site] = D.activities.map(a => ({ target: a.kpi === 'COUNT' ? String(Math.round(rnd() * 60)) : a.kpi === 'CURRENCY' ? String(rnd() < 0.2 ? 0 : Math.round(rnd() * 100))
      : a.kpi === 'MILESTONE' ? '3' : a.kpi === 'RATING' ? '4' : a.kpi === 'PERCENT' ? (rnd() < 0.2 ? '' : '90') : 'TRUE/FALSE', active: rnd() < 0.85 }));
  }
  return D;
}

test('the new engine reproduces the legacy engine exactly (5 random trackers, every KPI type, 12 months)', () => {
  for (const seed of [3, 7, 11, 19, 23]) {
    const r = compare(randomTracker(seed), 2026);
    assert.ok(r.checks > 3000, 'the comparison really ran');
    assert.equal(r.max_gap_points, 0, `seed ${seed}: ${JSON.stringify(r.worst.slice(0, 3))}`);
    assert.equal(r.colour_mismatches, 0, `seed ${seed}`);
    assert.ok(r.accepted);
  }
});

test('the migrated definition is valid and keeps units, groups, items and targets', () => {
  const D = randomTracker(5);
  const { definition, values } = fromLegacy(D, 2026, { siteIdOf: (c) => (c === 'MGO' ? 3 : null) });
  const v = tdef.validate(definition);
  assert.deepStrictEqual(v.errors, []);
  assert.equal(v.definition.items.length, D.activities.length);
  assert.equal(v.definition.units.length, D.sites.length);
  assert.deepStrictEqual(v.definition.units.filter(u => u.active).map(u => u.code), D.activeSites);
  assert.equal(v.definition.units.find(u => u.code === 'MGO').site_id, 3);
  assert.equal(new Set(v.definition.items.map(i => i.code)).size, D.activities.length, 'unique item codes');
  assert.equal(values.MGO[v.definition.items[0].code].length, 12);
});

test('validator: blocking errors and warnings', () => {
  const base = { id: 'my-tracker', year: 2026, title: 'T', units: [{ code: 'A', site_id: 1 }], groups: [{ code: 'G', weight: 1 }],
    items: [{ code: 'I', name: 'Item', group: 'G', kpi: 'COUNT', weight: 1 }], targets: { A: { I: { target: '10', active: true } } } };
  assert.deepStrictEqual(tdef.validate(base).errors, []);
  const errs = (p, o) => tdef.validate({ ...base, ...p }, o).errors.join(' | ');
  assert.match(errs({ id: 'Bad Id' }), /id:/);
  assert.match(errs({ year: 1990 }), /year/);
  assert.match(errs({ units: [] }), /at least one unit/);
  assert.match(errs({ units: [{ code: 'A', active: false }] }), /active unit/);
  assert.match(errs({ items: [{ code: 'I', name: 'x', group: 'NOPE', kpi: 'COUNT', weight: 1 }] }), /unknown group/);
  assert.match(errs({ items: [{ code: 'I', name: 'x', group: 'G', kpi: 'SQL', weight: 1 }] }), /kpi/);
  assert.match(errs({ items: [{ code: 'I', name: 'x', group: 'G', kpi: 'COUNT', weight: 1, start: 9, end: 3 }] }), /start/);
  assert.match(errs({ items: [{ code: 'I', name: '<b>x</b>', group: 'G', kpi: 'COUNT', weight: 1 }] }), /HTML/);
  assert.match(errs({ targets: { Z: {} } }), /unknown unit/);
  assert.match(errs({ rag_policy: 'sla_pct' }), /rag_policy/, 'only a 0-1 policy of kpiRag');
  assert.match(errs({ items: [{ code: 'I', name: 'x', group: 'G', kpi: 'COUNT', weight: 1, source: { metric: 'helpdesk.nope' } }] }, { servedMetrics: new Set(['helpdesk.inbound']) }), /not a served/);
  const w = tdef.validate({ ...base, groups: [{ code: 'G', weight: 0.6 }] }).warnings.join(' | ');
  assert.match(w, /add up to 60 %/);
  assert.match(tdef.validate({ ...base, targets: {} }).warnings.join(' '), /no active item/);
  assert.match(tdef.validate({ ...base, legacy_mirror: true }).warnings.join(' '), /parallel run/);
});

test('every template gives a valid definition', () => {
  const units = [{ code: 'MGO', name: 'Mana', site_id: 1, active: true }, { code: 'HGO', name: 'Houndé', site_id: 2, active: true }];
  for (const t of TEMPLATES) {
    const d = instantiate(t.key, { id: 'tpl-' + t.key, year: 2026, units });
    const v = tdef.validate(d);
    assert.deepStrictEqual(v.errors, [], t.key);
    assert.ok(v.warnings.every(x => !/no active item/.test(x)), t.key);
  }
  assert.ok(TEMPLATES.length >= 4, 'dispatch, deployment, maintenance, meetings');
  assert.equal(instantiate('nope', { id: 'x', year: 2026, units }), null);
});

test('engine: colours come from kpiRag, a linked or missing cell counts 0, a window that has not started is N/A', () => {
  const d = tdef.validate({ id: 'mini', year: 2026, title: 'm', units: [{ code: 'A' }, { code: 'B' }], groups: [{ code: 'G', weight: 1 }],
    items: [{ code: 'C', name: 'c', group: 'G', kpi: 'COUNT', weight: 1, start: 1, end: 12 }, { code: 'L', name: 'l', group: 'G', kpi: 'COUNT', weight: 1, start: 6, end: 12 }],
    targets: { A: { C: { target: '12', active: true }, L: { target: '7', active: true } }, B: { C: { target: '12', active: true } } } }).definition;
  const values = { A: { C: [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
  const s = Engine.score(d, values, 'A', 4);
  assert.equal(s[0].ya, 3); assert.equal(s[0].yt, 4); assert.equal(s[0].sc, 0.75); assert.equal(s[0].rg, 'AMBER');
  assert.equal(s[1].rg, 'N/A', 'starts in June');
  assert.equal(Engine.unitSummary(d, values, 'B', 4).avg, 0);
  const f = Engine.fleet(d, values, 4);
  assert.equal(f.best, 'A'); assert.equal(f.worst, 'B'); assert.equal(f.trends.length, 4);
});

test('Excel export → import round trip; unknown units and non-numbers are reported, never guessed', async () => {
  const D = randomTracker(13);
  const { definition, values } = fromLegacy(D, 2026);
  const def = tdef.validate(definition).definition;
  const buf = exchange.workbook(def, values, 6);
  const back = exchange.parseImport(def, buf);
  assert.deepStrictEqual(back.rejected, []);
  const count = def.units.length * def.items.length * 12;
  assert.equal(back.cells.length, count);
  const c = back.cells.find(x => x.unit === 'HGO' && x.item === def.items[2].code && x.month === 5);
  assert.equal(c.value, values.HGO[def.items[2].code][4]);
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 'Unité': 'ZZZ', 'Code élément': def.items[0].code, M1: 1 }, { 'Unité': 'HGO', 'Code élément': def.items[0].code, M1: 'abc', M2: '2,5' }]), 'Saisies');
  const bad = exchange.parseImport(def, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(bad.rejected.length, 2);
  assert.deepStrictEqual(bad.cells, [{ unit: 'HGO', item: def.items[0].code, month: 2, value: 2.5 }], 'decimal comma accepted');
  const pptx = await exchange.slides(def, values, 6);
  assert.ok(Buffer.isBuffer(pptx) && pptx.length > 10000, 'a real deck');
});
