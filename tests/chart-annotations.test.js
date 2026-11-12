'use strict';
// E-V08 — chart annotations: pure validation (source mandatory, label ≤ 120, no inference) + render helpers.
const test = require('node:test');
const assert = require('node:assert/strict');
const CA = require('../services/chartAnnotations');
const R = require('../public/lib/dashboardRender');

const ok = { at: '2026-10-05', label: 'ISP outage at Hounde', source_kind: 'ticket', source_ref: '312004', site_id: 3, metric_key: 'helpdesk.sla_res_pct' };

test('validate: a source is mandatory and checked per kind', () => {
  assert.equal(CA.validate(ok).value.source_ref, '#312004');
  assert.equal(CA.validate({ ...ok, source_ref: '' }).ok, false);
  assert.match(CA.validate({ ...ok, source_kind: '' }).errors.join(), /source_kind/);
  assert.equal(CA.validate({ ...ok, source_ref: 'abc' }).ok, false, 'ticket = number');
  assert.equal(CA.validate({ ...ok, source_kind: 'decision', source_ref: 'CAB-2026-11' }).ok, true);
  assert.equal(CA.validate({ ...ok, source_kind: 'decision', source_ref: '<b>x</b>' }).ok, false);
  assert.equal(CA.validate({ ...ok, source_kind: 'url', source_ref: 'https://sdp.example/ticket/1' }).ok, true);
  for (const bad of ['javascript:alert(1)', 'ftp://x/y', 'https://user:pw@host/x', 'not a url']) assert.equal(CA.validate({ ...ok, source_kind: 'url', source_ref: bad }).ok, false, bad);
});

test('validate: label 1..120, a real date, metric/site shapes', () => {
  assert.equal(CA.validate({ ...ok, label: '  ' }).ok, false);
  assert.equal(CA.validate({ ...ok, label: 'x'.repeat(121) }).ok, false);
  assert.equal(CA.validate({ ...ok, label: 'x'.repeat(120) }).ok, true);
  assert.equal(CA.validate({ ...ok, at: '2026-13-40' }).ok, false);
  assert.equal(CA.validate({ ...ok, at: '05/10/2026' }).ok, false);
  assert.equal(CA.validate({ ...ok, metric_key: 'drop table;' }).ok, false);
  assert.equal(CA.validate({ ...ok, site_id: 'x' }).ok, false);
  assert.equal(CA.validate({ ...ok, site_id: null }).value.site_id, null);
});

test('canWrite: editor on own sites only; group-wide needs the admin tier', () => {
  assert.equal(CA.canWrite({}, 3, { isAdmin: false, siteIds: [3, 4] }), true);
  assert.equal(CA.canWrite({}, 5, { isAdmin: false, siteIds: [3, 4] }), false);
  assert.equal(CA.canWrite({}, null, { isAdmin: false, siteIds: [3] }), false);
  assert.equal(CA.canWrite({}, null, { isAdmin: true, siteIds: [] }), true);
});

test('render: annotations land on the period that contains their date; outside the series → none', () => {
  const pts = [{ label: '2026-W40' }, { label: '2026-W41' }, { label: '2026-10' }];
  const anns = [{ id: 1, at: '2026-10-05', label: 'A', source_kind: 'ticket', source_ref: '#1' }, { id: 2, at: '2025-01-01', label: 'old' }];
  const m = R.annotationMarks(pts, anns);
  assert.deepEqual(m.map((x) => [x.index, x.annotation.id]), [[1, 1]]);
});

test('render: the annotation list escapes text, links only http(s) sources, never says "cause"', () => {
  const html = R.annotationsHtml([{ id: 7, at: '2026-10-05', label: '<img src=x> outage', source_kind: 'url', source_ref: 'https://sdp.example/t/1' },
    { id: 8, at: '2026-10-06', label: 'CAB', source_kind: 'decision', source_ref: 'CAB-2026-11' },
    { id: 9, at: '2026-10-07', label: 'bad', source_kind: 'url', source_ref: 'javascript:alert(1)' }], { canDelete: true });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /href="https:\/\/sdp\.example\/t\/1" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /CAB-2026-11/);
  assert.match(html, /data-ann-del="7"/);
  assert.doesNotMatch(html.toLowerCase(), /cause/);
  assert.equal(R.annotationsHtml([]), '');
});

test('TrendPanel: annotations add ONE marker dataset on the rate panel, at measured values only (never a 0)', () => {
  const TP = require('../public/lib/charts');
  const spec = { labels: ['W1', 'W2', 'W3'], volume: [{ label: 'n', data: [1, 2, 3] }], rate: [{ label: 'SLA', data: [90, null, 80] }],
    annotations: [{ index: 1, label: 'gap week' }, { index: 2, label: 'outage' }, { index: 9, label: 'outside' }] };
  const cfg = TP.buildConfigs(spec, { series: ['#000000'], target: '#111111' });
  const ann = cfg.rate.data.datasets.filter((d) => d.label === 'Annotation (human note)');
  assert.equal(ann.length, 1);
  assert.deepEqual(ann[0].data, [null, null, 80]);
  assert.equal(ann[0].showLine, false);
  const none = TP.buildConfigs({ labels: ['W1'], rate: [{ label: 'SLA', data: [90] }] }, { series: ['#000000'] });
  assert.equal(none.rate.data.datasets.length, 1, 'no annotations → today\'s chart');
});

test('dashboards.html: notes are fetched from the switch-gated route and are hideable per viewer', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'dashboards.html'), 'utf8');
  assert.match(src, /\/api\/dashboards\/annotations/);
  assert.match(src, /id="annWrap" hidden/);
  assert.match(src, /R\.annotationMarks\(/);
  assert.match(src, /R\.annotationsHtml\(/);
  assert.match(src, /dash_show_notes/);
});
