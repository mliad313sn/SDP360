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
