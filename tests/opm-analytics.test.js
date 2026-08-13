'use strict';
// V1a Task 7 — readDailyRows (header→contract mapping, config-gated) + coverageSummary (pure).
const { test } = require('node:test');
const assert = require('node:assert');
const { readDailyRows, coverageSummary } = require('../services/opmAnalytics');
const { classifyKpiFamily } = require('../services/opmClassify');

test('readDailyRows maps the daily view headers → contract keys', async () => {
  const fetchView = async (id) => ({ status: 200, rows: [{
    'Device Key': 'd1', 'Device Name': 'srv1.edv', 'Probe Name': 'Mana', 'Type': 'Windows 2022',
    'Category': 'Server', 'Vendor': 'Microsoft', 'Day': 'Jul 22, 2026 12:00:00 AM',
    'Uptime Percentage': '100%', 'Uptime Duration': '1 days 00 hrs 00 mins 00 secs',
    'Downtime Duration': '0 days 00 hrs 00 mins 00 secs',
    'Dependent Unavailability Duration': '0 days 00 hrs 00 mins 00 secs',
    'Unmonitored Duration': '0 days 00 hrs 00 mins 00 secs' }] });
  const out = await readDailyRows({ fetchView, viewId: 'V1' });
  assert.equal(out.length, 1);
  const r = out[0];
  assert.equal(r.device_key, 'd1'); assert.equal(r.probe, 'Mana'); assert.equal(r.type, 'Windows 2022');
  assert.equal(r.category, 'Server'); assert.equal(r.day, 'Jul 22, 2026 12:00:00 AM');
  assert.equal(r.uptime_pct, '100%'); assert.equal(r.uptime_dur, '1 days 00 hrs 00 mins 00 secs');
});

test('readDailyRows is inert without a view id or fetchView', async () => {
  assert.deepEqual(await readDailyRows({ fetchView: async () => ({ rows: [{}] }), viewId: '' }), []);
  assert.deepEqual(await readDailyRows({ fetchView: null, viewId: 'V1' }), []);
});

test('coverageSummary: dedup per device, included/excluded/unmapped', () => {
  const rows = [
    { device_key: 'a', probe: 'Mana', type: 'Windows 2022', category: 'Server' },
    { device_key: 'a', probe: 'Mana', type: 'Windows 2022', category: 'Server' },   // dup day
    { device_key: 'b', probe: 'Mana', type: 'Meraki MS Series', category: 'Meraki Switch' },
    { device_key: 'c', probe: 'Mana', type: 'Unknown', category: 'Unknown' },        // excluded
    { device_key: 'd', probe: 'ZZ', type: 'Meraki MR Series', category: 'Meraki Radio' }, // unmapped probe
  ];
  const cov = coverageSummary(rows, { classify: classifyKpiFamily, probeToSite: p => (p === 'Mana' ? 42 : null) });
  assert.equal(cov.total, 4);          // a,b,c,d distinct
  assert.equal(cov.included, 2);       // a(server) + b(lan)
  assert.equal(cov.excluded, 1);       // c
  assert.deepEqual(cov.unmapped_probes, ['ZZ']);
  assert.equal(cov.by_family.servers, 1);
  assert.equal(cov.by_family.lan, 1);
});
