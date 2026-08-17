'use strict';
// WAN SLA / ISP chargeback — wan_outages store: dual-backend reader/writer (sqlite here).
// One row per detected WAN outage. Composite PK (site_id, sub_site, uplink, detected_start),
// no surrogate id (sqlite/pg parity). Mirrors the wan_link_snapshots pattern.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(), 'wanout-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'wanout-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'wanout-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

const OUTAGE = {
  site_id: 7, sub_site: '', uplink: 'wan1', isp: 'Orange', circuit_id: 'CID-001',
  detected_start: '2026-08-10T08:00:00Z', restored_end: null, notified_at: null,
  duration_s: null, attribution: null, attribution_reason: null,
  network_id: 'N7', device_serial: 'Q2-XY', source: 'meraki_api', raw_json: null,
};

test('upsert + read round-trips', async () => {
  await rdb.upsertWanOutage(OUTAGE);
  const got = await rdb.getWanOutages({ site_id: 7 });
  assert.equal(got.length, 1);
  assert.equal(got[0].uplink, 'wan1');
  assert.equal(got[0].isp, 'Orange');
  assert.equal(got[0].circuit_id, 'CID-001');
  assert.equal(got[0].detected_start, '2026-08-10T08:00:00Z');
  assert.equal(got[0].restored_end, null);
  assert.equal(got[0].source, 'meraki_api');
});

test('sub_site defaults to "" when omitted', async () => {
  await rdb.upsertWanOutage({
    site_id: 8, uplink: 'wan2', detected_start: '2026-08-10T09:00:00Z', isp: 'MTN',
  });
  const r = (await rdb.getWanOutages({ site_id: 8 }))[0];
  assert.equal(r.sub_site, '', 'undefined sub_site coerced to ""');
});

test('listOpenWanOutages returns only rows with restored_end IS NULL', async () => {
  // A closed outage should not appear.
  await rdb.upsertWanOutage({
    site_id: 9, uplink: 'wan1', detected_start: '2026-08-01T00:00:00Z',
    restored_end: '2026-08-01T01:00:00Z', duration_s: 3600, isp: 'Orange',
  });
  const open = await rdb.listOpenWanOutages();
  assert.ok(open.every(r => r.restored_end == null), 'all open rows have null restored_end');
  assert.ok(open.find(r => r.site_id === 7), 'the open site-7 outage is listed');
  assert.ok(!open.find(r => r.site_id === 9), 'the closed site-9 outage is not listed');
});

test('closeWanOutage sets restored_end + a correct duration_s (computed in JS)', async () => {
  await rdb.closeWanOutage({
    site_id: 7, sub_site: '', uplink: 'wan1',
    detected_start: '2026-08-10T08:00:00Z', restored_end: '2026-08-10T08:30:00Z',
  });
  const r = (await rdb.getWanOutages({ site_id: 7 }))[0];
  assert.equal(r.restored_end, '2026-08-10T08:30:00Z');
  assert.equal(r.duration_s, 1800, '30 minutes = 1800 seconds');
  // Once closed it is no longer open.
  const open = await rdb.listOpenWanOutages();
  assert.ok(!open.find(x => x.site_id === 7), 'closed outage removed from open list');
});

test('idempotent upsert: re-upserting same PK with new attribution updates in place', async () => {
  await rdb.upsertWanOutage({ ...OUTAGE, attribution: 'isp', attribution_reason: 'ISP circuit down' });
  const got = await rdb.getWanOutages({ site_id: 7 });
  assert.equal(got.length, 1, 'still one row for site 7 (no duplicate)');
  assert.equal(got[0].attribution, 'isp');
  assert.equal(got[0].attribution_reason, 'ISP circuit down');
});

test('getWanOutages filters by uplink and detected_start BETWEEN from/to', async () => {
  await rdb.upsertWanOutage({ site_id: 11, uplink: 'wan1', detected_start: '2026-07-01T00:00:00Z' });
  await rdb.upsertWanOutage({ site_id: 11, uplink: 'wan2', detected_start: '2026-08-15T00:00:00Z' });
  const inAug = await rdb.getWanOutages({ site_id: 11, from: '2026-08-01', to: '2026-08-31' });
  assert.equal(inAug.length, 1);
  assert.equal(inAug[0].uplink, 'wan2');
  const onlyWan1 = await rdb.getWanOutages({ site_id: 11, uplink: 'wan1' });
  assert.equal(onlyWan1.length, 1);
  assert.equal(onlyWan1[0].uplink, 'wan1');
});
