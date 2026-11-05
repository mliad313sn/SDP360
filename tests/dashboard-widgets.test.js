'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const D = require('../services/dashboardWidgets');

function doc() {
  return {
    key: 'sgo-weekly', title: 'Sabodala weekly', audience: 'site', grid: { columns: 12 },
    filters: [{ key: 'site', type: 'site', default: 'SGO' }, { key: 'window', type: 'window', default: '13w' }],
    widgets: [
      { id: 'kpi-res', type: 'kpi', metric: 'helpdesk.resolution_sla_pct', title: 'Resolution SLA', rag: 'sla-percent', layout: { x: 0, y: 0, w: 3, h: 2 } },
      { id: 'kpi-frt', type: 'kpi', metric: 'helpdesk.first_reply_sla_pct', layout: { x: 3, y: 0, w: 3, h: 2 } },
      { id: 'trend',   type: 'trend', metric: 'helpdesk.inbound', layout: { x: 0, y: 3, w: 12, h: 4 } },
      { id: 'actions', type: 'actions', sources: ['meetings', 'inspection'], layout: { x: 6, y: 0, w: 6, h: 3 } },
    ],
  };
}
const METRICS = ['helpdesk.resolution_sla_pct', 'helpdesk.first_reply_sla_pct', 'helpdesk.inbound'];

test('a well-formed dashboard validates, with and without a metric registry', () => {
  assert.deepEqual(D.validateDashboard(doc()), { ok: true, errors: [] });
  assert.deepEqual(D.validateDashboard(doc(), { metrics: METRICS }), { ok: true, errors: [] });
});

test('unknown metric, raw sql, overlap, overflow, minimum size and duplicate id are rejected', () => {
  const d = doc();
  d.widgets[1].metric = 'helpdesk.nope';
  d.widgets[2].sql = 'SELECT 1';
  d.widgets.push({ id: 'kpi-res', type: 'kpi', metric: 'helpdesk.inbound', layout: { x: 10, y: 0, w: 3, h: 2 } });   // dup id + overflow + overlap
  d.widgets.push({ id: 'tiny', type: 'trend', metric: 'helpdesk.inbound', layout: { x: 0, y: 7, w: 2, h: 1 } });
  const r = D.validateDashboard(d, { metrics: METRICS });
  assert.equal(r.ok, false);
  const msgs = r.errors.map((e) => e.msg).join('\n');
  assert.match(msgs, /unknown metric helpdesk.nope/);
  assert.match(msgs, /raw sql/);
  assert.match(msgs, /duplicate widget id kpi-res/);
  assert.match(msgs, /overflows the 12-column grid/);
  assert.match(msgs, /overlaps widget/);
  assert.match(msgs, /trend needs at least 4×3/);
});

test('structural errors: no widgets, bad audience, bad filter, unknown widget type, trackerRag needs a tracker', () => {
  assert.equal(D.validateDashboard({ key: 'x', title: 'x', widgets: [] }).ok, false);
  const d = doc();
  d.audience = 'everyone';
  d.filters[0].type = 'colour';
  d.widgets[0].type = 'pie';
  d.widgets[1] = { id: 'tr', type: 'trackerRag', tracker: 'nope', layout: { x: 3, y: 0, w: 4, h: 3 } };
  d.widgets.splice(3, 1);
  const r = D.validateDashboard(d, { trackers: ['it-activity-2026'] });
  const paths = r.errors.map((e) => e.path);
  assert.ok(paths.includes('audience'));
  assert.ok(paths.includes('filters[0].type'));
  assert.ok(paths.includes('widgets[0].type'));
  assert.ok(paths.includes('widgets[1].tracker'));
});

test('fieldReadiness enforces the phone profile', () => {
  const d = doc();
  d.audience = 'field';
  assert.equal(D.fieldReadiness(d).ok, true);
  d.widgets.push({ id: 'tbl', type: 'table', metric: 'helpdesk.inbound', layout: { x: 0, y: 7, w: 12, h: 4 } });
  d.widgets.push({ id: 'hm', type: 'heatmap', metric: 'helpdesk.inbound', layout: { x: 0, y: 11, w: 12, h: 4 } });
  d.widgets.push({ id: 'bar', type: 'bar', metric: 'helpdesk.inbound', layout: { x: 0, y: 15, w: 4, h: 3 } });
  const r = D.fieldReadiness(d);
  assert.equal(r.ok, false);
  assert.equal(r.issues.length, 3);
  assert.match(r.issues.join('\n'), /pageSize ≤ 10/);
  assert.match(r.issues.join('\n'), /use ragGrid/);
  assert.match(r.issues.join('\n'), /≥ 6 columns/);
});

// C-08 (G17) — the server stays the authority: a trend on a snapshot metric is refused when kinds are known
test('a trend whose metric or series is a current snapshot is rejected when metricKinds is given', () => {
  const kinds = { 'helpdesk.inbound': 'month', 'helpdesk.closed': 'month', 'assets.total': 'current', 'assets.ghost': 'current' };
  const d = doc();
  assert.deepEqual(D.validateDashboard(d, { metricKinds: kinds }), { ok: true, errors: [] });
  d.widgets[2].metric = 'assets.total';
  const r = D.validateDashboard(d, { metricKinds: kinds });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'widgets[2].metric' && /time series/.test(e.msg)), JSON.stringify(r.errors));
  d.widgets[2].metric = 'helpdesk.inbound'; d.widgets[2].series = ['assets.ghost'];
  assert.ok(D.validateDashboard(d, { metricKinds: kinds }).errors.some((e) => e.path === 'widgets[2].series'));
  assert.equal(D.validateDashboard(d).errors.filter((e) => /time series/.test(e.msg)).length, 0, 'without kinds: unchanged behaviour');
});

// ---- E-V02 — server-side measure → chart contract (shared rule table public/lib/chartContract.js) ----
const INFO = {
  'helpdesk.resolution_sla_pct': { name: 'Resolution SLA', unit: '%', window_kind: 'month', rag_policy: 'sla-percent' },
  'helpdesk.inbound': { name: 'Inbound', unit: 'count', window_kind: 'week', rag_policy: null },
  'assets.effort_rank': { name: 'Effort rank', unit: 'rank', window_kind: 'current', rag_policy: null },
};
const one = (w) => ({ key: 'ev02', title: 'E-V02', audience: 'site', grid: { columns: 12 }, widgets: [Object.assign({ id: 'w1', layout: { x: 0, y: 0, w: 6, h: 3 } }, w)] });

test('E-V02: stacked bars are refused on a NEW widget (not rendered) and on a rate (ratios are not added)', () => {
  const a = D.validateDashboard(one({ type: 'bar', metric: 'helpdesk.inbound', stacked: true }), { metricInfo: INFO });
  assert.equal(a.ok, false); assert.match(a.errors[0].msg, /Stacked bars are not drawn/); assert.equal(a.errors[0].path, 'widgets[0].stacked');
  const b = D.validateDashboard(one({ type: 'bar', metric: 'helpdesk.resolution_sla_pct', stacked: true }), { metricInfo: INFO });
  assert.match(b.errors[0].msg, /Ratios cannot be stacked/);
  // even without registry info, a stacked bar is refused (the defect does not depend on the metric)
  assert.equal(D.validateDashboard(one({ type: 'bar', metric: 'helpdesk.inbound', stacked: true })).ok, false);
  assert.ok(!D.WIDGET_TYPES.bar.props.includes('stacked'), 'the composer no longer offers stacked');
});

test('E-V02: a stored stacked widget keeps saving and still passes submit/publish (allowRetired)', () => {
  const d = one({ type: 'bar', metric: 'helpdesk.inbound', stacked: true });
  assert.equal(D.validateDashboard(d, { metricInfo: INFO, storedWidgets: d.widgets.map((w) => Object.assign({}, w)) }).ok, true);
  assert.equal(D.validateDashboard(d, { allowRetired: true }).ok, true);
  // changing the metric of the stored widget makes it a new widget again
  const changed = one({ type: 'bar', metric: 'helpdesk.resolution_sla_pct', stacked: true });
  assert.equal(D.validateDashboard(changed, { metricInfo: INFO, storedWidgets: d.widgets }).ok, false);
});

test('E-V02: ragGrid without a RAG policy and bar on a rank are refused, with what to use instead', () => {
  const g = D.validateDashboard(one({ type: 'ragGrid', metric: 'helpdesk.inbound' }), { metricInfo: INFO });
  assert.equal(g.ok, false); assert.match(g.errors[0].msg, /no RAG policy.*Pick a RAG policy or use a table/);
  assert.equal(D.validateDashboard(one({ type: 'ragGrid', metric: 'helpdesk.inbound', rag: 'sla-percent' }), { metricInfo: INFO }).ok, true);
  assert.equal(D.validateDashboard(one({ type: 'ragGrid', metric: 'helpdesk.resolution_sla_pct' }), { metricInfo: INFO }).ok, true);
  const r = D.validateDashboard(one({ type: 'bar', metric: 'assets.effort_rank' }), { metricInfo: INFO });
  assert.equal(r.ok, false); assert.match(r.errors[0].msg, /rank is not a magnitude.*Use a table/);
  assert.equal(D.validateDashboard(one({ type: 'table', metric: 'assets.effort_rank' }), { metricInfo: INFO }).ok, true);
});

test('E-V02: server verdict = composer verdict on the same input', () => {
  const CG = require('../public/lib/composerGuide');
  const cases = [
    { type: 'bar', metric: 'helpdesk.inbound', stacked: true },
    { type: 'bar', metric: 'helpdesk.resolution_sla_pct', stacked: true },
    { type: 'ragGrid', metric: 'helpdesk.inbound' },
    { type: 'bar', metric: 'assets.effort_rank' },
    { type: 'bar', metric: 'helpdesk.inbound' },
    { type: 'kpi', metric: 'helpdesk.resolution_sla_pct' },
  ];
  for (const w of cases) {
    const m = Object.assign({ key: w.metric }, INFO[w.metric]);
    const composer = CG.fitError(w.type, m, null, D.WIDGET_TYPES, w);
    const v = D.validateDashboard(one(w), { metricInfo: INFO });
    assert.equal(!composer, v.ok, JSON.stringify(w));
    if (composer) assert.equal(v.errors[0].msg, composer, JSON.stringify(w));
  }
});

test('E-V02: no shipped seed dashboard is flagged by the new rules', () => {
  const { SEED } = require('../services/metricRegistry');
  const { SEED_DASHBOARDS } = require('../services/dashboardSeeds');
  const info = Object.fromEntries(SEED.map((m) => [m.key, { name: m.name, unit: m.unit, window_kind: m.window_kind, rag_policy: m.rag_policy }]));
  for (const d of SEED_DASHBOARDS) assert.deepEqual(D.validateDashboard(d, { metrics: SEED.map((m) => m.key), metricInfo: info }).errors, [], d.key);
});
