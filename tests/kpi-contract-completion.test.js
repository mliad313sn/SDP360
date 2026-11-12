'use strict';
// F-DATA-07 — KPI contract completion: denominator, coverage, data state, definition on screen.
// Fixture readers only (no database, no production data).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const MR = require('../services/metricRegistry');
const R = require('../public/lib/dashboardRender');
const { resolveWidgets } = require('../services/dashboardData');
const ML = require('../tools/agent/metric-lineage');

const NOW = new Date('2026-11-12T08:00:00Z');
const rec = (extra) => ({ inbound: 40, closed: 30, close_pct: 75, sla_res_pct: 90, sla_reply_pct: 80, ...extra });
const deps = (extra) => ({ rdb: { getCalendarMonthlyHelpdesk: async (site) => (site === 9 ? null : rec(extra)) } });

test('SLA denominators: read from the reader when it returns them, null ("base not measured") when it does not — never invented', async () => {
  const reg = MR.createRegistry();
  const without = await reg.resolve('helpdesk.resolution_sla_pct', { site: 1, window: '2026-10', deps: deps(), now: NOW });
  assert.equal(without.base, null, 'the reader does not return its denominator yet: no n');
  const withDen = await reg.resolve('helpdesk.resolution_sla_pct', { site: 1, window: '2026-10', deps: deps({ sla_res_den: 28, sla_reply_den: 36 }), now: NOW });
  assert.deepEqual(withDen.base, { n: 28, label: 'closed tickets with an SLA rule (cancelled excluded)' });
  const reply = await reg.resolve('helpdesk.first_reply_sla_pct', { site: 1, window: '2026-10', deps: deps({ sla_res_den: 28, sla_reply_den: 36 }), now: NOW });
  assert.deepEqual(reply.base, { n: 36, label: 'responded tickets' });
  assert.equal((await reg.resolve('helpdesk.closure_pct', { site: 1, window: '2026-10', deps: deps(), now: NOW })).base.n, 40, 'existing bases unchanged');
});

test('data_state: measured · partial (running period) · not_measured · error · reader_not_wired', async () => {
  const reg = MR.createRegistry();
  const st = async (key, o, d) => (await reg.resolve(key, { site: 1, window: '2026-10', now: NOW, deps: d || deps(), ...o })).data_state;
  assert.equal(await st('helpdesk.resolution_sla_pct'), 'measured');
  assert.equal(await st('helpdesk.resolution_sla_pct', { window: '2026-11' }), 'partial', 'November is still running on 12 Nov');
  assert.equal(await st('helpdesk.resolution_sla_pct', { site: 9 }), 'not_measured');
  assert.equal(await st('helpdesk.resolution_sla_pct', {}, { rdb: { getCalendarMonthlyHelpdesk: async () => { throw new Error('db down'); } } }), 'error');
  reg.upsert({ key: 'x.no_reader', name: 'X', module: 'x', unit: 'count', window_kind: 'month', reader: 'x.none', field: 'v' });
  assert.equal(await st('x.no_reader'), 'reader_not_wired');
  // N9 — a row added in the table has no field: said, not a silent null
  reg.upsert({ key: 'x.no_field', name: 'X', module: 'helpdesk', unit: 'count', window_kind: 'month', reader: 'helpdesk.calendar_month' });
  const nf = await reg.resolve('x.no_field', { site: 1, window: '2026-10', deps: deps(), now: NOW });
  assert.equal(nf.data_state, 'reader_not_wired'); assert.match(nf.error, /no field declared/);
  assert.deepEqual(MR.DATA_STATES, ['measured', 'partial', 'not_measured', 'reader_not_wired', 'error']);
});

test('owner role: never a default placeholder — null in the seed, "to be named" in the lineage sheet', () => {
  assert.ok(!MR.SEED.some((m) => m.owner_role === 'service-support-manager'));
  assert.ok(MR.SEED.filter((m) => m.owner_role === null).length >= 40, 'the metrics nobody assigned stay unassigned');
  assert.equal(MR.SEED.find((m) => m.key === 'assets.total').owner_role, 'asset-manager', 'a role named in the seed is kept');
  const md = ML.build().markdown;
  assert.match(md, /`helpdesk\.inbound`[\s\S]*?\| Owner role \| to be named \|/);
  assert.ok(!md.includes('service-support-manager'));
  assert.match(md, /`helpdesk\.resolution_sla_pct`[\s\S]*?\| Denominator \| closed tickets with an SLA rule/);
  assert.match(md, /`helpdesk\.inbound`[\s\S]*?\| Denominator \| not a ratio \|/);
  assert.match(md, /\| Reader wired \| yes \|/);
  assert.ok(!/reads `UNKNOWN`/.test(md) && /no sync job/.test(md), 'N13: one wording for modules without a sync job');
});

test('fleet comparator: n measured sites OF the sites in scope', async () => {
  const def = { widgets: [{ id: 'k', type: 'kpi', metric: 'helpdesk.resolution_sla_pct', title: 'SLA', compare: 'fleet' }] };
  const sites = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 9, name: 'Unmeasured' }];
  const W = await resolveWidgets({ def, sites, site: 1, window: '2026-10', reg: MR.createRegistry(), dd: deps(), rdb: null, now: NOW });
  assert.deepEqual({ n: W.k.fleet.n, of: W.k.fleet.of }, { n: 2, of: 3 });
  assert.equal(W.k.data_state, 'measured');
  assert.equal(R.fleetCount(W.k.fleet), '2 of 3 sites');
});

test('definition drawer: formula, window, denominator, source job, certification — escaped; nothing without a dictionary row', () => {
  const m = MR.createRegistry().get('helpdesk.resolution_sla_pct');
  const d = { metric: m.key, value: 90, unit: '%', window: { label: '2026-10' }, base: { n: 28, label: 'closed tickets' }, data_state: 'measured' };
  const html = R.definitionDrawer(d, m, [{ module: 'helpdesk', job: 'zoho.requests', state: 'STALE', last_success: '2026-11-01T00:00:00.000Z' }]);
  assert.match(html, /^<details class="edv-kpi-def"><summary>Definition<\/summary>/);
  for (const needle of ['ITSM denominator', '2026-10 (month)', '28 closed tickets', 'zoho.requests — not current (last success 2026-11-01 00:00)', 'not certified', 'to be named', '<dd>measured</dd>']) assert.ok(html.includes(needle), needle);
  assert.match(R.definitionDrawer({ ...d, base: null }, m, []), /not returned by the reader[\s\S]*typed into the application — no sync job/);
  assert.equal(R.definitionDrawer(d, null, []), '');
  assert.ok(!R.definitionDrawer(d, { ...m, formula: '<img src=x onerror=1>' }, []).includes('<img'), 'dictionary text is escaped');
});

test('switch ui_kpi_definition_drawer: default 0, the page renders the drawer and "n of N" only when on', () => {
  assert.equal(require('../services/reportConfig').DEFAULTS.ui_kpi_definition_drawer, '0');
  const UP = require('../services/uiPolicy');
  assert.equal(UP.uiPolicyFrom({}).kpi_definition_drawer, '0');
  assert.equal(UP.uiPolicyFrom({ ui_kpi_definition_drawer: '1' }).kpi_definition_drawer, '1');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboards.html'), 'utf8');
  assert.match(page, /uiOn\('kpi_definition_drawer'\) && metricDefs \? R\.definitionDrawer\(/);
  assert.match(page, /uiOn\('kpi_definition_drawer'\) \? R\.fleetCount\(d\.fleet\) : d\.fleet\.n \+ ' sites'/, 'off: the former text');
  assert.match(page, /kpi_definition_drawer === '1' && !metricDefs && !metricDefsAsked/, 'the dictionary is fetched only when on');
});
