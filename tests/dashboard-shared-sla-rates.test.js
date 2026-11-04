'use strict';
// A-17a — trend-chart SLA rates follow the denominator doctrine:
// resolution violations ÷ closed (non-cancelled), first-reply violations ÷ responded,
// and a period with nothing to judge is null (never a fake 0 %).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load() {
  const ctx = { window: {}, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'dashboard-shared.js'), 'utf8')
    + '\n;this.__f = periodSlaRates;', ctx);
  return ctx;
}
const closed = (o = {}) => ({ 'Request Status': 'Closed', 'Request Pending Status': 'No', 'Overdue Status': '0', ...o });
const open = (o = {}) => ({ 'Request Status': 'Open', 'Request Pending Status': 'Yes', 'Overdue Status': '0', ...o });

test('periodSlaRates is exported on window', () => {
  const ctx = load();
  assert.equal(typeof ctx.window.periodSlaRates, 'function');
});

test('resolution violations are divided by closed non-cancelled tickets, first-reply by responded', () => {
  const f = load().__f;
  const rows = [
    closed({ 'Overdue Status': '1', 'Responded Time': '01 Aug 2026 09:00 AM', 'First Response Overdue Status': 'true' }),
    closed({ 'Responded Time': '01 Aug 2026 09:00 AM' }),
    closed({ 'Request Status': 'Cancelled', 'Overdue Status': '1' }),        // out of the resolution denominator
    open({ 'Overdue Status': '1' }),                                          // open: not judged on resolution
    open({ 'Responded Time': '02 Aug 2026 09:00 AM', 'First Response Overdue Status': '1' }),
    open(),                                                                   // never responded: not judged on reply
  ];
  const r = f(rows);
  assert.equal(r.inbound, 6);
  assert.equal(r.closed, 2, 'closed non-cancelled = the resolution denominator');
  assert.equal(r.responded, 3);
  assert.equal(r.res_violated_pct, 50, '1 late of 2 closed non-cancelled');
  assert.equal(r.fr_violated_pct, 66.7, '2 late of 3 responded');
});

test('an empty period gives null rates, not 0', () => {
  const r = load().__f([]);
  assert.equal(r.inbound, 0);
  assert.equal(r.res_violated_pct, null);
  assert.equal(r.fr_violated_pct, null);
});

test('inbound tickets but none closed or responded: both rates null', () => {
  const r = load().__f([open({ 'Overdue Status': '1' }), open()]);
  assert.equal(r.inbound, 2);
  assert.equal(r.res_violated_pct, null);
  assert.equal(r.fr_violated_pct, null);
});

test('index.html renderTrend uses periodSlaRates, pushes null and breaks the lines (spanGaps:false)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const start = html.indexOf('function renderTrend(');
  assert.ok(start > 0);
  const end = html.indexOf('\n}\n', start);
  assert.ok(end > start, 'renderTrend body found');
  const body = html.slice(start, end);
  assert.ok(body.includes('periodSlaRates('), 'uses the shared helper');
  assert.ok(!/\/rows\.length/.test(body), 'no division by all tickets');
  // A-22: the lines are drawn by TrendPanel (public/lib/charts.js), which sets spanGaps:false on every
  // rate line (pinned by tests/charts-static.test.js); here we pin that the null-bearing arrays reach it as is.
  assert.ok(body.includes('TrendPanel.render('), 'drawn by the shared trend panel');
  assert.ok(/data:sv\}/.test(body) && /data:fv\}/.test(body), 'the rate arrays are passed untouched');
  const TrendPanel = require('../public/lib/charts.js');
  const cfg = TrendPanel.buildConfigs({ labels: ['a', 'b'], rate: [{ label: 'r', data: [1, null] }, { label: 'f', data: [null, 2] }] });
  assert.equal(cfg.rate.data.datasets.filter((d) => d.spanGaps === false).length, 2, 'both line datasets break on null');
});
