'use strict';
// C-08 (F17/G17) — guided composer helpers: question → metric → intent → type → fields → placement.
const { test } = require('node:test');
const assert = require('node:assert');
const CG = require('../public/lib/composerGuide');
const W = require('../services/dashboardWidgets');
const REG = require('../services/metricRegistry').current();

const METRICS = REG.list({ status: 'published' });
const byKey = (k) => METRICS.find((m) => m.key === k) || null;
const TYPES = W.WIDGET_TYPES;

test('intent → type suggestion: suggested types first, unfit types carry a reason', () => {
  const sla = byKey('helpdesk.resolution_sla_pct');
  const s = CG.suggestTypes('trend', sla, TYPES);
  assert.equal(s[0].type, 'trend'); assert.ok(s[0].suggested);
  assert.deepEqual(s.map((x) => x.type).sort(), W.creatableTypes().sort(), 'every creatable type, nothing retired');
  assert.ok(!s.some((x) => x.type === 'heatmap'));
  for (const x of s.filter((y) => !y.ok)) assert.ok(x.reason && x.reason.length > 10, x.type);
  const cmp = CG.suggestTypes('compare', sla, TYPES).filter((x) => x.suggested).map((x) => x.type);
  assert.deepEqual(cmp, ['ragGrid', 'bar', 'table']);
  const noMetric = CG.suggestTypes('detail', null, TYPES).filter((x) => x.suggested).map((x) => x.type);
  assert.deepEqual(noMetric, ['actions', 'text']);
});

test('fitError refuses a type whose contract does not fit the metric or the question', () => {
  const snap = byKey('assets.total');
  assert.equal(snap.window_kind, 'current');
  assert.match(CG.fitError('trend', snap, 'trend', TYPES), /time series/);
  assert.equal(CG.fitError('trend', byKey('helpdesk.inbound'), 'trend', TYPES), null);
  assert.match(CG.fitError('kpi', null, 'status', TYPES), /charts a metric/);
  assert.match(CG.fitError('actions', snap, 'detail', TYPES), /does not chart a metric/);
  assert.match(CG.fitError('heatmap', snap, 'compare', TYPES), /no longer offered/);
  assert.match(CG.fitError('kpi', snap, 'trend', TYPES), /does not answer/);
});

test('props → fields: every prop of every creatable type gets a typed field (no raw JSON needed)', () => {
  const ctx = { metric: byKey('helpdesk.inbound'), metrics: METRICS, policies: REG.policies() };
  for (const t of W.creatableTypes()) {
    const f = CG.fieldsFor(t, TYPES, ctx);
    assert.deepEqual(f.map((x) => x.name), TYPES[t].props, t);
    for (const x of f) assert.ok(x.label && x.label !== x.name, `${t}.${x.name} has a plain label`);
  }
  const series = CG.fieldsFor('trend', TYPES, ctx).find((x) => x.name === 'series');
  assert.ok(series.options.length > 0);
  for (const [k] of series.options) assert.equal(byKey(k).unit, 'count', 'same unit only: ' + k);
  assert.ok(!series.options.some(([k]) => k === 'helpdesk.inbound'), 'not the main metric');
  assert.ok(!series.options.some(([k]) => byKey(k).window_kind === 'current'), 'time series only');
  const win = CG.fieldsFor('trend', TYPES, ctx).find((x) => x.name === 'window');
  assert.ok(win.options.some(([v]) => v === '6m'), 'monthly metric → month windows');
  const page = CG.fieldsFor('table', TYPES, ctx).find((x) => x.name === 'pageSize');
  assert.equal(page.kind, 'number');
});

test('fields render as labelled controls and read back as props (blank = absent)', () => {
  const fields = CG.fieldsFor('actions', TYPES, {});
  const html = CG.renderFieldsHtml(fields, { onlyOverdue: true, sources: ['meetings'] });
  assert.match(html, /<label class="check" for="wf-onlyOverdue"><input type="checkbox" id="wf-onlyOverdue" checked>/);
  assert.match(html, /id="ferr-sources"/);
  const els = { 'wf-sources': { selectedOptions: [{ value: 'meetings' }, { value: 'report' }] }, 'wf-onlyOverdue': { checked: false } };
  assert.deepEqual(CG.readFieldValues(fields, (id) => els[id]), { sources: ['meetings', 'report'] });
  const tf = CG.fieldsFor('table', TYPES, {});
  assert.deepEqual(CG.readFieldValues(tf, (id) => ({ 'wf-columns': { value: ' a, b ,' }, 'wf-pageSize': { value: '8' } })[id]), { columns: ['a', 'b'], pageSize: 8 });
  assert.deepEqual(CG.readFieldValues(tf, () => ({ value: '' })), {});
});

test('every preset builds a widget that validateDashboard accepts (flow layout, registered metrics, units)', () => {
  const widgets = CG.PRESETS.map((p, i) => Object.assign({ id: 'w' + (i + 1), type: p.type, title: p.title }, p.metric ? { metric: p.metric } : {}, p.props));
  const L = CG.flowLayout(CG.PRESETS.map((p) => ({ type: p.type, size: p.size })), 12, TYPES);
  widgets.forEach((w, i) => { w.layout = L[i]; });
  for (const p of CG.PRESETS) { assert.equal(CG.fitError(p.type, byKey(p.metric), p.intent, TYPES), null, p.key); if (p.metric) assert.ok(byKey(p.metric), p.metric); }
  const opts = { metrics: METRICS.map((m) => m.key), metricUnits: Object.fromEntries(METRICS.map((m) => [m.key, m.unit])), metricKinds: Object.fromEntries(METRICS.map((m) => [m.key, m.window_kind])) };
  const r = W.validateDashboard({ key: 'p', title: 'P', audience: 'site', grid: { columns: 12 }, widgets }, opts);
  assert.deepEqual(r, { ok: true, errors: [] });
});

test('placement: S/M/L sizes pack without overlap or overflow, and respect each type minimum', () => {
  const items = ['kpi', 'kpi', 'trend', 'text', 'actions', 'ragGrid', 'kpi'].map((type, i) => ({ type, size: ['S', 'S', 'M', 'S', 'L', 'M', 'S'][i] }));
  const L = CG.flowLayout(items, 12, TYPES);
  const widgets = items.map((it, i) => ({ id: 'w' + i, type: it.type, layout: L[i], ...(W.WIDGET_TYPES[it.type].needsMetric ? { metric: 'helpdesk.inbound' } : {}), ...(it.type === 'trackerRag' ? { tracker: 'it-activity' } : {}) }));
  assert.deepEqual(W.validateDashboard({ key: 'p', title: 'P', widgets }), { ok: true, errors: [] });
  assert.deepEqual(L[0], { x: 0, y: 0, w: 3, h: 2 });
  assert.equal(L[2].w, 6); assert.equal(L[4].w, 12); assert.equal(L[4].x, 0);
  assert.equal(CG.dims('trend', 'S', 12, TYPES).w, 4, 'trend minimum width wins over Small');
  assert.equal(CG.sizeOf({ w: 12 }), 'L'); assert.equal(CG.sizeOf({ w: 6 }), 'M'); assert.equal(CG.sizeOf({ w: 4 }), 'S');
});

test('server errors are mapped to a field in plain words', () => {
  const widgets = [{ id: 'w1', title: 'Resolution SLA' }, { id: 'w2' }];
  const p = CG.plainErrors([
    { path: 'widgets[0].layout', msg: 'trend needs at least 4×3 cells' },
    { path: 'widgets[1].metric', msg: 'unknown metric x — only registered metrics may be charted' },
    { path: 'key', msg: 'key is required (letters, digits, - or _, max 48)' },
    { path: 'widgets[1]', msg: 'raw sql/query is not allowed in a dashboard definition — register a metric instead' },
  ], widgets);
  assert.equal(p[0].field, 'size'); assert.equal(p[0].widgetId, 'w1');
  assert.match(p[0].line, /^Widget “Resolution SLA” — Size: too small .*choose a larger size/);
  assert.equal(p[1].field, 'metric'); assert.match(p[1].line, /Widget “w2” — Metric: unknown metric x/);
  assert.equal(p[2].field, 'd-key'); assert.equal(p[2].widgetId, null);
  assert.equal(p[3].field, 'advanced'); assert.match(p[3].text, /raw SQL/);
  assert.match(CG.humanize('overlaps widget w3 at cell (1,1)'), /Move up \/ Move down/);
  assert.match(CG.humanize('widget overflows the 12-column grid'), /smaller size/);
});

test('nextId / intentFor / byPosition', () => {
  assert.equal(CG.nextId([{ id: 'w1' }, { id: 'w3' }]), 'w2');
  assert.equal(CG.intentFor('trend'), 'trend'); assert.equal(CG.intentFor('actions'), 'detail'); assert.equal(CG.intentFor('heatmap'), '');
  assert.deepEqual(CG.byPosition([{ id: 'b', layout: { x: 0, y: 3 } }, { id: 'a', layout: { x: 6, y: 0 } }, { id: 'c', layout: { x: 0, y: 0 } }]).map((w) => w.id), ['c', 'a', 'b']);
});
