'use strict';
// E-V06 — dashboard widget parity (audit V-06 residual; C-16 covers Report Studio + the Group IT deck).
// ONE fictitious fixture dashboard (kpi + ragGrid + trend), resolved once through services/dashboardData, must
// show the same figures, the same period label and the same population on every surface:
//   viewer render (public/lib/dashboardRender) · ChartTable rows (public/lib/chartTheme, as the viewer's chart
//   builds its spec) · report-pack CSV + XLSX rows (services/reportPack via services/reportAnalysis).
// Failure = a diff report (figure · surface · expected · got), like tests/report-figures-parity.test.js.
// FIXTURE — fictitious sites and figures, labelled; no production data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/lib/dashboardRender');
const { ChartTable } = require('../public/lib/chartTheme');
const MR = require('../services/metricRegistry');
const { resolveWidgets } = require('../services/dashboardData');
const { analyse } = require('../services/reportAnalysis');
const pack = require('../services/reportPack');

const SITES = [{ id: 1, name: 'Fixture North' }, { id: 2, name: 'Fixture South' }, { id: 3, name: 'Fixture Unmeasured' }];
// FIXTURE figures: resolution SLA % by site and month. Site 3 is never measured (null, not 0); North misses April.
const FIG = { 1: { '2026-01': 91, '2026-02': 88, '2026-03': 90, '2026-04': null, '2026-05': 84, '2026-06': 87 }, 2: { '2026-06': 72 }, 3: {} };
const deps = { rdb: { getCalendarMonthlyHelpdesk: async (site, y, m) => {
  const v = (FIG[site] || {})[`${y}-${String(m).padStart(2, '0')}`];
  return { inbound: v == null ? 0 : 100, closed: v == null ? 0 : 90, close_pct: v == null ? null : 90, sla_res_pct: v == null ? null : v, sla_reply_pct: null };
} } };
const DEF = { key: 'fixture-parity', title: 'FIXTURE — parity', audience: 'site', grid: { columns: 12 }, widgets: [
  { id: 'k', type: 'kpi', metric: 'helpdesk.resolution_sla_pct', title: 'Resolution SLA', layout: { x: 0, y: 0, w: 3, h: 2 } },
  { id: 'g', type: 'ragGrid', metric: 'helpdesk.resolution_sla_pct', title: 'SLA by site', layout: { x: 3, y: 0, w: 6, h: 3 } },
  { id: 't', type: 'trend', metric: 'helpdesk.resolution_sla_pct', title: 'SLA trend', window: '6m', layout: { x: 0, y: 3, w: 12, h: 4 } },
] };
const NOW = new Date('2026-07-15T08:00:00Z');

function csvRows(text) {
  return text.replace(/^﻿/, '').trim().split('\r\n').map((l) => l.split(','));
}

test('E-V06: viewer = ChartTable = report-pack CSV/XLSX for the same fixture selection', async () => {
  const W = await resolveWidgets({ def: DEF, sites: SITES, site: 1, window: '2026-06', reg: MR.createRegistry(), dd: deps, rdb: null, now: NOW });
  const run = { status: 'draft', window_label: '2026-06', figures: analyse({ widgets: W, def: DEF, audience: 'site', lang: 'en', registry: MR.createRegistry() }).figures };
  const csv = csvRows(pack.renderCsv(run));
  const xlsx = pack.figureRows(run);
  const diffs = [];
  const check = (figure, surface, expected, got) => { if (String(expected) !== String(got)) diffs.push({ figure, surface, expected, got }); };
  const has = (figure, surface, html, needle) => { if (!html.includes(needle)) diffs.push({ figure, surface, expected: needle, got: '(absent)' }); };
  const num = (v) => (v == null || v === '' ? '' : String(Number(v)));

  // ── kpi ──
  const k = W.k;
  assert.equal(k.mode, 'single');
  assert.equal(k.value, 87, 'fixture sanity');
  has('k value', 'viewer', R.formatValue(k.value, k.unit), '87 %');
  const kCsv = csv.find((r) => r[0] === 'single');
  check('k value', 'csv', num(k.value), num(kCsv[4]));
  check('k period', 'csv', k.window.label, kCsv[7]);
  const kX = xlsx.find((r) => r.kind === 'single');
  check('k value', 'xlsx', num(k.value), num(kX.value));
  check('k period', 'xlsx', k.window.label, kX.label);

  // ── ragGrid ── same population (every site in scope, the unmeasured one included) and same values
  const g = W.g; const gHtml = R.ragGridHtml(g);
  const gCsv = csv.filter((r) => r[0] === 'per-site'); const gX = xlsx.filter((r) => r.kind === 'per-site');
  check('g population', 'viewer', g.rows.length, (gHtml.match(/role="listitem"/g) || []).length);
  check('g population', 'csv', g.rows.map((r) => r.site).sort().join('|'), gCsv.map((r) => r[3]).sort().join('|'));
  check('g population', 'xlsx', g.rows.map((r) => r.site).sort().join('|'), gX.map((r) => r.label).sort().join('|'));
  for (const r of g.rows) {
    has('g ' + r.site, 'viewer', gHtml, R.escapeHtml(r.site) + '</span><span class="edv-ragcell-val">' + R.formatValue(r.value, g.unit) + '</span>');
    check('g ' + r.site, 'csv', num(r.value), num((gCsv.find((c) => c[3] === r.site) || [])[4]));
    check('g ' + r.site, 'xlsx', num(r.value), num((gX.find((c) => c.label === r.site) || {}).value));
  }
  assert.ok(g.rows.some((r) => r.value == null), 'the unmeasured site stays in the population as null');

  // ── trend ── same labels (period), same values, null = gap '—' everywhere
  const t = W.t; const tHtml = R.seriesTableHtml(t);
  const spec = { labels: t.points.map((p) => R.shortLabel(p.label) + (p.partial ? '*' : '')), datasets: [{ label: t.title, unit: t.unit, data: t.points.map((p) => p.value) }] };
  const ct = ChartTable.rows(spec);
  const tCsv = csv.filter((r) => r[0] === 'series'); const tX = xlsx.filter((r) => r.kind === 'series');
  check('t population', 'chart-table', t.points.length, ct.rows.length);
  check('t population', 'csv', t.points.length, tCsv.length);
  check('t population', 'xlsx', t.points.length, tX.length);
  t.points.forEach((p, i) => {
    has('t ' + p.label, 'viewer', tHtml, '<th scope="row">' + R.escapeHtml(p.label));
    has('t ' + p.label, 'viewer', tHtml, '<td class="num">' + R.formatValue(p.value, t.unit) + '</td>');
    check('t ' + p.label, 'chart-table', R.shortLabel(p.label), String(ct.rows[i][0]).replace(/\*$/, ''));
    check('t ' + p.label, 'chart-table', p.value == null ? '—' : String(p.value), ct.rows[i][1]);
    check('t ' + p.label, 'csv', p.label + '=' + num(p.value), tCsv[i][3] + '=' + num(tCsv[i][4]));
    check('t ' + p.label, 'xlsx', p.label + '=' + num(p.value), tX[i].label + '=' + num(tX[i].value));
  });
  assert.equal(t.points[t.points.length - 1].label, '2026-06', 'the series ends on the selected window');
  assert.ok(t.points.some((p) => p.value == null), 'the fixture carries a gap');

  assert.deepEqual(diffs, [], 'parity diff (figure · surface · expected · got):\n' + diffs.map((d) => `${d.figure} · ${d.surface} · ${d.expected} · ${d.got}`).join('\n'));
});

// F-DATA-02 — a WAN trend is one snapshot per week (was: the latest week repeated on every point), and the kpi of a
// selected past week is THAT week's figure. FIXTURE — fictitious site and figures.
test('F-DATA-02: a WAN weekly trend through resolveWidgets is not flat and ignores sub-site rows', async () => {
  // Zoho-week snapshots (Sunday-anchored) for 4 consecutive weeks; the ISO Monday of each is start + 1 day
  const weeks = [['2026-06-14', 99.9], ['2026-06-21', 96.4], ['2026-06-28', null], ['2026-07-05', 91.2]];
  const snaps = weeks.map(([ps, v]) => ({ site_id: 1, sub_site: '', uplink: 'wan1', period_type: 'week', period_start: ps, availability_pct: v, loss_pct: 1, latency_ms: 40 }));
  snaps.push({ site_id: 1, sub_site: 'FIXTURE-SUB', uplink: 'wan1', period_type: 'week', period_start: '2026-07-05', availability_pct: 3.3, loss_pct: 90, latency_ms: 999 });
  const dd = { rdb: { getWanSnapshots: async (f) => snaps.filter((r) => r.site_id === f.site_id) } };
  const def = { key: 'fixture-wan', title: 'FIXTURE — WAN', audience: 'site', grid: { columns: 12 }, widgets: [
    { id: 'k', type: 'kpi', metric: 'wan.wan1_availability_pct', title: 'WAN1', layout: { x: 0, y: 0, w: 3, h: 2 } },
    { id: 't', type: 'trend', metric: 'wan.wan1_availability_pct', title: 'WAN1 trend', window: '4w', layout: { x: 0, y: 2, w: 12, h: 4 } },
  ] };
  const W = await resolveWidgets({ def, sites: SITES, site: 1, window: '2026-W28', reg: MR.createRegistry(), dd, rdb: null, now: NOW });
  const pts = W.t.points;
  assert.deepEqual(pts.map((p) => p.label), ['2026-W25', '2026-W26', '2026-W27', '2026-W28']);
  assert.deepEqual(pts.map((p) => p.value), [99.9, 96.4, null, 91.2], 'one snapshot per week; a week not measured is a gap');
  assert.ok(new Set(pts.map((p) => p.value)).size > 1, 'the trend is not the latest value repeated');
  assert.equal(W.k.value, 91.2, 'kpi = the selected week, site-level link (not the sub-site 3.3)');
  const past = await resolveWidgets({ def, sites: SITES, site: 1, window: '2026-W26', reg: MR.createRegistry(), dd, rdb: null, now: NOW });
  assert.equal(past.k.value, 96.4, 'a past week shows its own WAN figure, not this week\'s');
});
