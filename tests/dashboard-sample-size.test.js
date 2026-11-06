'use strict';
// E-K02 — sample size and low-sample warning on dashboards (switch ui_kpi_sample_size, default '0').
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/lib/dashboardRender');
const MR = require('../services/metricRegistry');
const { resolveWidgets } = require('../services/dashboardData');

// FIXTURE — fictitious sites; closure rate's denominator is the tickets created (the reader returns it).
const SITES = [{ id: 1, name: 'Fixture North' }, { id: 2, name: 'Fixture South' }];
const INBOUND = { 1: 142, 2: 4 };
const deps = { rdb: { getCalendarMonthlyHelpdesk: async (site) => ({ inbound: INBOUND[site], closed: INBOUND[site] - 1, close_pct: 90, sla_res_pct: 88, sla_reply_pct: null }) } };
const DEF = { key: 'fixture-n', title: 'FIXTURE', widgets: [
  { id: 'k', type: 'kpi', metric: 'helpdesk.closure_pct', layout: { x: 0, y: 0, w: 3, h: 2 } },
  { id: 'g', type: 'ragGrid', metric: 'helpdesk.closure_pct', layout: { x: 3, y: 0, w: 6, h: 3 } },
  { id: 't', type: 'trend', metric: 'helpdesk.closure_pct', window: '3m', layout: { x: 0, y: 3, w: 12, h: 4 } },
  { id: 's', type: 'kpi', metric: 'helpdesk.resolution_sla_pct', layout: { x: 9, y: 0, w: 3, h: 2 } },
] };
const NOW = new Date('2026-07-15T00:00:00Z');
/** A fake pg handle: kpi_policies answers with `policy` (or nothing); every other table is empty. */
const fakeRdb = (policy) => ({ pgHandle: () => ({ prepare: (sql) => ({
  get: async () => (/FROM kpi_policies/.test(sql) && policy ? policy : null), all: async () => [], run: async () => ({}) }) }) });
const run = (rdb) => resolveWidgets({ def: DEF, sites: SITES, site: 2, window: '2026-06', reg: MR.createRegistry(), dd: deps, rdb, now: NOW });

test('n is present in the data where the reader returns the denominator, null elsewhere (never invented)', async () => {
  const W = await run(null);
  assert.equal(W.k.n, 4);
  assert.deepEqual(W.g.rows.map((r) => [r.site, r.n]).sort(), [['Fixture North', 142], ['Fixture South', 4]]);
  assert.ok(W.t.points.every((p) => p.n === 4));
  assert.equal(W.s.n, null, 'resolution SLA: the reader does not return its denominator');
  assert.equal(W.k.min_sample, null); assert.equal(W.k.low_sample, false, 'no adopted policy → no warning');
  assert.ok(W.g.rows.every((r) => r.low_sample === false));
});

test("renderer at '0' is byte-identical to before; at '1' shows n", async () => {
  const W = await run(null);
  assert.equal(R.ragGridHtml(W.g), R.ragGridHtml(W.g, {}), 'no option = off');
  assert.ok(!R.ragGridHtml(W.g).includes('n = '));
  const kOff = { ...W.k }; delete kOff.n; delete kOff.min_sample; delete kOff.low_sample;
  assert.equal(R.kpiContext(W.k), R.kpiContext(kOff), 'the new fields change nothing at 0');
  assert.match(R.ragGridHtml(W.g, { sampleSize: true }), /<span class="edv-ragcell-n">n = 142<\/span>/);
  assert.equal(R.sampleNote(W.k), '<div class="edv-sample">n = 4</div>');
  assert.equal(R.sampleNote(W.s), '', 'no n → nothing shown (not "n = 0")');
});

test('low sample — not comparable, and no delta, only with an ADOPTED policy min_sample', async () => {
  const adopted = { id: 7, version: 1, status: 'adopted', metric_key: 'helpdesk.closure_pct', effective_from: '2026-01-01', definition_json: JSON.stringify({ min_sample: 10 }) };
  const W = await run(fakeRdb(adopted));
  assert.equal(W.k.min_sample, 10); assert.equal(W.k.low_sample, true);
  assert.match(R.sampleNote(W.k), /low sample — not comparable \(n = 4 &lt; 10\)/);
  const ctx = { ...W.k, previous: { label: '2026-05', value: 80, delta: 10, comparable: true } };
  assert.match(R.kpiContext(ctx), /▲ \+10/, "switch off: the delta is shown as today");
  assert.ok(!/▲|▼/.test(R.kpiContext(ctx, { sampleSize: true })), 'switch on + low sample: no delta');
  const north = W.g.rows.find((r) => r.site === 'Fixture North'); const south = W.g.rows.find((r) => r.site === 'Fixture South');
  assert.equal(north.low_sample, false); assert.equal(south.low_sample, true);
  assert.match(R.ragGridHtml(W.g, { sampleSize: true }), /n = 4 · low sample — not comparable/);
  // a policy that is only PROPOSED never produces a warning
  const W2 = await run(fakeRdb({ ...adopted, status: 'proposed' }));
  assert.equal(W2.k.low_sample, false); assert.equal(W2.k.min_sample, null);
});
