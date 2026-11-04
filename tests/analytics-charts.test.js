'use strict';
// C-06 — analytics charts: no dual axis (F10), one state vocabulary (F18), accessible charts with
// a data table (F19, analytics part), token palette with status colours only from a status map (F26).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const AL = require('../public/lib/analyticsLogic.js');
const TrendPanel = require('../public/lib/charts.js');
const ChartTheme = require('../public/lib/chartTheme.js');
const { ChartTable } = TrendPanel;
const { bootPage, makeEl, ok, settle, stubFetch, PAGE } = require('./_analytics-page-harness.js');

const SRC = fs.readFileSync(PAGE, 'utf8').replace(/\r\n/g, '\n');
const INLINE = [...SRC.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map(m => m[1]).find(b => b.includes('createLoadCoordinator'));
const CANVAS_IDS = [...SRC.matchAll(/<canvas id="([^"]+)"/g)].map(m => m[1]);
const TREND_IDS = ['chartReqTrend', 'chartSurTrend'];

// ── F18: one state vocabulary ─────────────────────────────────────────────

test('F18 STATES: exactly LOADING VALID ZERO NO_DATA STALE ERROR, each mapped onto kpiRag/dashboard notions', () => {
  assert.deepEqual([...AL.STATES], ['LOADING', 'VALID', 'ZERO', 'NO_DATA', 'STALE', 'ERROR']);
  assert.deepEqual(Object.keys(AL.STATE_MAP).sort(), [...AL.STATES].sort());
  for (const s of AL.STATES) assert.equal(AL.colourAllowed(s), s === 'VALID' || s === 'ZERO', s);
  for (const s of ['LOADING', 'NO_DATA', 'STALE', 'ERROR']) assert.equal(AL.STATE_MAP[s].kpiRag, 'NA', s);
  assert.equal(AL.STATE_MAP.STALE.freshness, 'STALE');
});

test('F18 classifyState: ZERO ≠ NO_DATA, stale and error withhold, loading first', () => {
  assert.equal(AL.classifyState({ value: 0 }), 'ZERO');
  assert.equal(AL.classifyState({ value: null }), 'NO_DATA');
  assert.equal(AL.classifyState({ value: 'abc' }), 'NO_DATA');
  assert.equal(AL.classifyState({ value: NaN }), 'NO_DATA');
  assert.equal(AL.classifyState({ value: 12 }), 'VALID');
  assert.equal(AL.classifyState({ value: 12, stale: true }), 'STALE');
  assert.equal(AL.classifyState({ value: null, stale: true }), 'NO_DATA', 'nothing measured stays NO_DATA');
  assert.equal(AL.classifyState({ value: 12, error: true }), 'ERROR');
  assert.equal(AL.classifyState({ value: 12, loading: true }), 'LOADING');
});

test('F18 classifySeries: no finite point → NO_DATA, all zero → ZERO, stale → STALE', () => {
  assert.equal(AL.classifySeries({ datasets: [] }), 'NO_DATA');
  assert.equal(AL.classifySeries({ datasets: [{ data: [null, undefined, ''] }] }), 'NO_DATA');
  assert.equal(AL.classifySeries({ datasets: [{ data: [0, null, 0] }] }), 'ZERO');
  assert.equal(AL.classifySeries({ datasets: [{ data: [0, 3] }] }), 'VALID');
  assert.equal(AL.classifySeries({ datasets: [{ data: [0, 3] }], stale: true }), 'STALE');
  assert.equal(AL.classifySeries({ datasets: [{ data: [1] }], error: true }), 'ERROR');
});

test('F18 kpiCardState: colour only on VALID/ZERO; null and stale get none; status hues are not accents', () => {
  assert.deepEqual(AL.kpiCardState({ value: 95, green: 90, amber: 75 }), { state: 'VALID', className: 'kpi green' });
  assert.deepEqual(AL.kpiCardState({ value: 0, green: 90, amber: 75 }), { state: 'ZERO', className: 'kpi red' });
  assert.deepEqual(AL.kpiCardState({ value: 95, green: 90, amber: 75, stale: true }), { state: 'STALE', className: 'kpi na' });
  assert.deepEqual(AL.kpiCardState({ value: null, green: 90, amber: 75 }), { state: 'NO_DATA', className: 'kpi na' });
  assert.deepEqual(AL.kpiCardState({ value: 4, accent: 'blue' }), { state: 'VALID', className: 'kpi blue' });
  assert.deepEqual(AL.kpiCardState({ value: 4, accent: 'blue', stale: true }), { state: 'STALE', className: 'kpi na' });
  assert.deepEqual(AL.kpiCardState({ value: 4, accent: 'red' }), { state: 'VALID', className: 'kpi' }, 'a red accent would read as a verdict');
});

test('F18 page: KPI cards start LOADING without colour; a stale section keeps values and withholds colour', async () => {
  const html = [...SRC.matchAll(/<div class="(kpi[^"]*)"( data-state="[A-Z_]+")?><div class="kpi-label">/g)];
  assert.ok(html.length >= 20);
  for (const m of html) { assert.equal(m[1], 'kpi na'); assert.equal(m[2], ' data-state="LOADING"'); }
  const { get, cards } = bootPage(stubFetch([
    ['/api/metrics/requests', () => ok({ stale_warning: true, as_of: '2026-11-01T00:00:00Z', data: { open_count: 0, sla_ok_pct: 97, first_resp_violated_pct: 30, first_resp_violated_count: 3 } })],
    ['/api/metrics/survey', () => ok({ data: { response_rate_pct: 25, avg_score: null } })],
  ]));
  await settle();
  assert.equal(get('kv-req-sla').textContent, '97.0%', 'stale value still shown');
  assert.equal(cards.get('kv-req-sla').className, 'kpi na');
  assert.equal(cards.get('kv-req-sla').attrs['data-state'], 'STALE');
  assert.ok(!/class="(bad|good|warn)"/.test(get('ks-req-frsla').innerHTML), 'stale sub-line uncoloured');
  assert.equal(cards.get('kv-sur-rate').className, 'kpi green');
  assert.equal(cards.get('kv-sur-rate').attrs['data-state'], 'VALID');
  assert.equal(cards.get('kv-sur-avg').attrs['data-state'], 'NO_DATA');
  assert.equal(cards.get('kv-sur-avg').className, 'kpi na');
});

test('F18 page: an API error puts KPI and chart cards in ERROR and removes the data tables', async () => {
  let fail = false;
  const { ctx, cards, chartCards, get } = bootPage(stubFetch([
    ['/api/metrics/requests', () => (fail ? { ok: false, status: 503, json: async () => ({}) }
      : ok({ data: { open_count: 4, by_site: [{ site: 'Ity', count: 4 }] } }))],
  ]));
  await settle();
  assert.ok(chartCards.get('chartReqSite').body.children.some(c => c.id === 'chartReqSite-table'));
  fail = true; ctx.loadAll(); await settle();
  assert.equal(cards.get('kv-req-open').attrs['data-state'], 'ERROR');
  assert.equal(chartCards.get('chartReqSite').card.attrs['data-state'], 'ERROR');
  assert.ok(!chartCards.get('chartReqSite').body.children.some(c => c.id === 'chartReqSite-table'), 'stale table removed');
  assert.match(get('chartReqSite').attrs['aria-label'], /unavailable/);
});

// ── F10: no dual axis ────────────────────────────────────────────────────

test('F10 source: no secondary y-axis anywhere in the analytics script; both trends are TrendPanels', () => {
  assert.ok(!/yAxisID|position:\s*'right'\s*,\s*min|\by2\b/.test(INLINE), 'no yAxisID / right axis');
  for (const id of TREND_IDS) assert.match(SRC, new RegExp(`<div class="trend-wrap" id="${id}"></div>`));
  assert.match(INLINE, /trendPanel\('chartReqTrend'/);
  assert.match(INLINE, /trendPanel\('chartSurTrend'/);
  assert.match(SRC, /src="lib\/chartTheme\.js" defer><\/script>\n<script src="lib\/charts\.js" defer><\/script>/);
});

test('F10 page: each trend renders two stacked panels with one y-axis each; data unchanged, nulls kept as gaps', async () => {
  const { charts } = bootPage(stubFetch([
    ['/api/metrics/requests', () => ok({ data: { monthly_trend: [
      { month: '2026-09', total_count: 10, closed_count: 8, sla_ok_pct: 90 },
      { month: '2026-10', total_count: 12, closed_count: 11, sla_ok_pct: null }] } })],
    ['/api/metrics/survey', () => ok({ data: { monthly_trend: [
      { month: '2026-09', avg_score: 81, sent_count: 10, responded_count: 3 },
      { month: '2026-10', avg_score: null, sent_count: 0, responded_count: 0 }] } })],
  ]));
  await settle();
  const trend = charts.filter(c => /^edv-trend-panel__/.test(c.ctx.parentNode && c.ctx.parentNode.className || ''));
  assert.equal(trend.length, 4, 'two panels per trend');
  for (const c of trend) {
    assert.deepEqual(Object.keys(c.config.options.scales).sort(), ['x', 'y']);
    assert.ok(c.config.data.datasets.every(d => !d.yAxisID));
  }
  const all = trend.flatMap(c => c.config.data.datasets);
  assert.deepEqual(all.find(d => d.label === 'Total').data, [10, 12]);
  assert.deepEqual(all.find(d => d.label === 'SLA OK %').data, [90, null]);
  assert.deepEqual(all.find(d => d.label === 'Avg Score').data, [81, null]);
  assert.deepEqual(all.find(d => d.label === 'Response Rate %').data, [30, null]);
  assert.ok(all.filter(d => d.type === 'line').every(d => d.spanGaps === false));
  for (const c of trend) {
    assert.equal(c.ctx.attrs.role, 'img');
    assert.match(c.ctx.attrs['aria-label'], /highest/);
  }
});

// ── F26: token palette ───────────────────────────────────────────────────

test('F26 source: no PALETTE/MULTI, no hex literal in the analytics script', () => {
  assert.ok(!/\bPALETTE\b|\bMULTI\b/.test(INLINE));
  assert.ok(!/#[0-9A-Fa-f]{3,8}\b/.test(INLINE), 'hex literal in the analytics script');
});

test('F26 statusPalette/seriesColours: status from RAG tokens only, categorical from series tokens only', () => {
  const th = ChartTheme.read(() => '');
  const sp = AL.statusPalette(th);
  assert.deepEqual(sp, { green: th.rag.green, amber: th.rag.amber, red: th.rag.red, slate: th.rag.na });
  const stale = AL.statusPalette(th, true);
  assert.ok(Object.values(stale).every(c => c === th.rag.na), 'stale → no status colour');
  const cats = AL.seriesColours(8, th, ChartTheme.alpha);
  assert.deepEqual(cats.slice(0, 6), th.series);
  assert.equal(cats[6], ChartTheme.alpha(th.series[0], 0.55));
  const rag = new Set(Object.values(th.rag));
  assert.ok(th.series.every(c => !rag.has(c)), 'a series colour is never a status colour');
  assert.deepEqual(AL.statusPalette(null), { green: undefined, amber: undefined, red: undefined, slate: undefined });
});

test('F26 page: categorical charts use series tokens, status charts use the status map, stale greys status', async () => {
  const th = ChartTheme.read(() => '');
  const { charts } = bootPage(stubFetch([
    ['/api/metrics/change', () => ok({ stale_warning: true, data: { by_type: [{ change_type: 'Standard', count: 2 }, { change_type: 'Normal', count: 1 }],
      by_risk: [{ risk: 'High', count: 1 }] } })],
    ['/api/metrics/survey', () => ok({ data: { satisfied_count: 3, neutral_count: 1, dissatisfied_count: 1 } })],
  ]));
  await settle();
  const byId = id => charts.find(c => c.ctx.id === id);
  assert.deepEqual([...byId('chartChgType').config.data.datasets[0].backgroundColor], th.series.slice(0, 2));
  assert.equal(byId('chartChgRisk').config.data.datasets[0].backgroundColor[0], ChartTheme.alpha(th.rag.na, 0.8), 'stale: High not red');
  assert.deepEqual([...byId('chartSurDist').config.data.datasets[0].backgroundColor], [th.rag.green, th.rag.amber, th.rag.red]);
});

// ── F19: role="img", summary, data table ──────────────────────────────────

test('F19 ChartTable.rows/summary/html: labels × datasets with units, null → —, values escaped', () => {
  const spec = { title: 'Volume <b>', labels: ['Ity', '<x>'], datasets: [{ label: 'Tickets', data: [5, null], unit: 'tickets' }, { label: 'SLA', data: [90.25, 80], unit: '%' }] };
  const t = ChartTable.rows(spec);
  assert.deepEqual(t.head, ['Label', 'Tickets (tickets)', 'SLA (%)']);
  assert.deepEqual(t.rows, [['Ity', '5', '90.3'], ['<x>', '—', '80']]);
  const s = ChartTable.summary(spec);
  assert.match(s, /^Volume <b> — 2 rows\. Tickets: highest Ity \(5 tickets\), 1 not measured; SLA: highest Ity \(90\.3%\), lowest <x> \(80%\)\.$/);
  const h = ChartTable.html(spec);
  assert.ok(h.startsWith('<summary>Data table</summary>'));
  assert.ok(h.includes('&lt;x&gt;') && h.includes('Volume &lt;b&gt;') && !h.includes('<x>'));
  assert.equal((h.match(/<tr>/g) || []).length, 3, 'header + 2 rows');
  assert.match(ChartTable.summary({ title: 'T', labels: ['a'], datasets: [{ data: [null] }] }), /no data for this period/);
  assert.match(ChartTable.html({ title: 'T', labels: [], datasets: [], state: 'NO_DATA' }), /No data for this period/);
  assert.match(ChartTable.summary({ title: 'T', labels: ['a'], datasets: [{ data: [1] }], state: 'STALE' }), /^Source not current\./);
  assert.match(ChartTable.summary({ title: 'T', state: 'ERROR' }), /unavailable/);
});

test('F19 ChartTable.attach/detach: role=img + aria-label on the canvas, one <details> after its wrap, replaced not duplicated', () => {
  const made = [];
  const doc = { createElement: t => { const e = makeEl('', t.toUpperCase()); made.push(e); return e; },
    getElementById: id => made.find(e => e.id === id && e.parentNode) || null };
  const body = makeEl('body'); const wrap = makeEl('wrap'); const cv = makeEl('cv1', 'CANVAS');
  body.appendChild(wrap); wrap.appendChild(cv); cv.closest = s => (s === '.chart-wrap' ? wrap : null);
  const spec = { title: 'T', labels: ['a', 'b'], datasets: [{ label: 'N', data: [1, 2] }] };
  ChartTable.attach(cv, spec, doc);
  ChartTable.attach(cv, spec, doc);
  assert.equal(cv.attrs.role, 'img');
  assert.match(cv.attrs['aria-label'], /^T — 2 rows/);
  assert.equal(cv.attrs['aria-describedby'], 'cv1-table');
  const tables = body.children.filter(c => c.id === 'cv1-table');
  assert.equal(tables.length, 1);
  assert.equal(tables[0].tagName, 'DETAILS');
  assert.equal(body.children.indexOf(tables[0]), body.children.indexOf(wrap) + 1);
  ChartTable.detach(cv, doc);
  assert.ok(!body.children.some(c => c.id === 'cv1-table'));
  assert.equal(cv.attrs['aria-describedby'], undefined);
  assert.equal(ChartTable.attach(null, spec, doc), null);
});

test('F19 page: every analytics canvas gets role="img", a summary aria-label and a data table with one row per label', async () => {
  assert.equal(CANVAS_IDS.length, 9, 'nine canvases + two trend panels');
  const { get, chartCards, created } = bootPage(stubFetch([
    ['/api/metrics/requests', () => ok({ data: { by_site: [{ site: 'Ity', count: 4 }, { site: 'Mana', count: 2 }], by_category: [{ category: 'Email', count: 3 }],
      monthly_trend: [{ month: '2026-10', total_count: 3, closed_count: 1, sla_ok_pct: 50 }] } })],
    ['/api/metrics/change', () => ok({ data: { by_status: [{ status: 'Closed', count: 1 }], by_risk: [{ risk: 'Low', count: 1 }],
      by_type: [{ change_type: 'Standard', count: 1 }], by_site: [{ site_id: 'HGO', count: 1 }] } })],
    ['/api/metrics/cab', () => ok({ data: { by_status: [{ approval_status: 'Approved', count: 1 }], by_stage: [{ approval_stage: 'S1', count: 1 }] } })],
    ['/api/metrics/survey', () => ok({ data: { satisfied_count: 1, neutral_count: 0, dissatisfied_count: 0,
      monthly_trend: [{ month: '2026-10', avg_score: 80, sent_count: 2, responded_count: 1 }] } })],
  ]));
  await settle();
  for (const id of CANVAS_IDS) {
    const cv = get(id);
    assert.equal(cv.attrs.role, 'img', id);
    assert.ok(cv.attrs['aria-label'] && cv.attrs['aria-label'].length > 10, id);
    const det = chartCards.get(id).body.children.find(c => c.id === id + '-table');
    assert.ok(det, id + ': data table');
    const rows = (det.innerHTML.match(/<tbody>([\s\S]*)<\/tbody>/) || [, ''])[1].match(/<tr>/g) || [];
    assert.ok(rows.length >= 1, id + ': rows');
  }
  const site = chartCards.get('chartReqSite').body.children.find(c => c.id === 'chartReqSite-table');
  assert.equal((site.innerHTML.match(/<tbody>([\s\S]*)<\/tbody>/)[1].match(/<tr>/g) || []).length, 2, 'one row per site');
  for (const id of TREND_IDS) {
    const det = chartCards.get(id).body.children.find(c => c.id === id + '-table');
    assert.ok(det, id + ': trend data table');
    assert.match(det.innerHTML, /\((tickets|points)\)/);
    assert.match(det.innerHTML, /\(%\)/);
  }
  assert.ok(created.length > 0);
});

test('F19 page: an empty series is NO_DATA — no chart drawn, the card says so instead of empty axes', async () => {
  const { charts, chartCards } = bootPage(stubFetch([['/api/metrics/requests', () => ok({ data: { by_site: [] } })]]));
  await settle();
  assert.ok(!charts.some(c => c.ctx.id === 'chartReqSite' && !c.destroyed));
  assert.equal(chartCards.get('chartReqSite').card.attrs['data-state'], 'NO_DATA');
  const det = chartCards.get('chartReqSite').body.children.find(c => c.id === 'chartReqSite-table');
  assert.match(det.innerHTML, /No data for this period/);
});
