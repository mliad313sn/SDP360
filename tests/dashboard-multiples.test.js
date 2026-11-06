'use strict';
// E-V09 — the small-multiples widget type (switch ui_small_multiples, default '0' = not creatable).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../services/dashboardWidgets');
const R = require('../public/lib/dashboardRender');
const CG = require('../public/lib/composerGuide');
const { ChartTable } = require('../public/lib/chartTheme');
const MR = require('../services/metricRegistry');
const { resolveWidgets } = require('../services/dashboardData');

const KEYS = MR.SEED.map((m) => m.key);
const KINDS = Object.fromEntries(MR.SEED.map((m) => [m.key, m.window_kind]));
const doc = (metrics) => ({ key: 'sm', title: 'SM', audience: 'site', grid: { columns: 12 }, widgets: [{ id: 'm', type: 'multiples', metrics, layout: { x: 0, y: 0, w: 12, h: 4 } }] });
const ON = { metrics: KEYS, metricKinds: KINDS, smallMultiples: true };

test('validator: mixed units accepted, >6 refused, unknown metric refused, not creatable while the switch is 0', () => {
  // % (resolution SLA) + count (inbound): two units, two panels — the point of the type
  assert.deepEqual(D.validateDashboard(doc(['helpdesk.resolution_sla_pct', 'helpdesk.inbound']), ON).errors, []);
  assert.equal(D.validateDashboard(doc(['helpdesk.inbound']), ON).ok, false, 'fewer than 2');
  const seven = ['helpdesk.inbound', 'helpdesk.closed', 'helpdesk.closure_pct', 'helpdesk.resolution_sla_pct', 'helpdesk.first_reply_sla_pct', 'inspection.count', 'inspection.conformity_pct'];
  assert.match(D.validateDashboard(doc(seven), ON).errors[0].msg, /2-6 metric keys/);
  assert.match(D.validateDashboard(doc(['helpdesk.inbound', 'x.nope']), ON).errors[0].msg, /unknown metric x\.nope/);
  assert.match(D.validateDashboard(doc(['helpdesk.inbound', 'helpdesk.window_created']), ON).errors[0].msg, /do not mix weekly and monthly/);
  const off = D.validateDashboard(doc(['helpdesk.resolution_sla_pct', 'helpdesk.inbound']), { metrics: KEYS, metricKinds: KINDS });
  assert.equal(off.ok, false); assert.match(off.errors[0].msg, /ui_small_multiples=0/);
  // a stored multiples widget keeps saving / publishing after the switch is turned back off
  const d = doc(['helpdesk.resolution_sla_pct', 'helpdesk.inbound']);
  assert.equal(D.validateDashboard(d, { metrics: KEYS, metricKinds: KINDS, storedWidgets: d.widgets }).ok, true);
  assert.equal(D.validateDashboard(d, { allowRetired: true }).ok, true);
  assert.ok(!D.creatableTypes().includes('multiples'));
  assert.ok(D.creatableTypes({ smallMultiples: true }).includes('multiples'));
  assert.equal(D.widgetTypesFor({}).multiples.creatable, false);
});

test('render: one panel per metric with its own unit; the shared table has one column per panel; nulls are gaps', async () => {
  const deps = { rdb: { getCalendarMonthlyHelpdesk: async (site, y, m) => (m === 4 ? null : { inbound: 100 + m, closed: 90, close_pct: 90, sla_res_pct: 80 + m, sla_reply_pct: null }) } };
  const W = await resolveWidgets({ def: doc(['helpdesk.resolution_sla_pct', 'helpdesk.inbound']), sites: [{ id: 1, name: 'FIXTURE' }], site: 1, window: '2026-06', reg: MR.createRegistry(), dd: deps, rdb: null, now: new Date('2026-07-15T00:00:00Z') });
  const d = W.m;
  assert.equal(d.mode, 'multiples');
  assert.deepEqual(d.panels.map((p) => p.unit), ['%', 'count']);
  assert.ok(d.panels.every((p) => p.points.length === d.panels[0].points.length), 'same window for every panel');
  assert.ok(d.panels[0].points.some((p) => p.value == null), 'April (reader null) is a gap, never 0');
  const html = R.multiplesHtml(d, '');
  assert.equal((html.match(/class="edv-multiple"/g) || []).length, 2, 'one panel per metric');
  assert.match(html, /\(%\)/); assert.match(html, /\(count\)/);
  assert.ok(!/yAxisID/.test(html));
  const spec = R.multiplesTableSpec(d);
  const t = ChartTable.rows(spec);
  assert.equal(t.head.length, 1 + d.panels.length, 'table columns = panels');
  assert.equal(t.rows.length, d.panels[0].points.length);
  assert.ok(t.rows.some((r) => r[1] === '—'), 'gap shown as —');
});

test('composer offers multiples for intent "compare" only when the switch is on', () => {
  const off = CG.suggestTypes('compare', null, D.widgetTypesFor({})).map((x) => x.type);
  assert.ok(!off.includes('multiples'));
  const on = CG.suggestTypes('compare', null, D.widgetTypesFor({ smallMultiples: true })).find((x) => x.type === 'multiples');
  assert.ok(on && on.ok && on.suggested, JSON.stringify(on));
  const f = CG.fieldsFor('multiples', D.widgetTypesFor({ smallMultiples: true }), { metrics: MR.SEED }).find((x) => x.name === 'metrics');
  assert.equal(f.kind, 'multi'); assert.equal(f.max, 6);
  assert.ok(!f.options.some((o) => KINDS[o[0]] === 'current'), 'only metrics with a history');
});
