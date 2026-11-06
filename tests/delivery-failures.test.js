'use strict';
// E-R04 — report-delivery failures are listed (only result 'fail' / failed publish runs), never the recipients'
// addresses or a URL, and the outbound alert stays off at delivery_failure_alert_enabled = '0'.
const { test } = require('node:test');
const assert = require('node:assert');
const F = require('../services/deliveryFailures');
const { createAlerter } = require('../services/sync/alerts');
const { DEFAULTS } = require('../services/reportConfig');

const sent = [
  { report_type: 'hygiene', site_code: 'GROUP', period: '2026-W44', recipients: 'a@x.com,b@x.com', result: 'fail', sent_at: '2026-11-02T07:00:00Z' },
  { report_type: 'weekly_report', site_code: 'HGO', period: '2026-W44', recipients: 'c@x.com', result: 'ok', sent_at: '2026-11-02T07:01:00Z' },
  { report_type: 'weekly_report', site_code: 'HGO', period: '2026-W43', recipients: 'c@x.com', result: 'resent', sent_at: '2026-10-28T07:01:00Z' },
];
const pub = [
  { job: 'publish.connectors', status: 'error', started_at: '2026-11-03T05:00:00Z', finished_at: '2026-11-03T05:00:02Z', error: 'POST https://hooks.example.com/abc?sig=XYZ failed for ops@endeavour.com token=abcd' },
  { job: 'publish.connectors', status: 'ok', started_at: '2026-11-04T05:00:00Z' },
];

test('switch ships off', () => { assert.equal(DEFAULTS.delivery_failure_alert_enabled, '0'); });

test('only fail rows and failed publish runs are listed, newest first', () => {
  const d = F.shapeDeliveryFailures({ sentRows: sent, publishRows: pub, days: 14 });
  assert.equal(d.total, 2); assert.deepEqual(d.by_kind, { report_send: 1, publish: 1 });
  assert.deepEqual(d.failures.map((f) => f.kind), ['publish', 'report_send']);
  assert.equal(d.failures[1].type, 'hygiene'); assert.equal(d.failures[1].recipients_count, 2);
});

test('no address, URL or token-shaped value leaves the list', () => {
  const j = JSON.stringify(F.shapeDeliveryFailures({ sentRows: sent, publishRows: pub }));
  assert.ok(!/@/.test(j), j); assert.ok(!/https?:/.test(j), j); assert.ok(!/abcd|XYZ/.test(j), j);
  assert.match(j, /<url>/); assert.match(j, /<address>/);
});

test('nothing failed → an empty list, not an error', () => {
  const d = F.shapeDeliveryFailures({ sentRows: sent.slice(1), publishRows: pub.slice(1) });
  assert.equal(d.total, 0); assert.deepEqual(d.failures, []);
});

function alerter() {
  const out = []; const wm = new Map();
  return { a: createAlerter({ store: { recentRuns: async () => [], getWatermark: async (k) => wm.get(k) || null, setWatermark: async (k, v) => wm.set(k, v) }, senders: [async (m) => out.push(m)] }), out };
}
test('alert: off sends nothing; on sends one message per new batch, never twice, no address in the text', async () => {
  const d = F.shapeDeliveryFailures({ sentRows: sent, publishRows: pub });
  const { a, out } = alerter();
  assert.equal(await a.checkDelivery(d, { enabled: false }), null); assert.equal(out.length, 0);
  const m = await a.checkDelivery(d, { enabled: true });
  assert.equal(m.kind, 'delivery'); assert.match(m.text, /2 report delivery failure/); assert.ok(!/@|https?:/.test(m.text));
  assert.equal(await a.checkDelivery(d, { enabled: true }), null, 'already announced');
  const later = F.shapeDeliveryFailures({ sentRows: [{ ...sent[0], sent_at: '2026-11-05T07:00:00Z' }] });
  assert.match((await a.checkDelivery(later, { enabled: true })).text, /1 report delivery failure/);
});
