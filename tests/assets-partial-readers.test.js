'use strict';
// F-DATA-08 (C04) — partial sources: keep the rows, say the total is unknown.
// assets.hygiene_site sums the AP labels of a site; an unreadable label used to be skipped and the total and the
// completeness were computed on the rest, with no flag. Fixture reader only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const MR = require('../services/metricRegistry');

const NOW = new Date('2026-11-12T08:00:00Z');
const SUM = { 'Fixture A': { total: 100, by_kind: { no_owner: 10, no_age: 20, no_cost: 30, ghost: 1 } }, 'Fixture B': { total: 50, by_kind: { no_owner: 5, no_age: 5, no_cost: 5 } } };
const deps = (behaviour) => ({ assetLabelsFor: async () => ['Fixture A', 'Fixture B'], adb: { getHygieneSummary: async ({ site }) => behaviour(site) } });
const res = (key, d) => MR.createRegistry().resolve(key, { site: 1, deps: d, now: NOW });

test('every label read: total, completeness and counts as before', async () => {
  const d = deps((l) => SUM[l]);
  assert.equal((await res('assets.total', d)).value, 150);
  assert.equal((await res('assets.no_owner', d)).value, 15);
  const c = await res('assets.completeness_pct', d);
  assert.equal(c.value, Math.round(100 * ((1 - 15 / 150) + (1 - 25 / 150) + (1 - 35 / 150)) / 3));
  assert.equal(c.data_state, 'measured'); assert.ok(!('partial_source' in c));
  assert.equal(c.base.n, 150);
});

for (const [name, bad] of [['throws', () => { throw new Error('label unreadable'); }], ['returns nothing', () => null]]) {
  test(`one label ${name}: total and completeness are null, the rows that were read are kept, the figure says partial`, async () => {
    const d = deps((l) => (l === 'Fixture B' ? bad() : SUM[l]));
    const t = await res('assets.total', d);
    assert.equal(t.value, null, 'not a confident 100 of an unknown total');
    assert.equal(t.data_state, 'partial');
    assert.deepEqual(t.partial_source, { read: 1, unread: 1, unread_labels: ['Fixture B'] });
    const c = await res('assets.completeness_pct', d);
    assert.equal(c.value, null); assert.equal(c.rag, 'NA'); assert.equal(c.base, null, 'no denominator on an unknown total');
    const o = await res('assets.no_owner', d);
    assert.equal(o.value, 10, 'available rows kept — an "at least" count');
    assert.equal(o.data_state, 'partial');
    assert.equal(o.partial_source.unread, 1);
  });
}

test('no label readable: an error when the reader failed, not measured when it returned nothing — never a 0', async () => {
  const e = await res('assets.total', deps(() => { throw new Error('assets store down'); }));
  assert.equal(e.value, null); assert.equal(e.data_state, 'error'); assert.match(e.error, /assets store down/);
  const n = await res('assets.total', deps(() => null));
  assert.equal(n.value, null); assert.equal(n.data_state, 'not_measured');
  const none = await MR.createRegistry().resolve('assets.total', { site: 1, deps: { assetLabelsFor: async () => [], adb: {} }, now: NOW });
  assert.equal(none.value, null); assert.equal(none.data_state, 'not_measured');
});

test('the partial source travels to the tile, the dashboard CSV and the report figure', async () => {
  const { resolveWidgets } = require('../services/dashboardData');
  const { dashboardCsvRows } = require('../services/dashboardCsv');
  const { analyse } = require('../services/reportAnalysis');
  const reg = MR.createRegistry();
  const def = { widgets: [{ id: 't', type: 'kpi', metric: 'assets.total', title: 'Assets' }, { id: 'o', type: 'kpi', metric: 'assets.no_owner', title: 'No user' }] };
  const W = await resolveWidgets({ def, sites: [{ id: 1, name: 'Fixture' }], site: 1, reg, dd: deps((l) => (l === 'Fixture B' ? null : SUM[l])), rdb: null, now: NOW });
  assert.equal(W.t.value, null); assert.equal(W.t.data_state, 'partial'); assert.equal(W.o.value, 10);
  const rows = dashboardCsvRows({ site: 1, sites: [{ id: 1, name: 'Fixture' }], sources: [], widgets: W, as_of: NOW.toISOString() }, reg);
  const head = rows[0]; const o = rows.find((r) => r[1] === 'assets.no_owner');
  assert.equal(o[head.indexOf('partial')], 'true'); assert.equal(o[head.indexOf('error')], 'partial source: 1 of 2 parts not read');
  const f = analyse({ widgets: W, registry: reg }).figures.find((x) => x.id === 'o');
  assert.equal(f.partial, true); assert.deepEqual(f.partial_source, { read: 1, unread: 1 });
});
