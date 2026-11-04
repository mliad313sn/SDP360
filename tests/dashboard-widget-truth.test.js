'use strict';
// C-04 — dashboard widget truth (F01 F02 F13 F24, G05 G06 G11-min): every offered type renders
// something distinct, heatmap is no longer offered, trackerRag resolves end to end, series[] is
// validated and resolved, and a missing chart library falls back to a table.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const W = require('../services/dashboardWidgets');
const R = require('../public/lib/dashboardRender');
const DD = require('../services/dashboardData');
const MR = require('../services/metricRegistry');

const L = (x, y, w = 6, h = 3) => ({ x, y, w, h });
const base = (widgets) => ({ key: 'c04', title: 'C-04', audience: 'site', grid: { columns: 12 }, widgets });

test('G11-min: every widget type declares a distinct render; heatmap is retired, not offered', () => {
  for (const [t, T] of Object.entries(W.WIDGET_TYPES)) assert.ok(T.render, `${t} declares render`);
  assert.equal(W.WIDGET_TYPES.bar.render, 'bar-list');
  assert.equal(W.WIDGET_TYPES.table.render, 'sortable-table');
  assert.equal(W.WIDGET_TYPES.ragGrid.render, 'rag-grid');
  assert.equal(W.WIDGET_TYPES.trackerRag.render, 'tracker-rag');
  assert.ok(!W.creatableTypes().includes('heatmap'));
  for (const t of ['kpi', 'trend', 'bar', 'table', 'ragGrid', 'trackerRag', 'text', 'actions']) assert.ok(W.creatableTypes().includes(t), t);
});

test('F01: a NEW heatmap is refused; an existing one (legacy id / stored definition) still validates', () => {
  const d = base([{ id: 'hm', type: 'heatmap', metric: 'helpdesk.inbound', layout: L(0, 0) }]);
  const r = W.validateDashboard(d);
  assert.equal(r.ok, false); assert.match(r.errors[0].msg, /no longer offered/);
  assert.equal(W.validateDashboard(d, { legacyIds: ['hm'] }).ok, true);
  assert.equal(W.validateDashboard(d, { allowRetired: true }).ok, true);
  assert.equal(W.validateDashboard(base(['bar', 'table', 'ragGrid'].map((t, i) => ({ id: t, type: t, metric: 'helpdesk.inbound', layout: L(0, i * 3, 12) })))).ok, true);
});

test('F02: trackerRag needs the Activity Tracker key (optionally year-pinned)', () => {
  const t = (k) => W.validateDashboard(base([{ id: 't', type: 'trackerRag', tracker: k, layout: L(0, 0) }]));
  assert.equal(t('it-activity').ok, true); assert.equal(t('it-activity-2026').ok, true);
  assert.equal(t('budget').ok, false); assert.equal(t(undefined).ok, false);
});

test('F24: series[] — unknown metric, mixed units, wrong type and repeats are refused', () => {
  const metrics = ['helpdesk.resolution_sla_pct', 'helpdesk.first_reply_sla_pct', 'helpdesk.inbound'];
  const units = { 'helpdesk.resolution_sla_pct': '%', 'helpdesk.first_reply_sla_pct': '%', 'helpdesk.inbound': 'count' };
  const tr = (series, type = 'trend') => W.validateDashboard(base([{ id: 'tr', type, metric: 'helpdesk.resolution_sla_pct', series, layout: L(0, 0, 12, 4) }]), { metrics, metricUnits: units });
  assert.equal(tr(['helpdesk.first_reply_sla_pct']).ok, true);
  assert.match(tr(['nope.metric']).errors.map((e) => e.msg).join(), /unknown metric nope.metric/);
  assert.match(tr(['helpdesk.inbound']).errors.map((e) => e.msg).join(), /mixes units/);
  assert.match(tr(['helpdesk.resolution_sla_pct']).errors.map((e) => e.msg).join(), /must not repeat/);
  assert.match(tr('helpdesk.inbound').errors.map((e) => e.msg).join(), /list of 1-4/);
  assert.match(tr(['helpdesk.first_reply_sla_pct'], 'kpi').errors.map((e) => e.msg).join(), /only available on trend/);
});

const D0 = { unit: '%', higher_is_better: true, title: 'SLA', rows: [
  { site: 'Hounde', value: 92, rag: 'GREEN', target: 90 }, { site: 'Ity', value: 70, rag: 'RED', target: 90 },
  { site: 'Mana', value: null, rag: 'GREEN' }, { site: 'Lafigue', value: 80, rag: 'WEIRD' }] };

test('F01: bar keeps a per-site bar list with a stated scale and per-bar labels', () => {
  const h = R.barListHtml(D0);
  assert.match(h, /bar scale 0 – 100 %/);
  assert.match(h, /aria-label="Hounde: 92 %"/);
  assert.match(h, /1 not measured/);
  assert.ok(!/<table/.test(h), 'a bar chart, not a table');
});

test('F01: table is a real sortable table — site, value, unit, target, state', () => {
  const h = R.tableHtml(D0);
  assert.match(h, /<table class="edv-data-table"/);
  for (const c of ['Site', 'Value', 'Unit', 'Target', 'State']) assert.match(h, new RegExp('data-sort="[a-z]+" data-dir="(asc|desc)">' + c));
  assert.match(h, /<th scope="row">Hounde<\/th><td class="num">92 %<\/td><td>%<\/td><td class="num">90 %<\/td>/);
  assert.deepEqual(R.sortTableRows(D0.rows, D0, 'value', 'asc').map((r) => r.site), ['Ity', 'Lafigue', 'Hounde', 'Mana'], 'not measured last');
  assert.deepEqual(R.sortTableRows(D0.rows, D0, 'value', 'desc').map((r) => r.site), ['Hounde', 'Lafigue', 'Ity', 'Mana']);
  assert.deepEqual(R.sortTableRows(D0.rows, D0, 'site', 'asc').map((r) => r.site), ['Hounde', 'Ity', 'Lafigue', 'Mana']);
  assert.match(R.tableHtml(D0, { col: 'site', dir: 'desc' }), /aria-sort="descending"><button[^>]*data-sort="site"/);
  // legacy heatmap → table with a notice
  assert.match(R.perSiteHtml('heatmap', { ...D0, notice: 'Heatmap widgets are no longer offered — shown as a table.' }), /edv-widget-notice[^>]*>Heatmap widgets are no longer offered[\s\S]*<table/);
});

test('F01: ragGrid — RAG + value + legend; null, stale and unknown rag are grey "unknown", never green', () => {
  const h = R.ragGridHtml(D0);
  assert.match(h, /class="edv-raggrid"/); assert.match(h, /edv-rag-legend/); assert.match(h, /Unknown — not measured, stale or never synced/);
  assert.match(h, /edv-ragcell-unknown" role="listitem" aria-label="Mana: Unknown, —"/, 'null value with a green rag is unknown');
  assert.match(h, /edv-ragcell-unknown" role="listitem" aria-label="Lafigue: Unknown, 80 %"/, 'unrecognised rag is unknown');
  assert.match(h, /edv-ragcell-green" role="listitem" aria-label="Hounde: Green, 92 %"/);
  const stale = { ...D0, freshness: 'STALE', rows: [{ site: 'Hounde', value: 92, rag: 'NA', rag_if_fresh: 'GREEN' }] };
  assert.ok(!/edv-ragcell-green/.test(R.ragGridHtml(stale)), 'a stale source is never green');
  assert.match(R.ragGridHtml(stale), /stale source, colour withheld/);
});

test('F13: the trend as a table (fallback when Chart.js is missing), multi-series columns', () => {
  const d = { title: 'SLA', unit: '%', target: 90, points: [{ label: '2026-W30', value: 91 }, { label: '2026-W31', value: null }],
    lines: [{ label: 'Resolution', unit: '%', points: [{ label: '2026-W30', value: 91 }, { label: '2026-W31', value: null }] }, { label: 'First reply', unit: '%', points: [{ label: '2026-W30', value: 80 }, { label: '2026-W31', value: 85 }] }] };
  const h = R.seriesTableHtml(d);
  assert.match(h, /<th scope="col">Resolution<\/th><th scope="col">First reply<\/th><th scope="col">Target<\/th>/);
  assert.match(h, /<th scope="row">2026-W31<\/th><td class="num">—<\/td><td class="num">85 %<\/td><td class="num">90 %<\/td>/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboards.html'), 'utf8');
  assert.match(html, /if \(!window\.Chart\) \{[^\n]*R\.seriesTableHtml\(d\)/, 'the viewer renders the table when the chart library is missing');
  assert.ok(!/is not rendered yet/.test(html.replace(/else el\.innerHTML = title \+ '<div class="edv-kpi-sub">Widget type[^\n]*/, '')), 'only the generic fallback mentions unrendered types');
  assert.match(html, /d\.mode === 'tracker'[\s\S]{0,80}R\.trackerHtml\(d\)/);
});

test('F02: trackerHtml — G/A/R per site + score; NO_DATA is said, not drawn as zeros', () => {
  const ok = R.trackerHtml({ state: 'OK', period: '2026-07', totals: { g: 3, a: 1, r: 1 }, fleet: { avg_pct: 64, sites: 2 },
    rows: [{ site: 'Hounde', g: 2, a: 1, r: 0, score_pct: 70, rag: 'GREEN' }, { site: 'Ity', g: 1, a: 0, r: 1, score_pct: 58, rag: 'AMBER' }], untracked: [] });
  assert.match(ok, /3 green · 1 amber · 1 red activities · score 64 % \(mean of 2 sites\)/);
  assert.match(ok, /Hounde<\/th><td class="num">2<\/td><td class="num">1<\/td><td class="num">0<\/td><td class="num">70 %<\/td>/);
  const none = R.trackerHtml({ state: 'NO_DATA', period: '2026-07', rows: [], untracked: ['Dakar'] });
  assert.match(none, /No tracker input for 2026-07/); assert.ok(!/<table/.test(none));
});

// ── resolver ───────────────────────────────────────────────────────────────────────────
function trackerD({ inputs }) {
  const acts = [{ name: 'A1', pillar: 'P1', kpi: 'COUNT', weight: 1, start: 1, end: 12, ann: 12 }, { name: 'A2', pillar: 'P1', kpi: 'BOOLEAN', weight: 1, start: 1, end: 12 }];
  const tg = () => [{ active: true, target: '12' }, { active: true, target: '1' }];
  return { year: 2026, activities: acts, pillarWeights: { P1: 1 }, activeSites: ['HGO', 'ITY', 'MGO'], sites: ['HGO', 'ITY', 'MGO'], siteNames: {},
    targets: { HGO: tg(), ITY: tg(), MGO: tg() }, inputs: { 2026: inputs } };
}
const SITES = [{ id: 1, name: 'Hounde' }, { id: 2, name: 'Ity' }, { id: 9, name: 'Dakar' }];
const codes = { 1: 'HGO', 2: 'ITY', 9: null };
const reg = MR.createRegistry();
const dd = (D) => ({ tracker: { loadTracker: async () => D }, trackerScore: require('../tracker-pptx'), codeFor: async (id) => ({ tracker_code: codes[id] }) });
const NOW = new Date('2026-07-15T10:00:00Z');

test('F02: trackerRag resolves per-site G/A/R + score via tracker-pptx ss/fleetStats, scoped to the caller sites', async () => {
  const D = trackerD({ inputs: { HGO: [[1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0], [1]], ITY: [[0, 1, 0, 0, 0, 0], [0]], MGO: [[5, 5, 5, 5, 5, 5], [1]] } });
  const def = { widgets: [{ id: 't', type: 'trackerRag', tracker: 'it-activity', title: 'Tracker', layout: L(0, 0) }] };
  const out = await DD.resolveWidgets({ def, sites: SITES, site: 1, window: '2026-06', reg, dd: dd(D), rdb: null, now: NOW });
  const t = out.t;
  assert.equal(t.mode, 'tracker'); assert.equal(t.state, 'OK'); assert.equal(t.period, '2026-06');
  assert.deepEqual(t.rows.map((r) => r.code), ['HGO', 'ITY'], 'MGO is not in the caller scope');
  assert.deepEqual(t.untracked, ['Dakar']);
  const pp = require('../tracker-pptx');
  const hg = pp.ss(D, 'HGO', 2026, 6);
  assert.deepEqual({ g: t.rows[0].g, a: t.rows[0].a, r: t.rows[0].r, s: t.rows[0].score_pct }, { g: hg.g, a: hg.a, r: hg.r, s: Math.round(hg.avg * 100) });
  assert.equal(t.fleet.avg_pct, Math.round(pp.fleetStats(D, ['HGO', 'ITY'], 2026, 6).avg * 100));
  assert.equal(t.totals.g, t.rows.reduce((s, r) => s + r.g, 0));
});

test('F02: trackerRag with no input for the period is NO_DATA — not a row of zeros', async () => {
  const D = trackerD({ inputs: { HGO: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], MGO: [[5]] } });
  const def = { widgets: [{ id: 't', type: 'trackerRag', tracker: 'it-activity', layout: L(0, 0) }] };
  const out = await DD.resolveWidgets({ def, sites: SITES, site: 1, window: '2026-06', reg, dd: dd(D), rdb: null, now: NOW });
  assert.equal(out.t.state, 'NO_DATA'); assert.deepEqual(out.t.rows, []);
  const bad = await DD.resolveWidgets({ def: { widgets: [{ id: 't', type: 'trackerRag', tracker: 'budget' }] }, sites: SITES, site: 1, reg, dd: dd(D), now: NOW });
  assert.match(bad.t.error, /unknown tracker/);
});

test('F24: a trend with series[] resolves one line per metric; mixed units is an error, never a second axis', async () => {
  const fake = MR.createRegistry([
    { key: 'a.pct', name: 'A', unit: '%', window_kind: 'week', reader: 'x', field: 'a', status: 'published' },
    { key: 'b.pct', name: 'B', unit: '%', window_kind: 'week', reader: 'x', field: 'b', status: 'published' },
    { key: 'c.count', name: 'C', unit: 'count', window_kind: 'week', reader: 'x', field: 'c', status: 'published' }]);
  MR.READERS.x = async () => ({ a: 90, b: 80, c: 3 });
  try {
    const ok = await DD.resolveWidgets({ def: { widgets: [{ id: 'tr', type: 'trend', metric: 'a.pct', series: ['b.pct'], window: '3w' }] }, sites: SITES, site: 1, reg: fake, dd: {}, now: NOW });
    assert.equal(ok.tr.mode, 'series'); assert.equal(ok.tr.points.length, 3);
    assert.deepEqual(ok.tr.lines.map((l) => [l.metric, l.points.map((p) => p.value)]), [['a.pct', [90, 90, 90]], ['b.pct', [80, 80, 80]]]);
    const mixed = await DD.resolveWidgets({ def: { widgets: [{ id: 'tr', type: 'trend', metric: 'a.pct', series: ['c.count'], window: '3w' }] }, sites: SITES, site: 1, reg: fake, dd: {}, now: NOW });
    assert.match(mixed.tr.error, /mixes units/);
    const single = await DD.resolveWidgets({ def: { widgets: [{ id: 'tr', type: 'trend', metric: 'a.pct', window: '3w' }] }, sites: SITES, site: 1, reg: fake, dd: {}, now: NOW });
    assert.equal(single.tr.lines, undefined, 'single-series payload unchanged');
  } finally { delete MR.READERS.x; }
});

test('existing seeds stay valid under the new rules', () => {
  const { SEED_DASHBOARDS } = require('../services/dashboardSeeds');
  for (const d of SEED_DASHBOARDS) assert.deepEqual(W.validateDashboard(d).errors, [], d.key);
});
