'use strict';
// V1b-A Task 4 — wan_link_snapshots dual upsert/read (sqlite here; pg smoke in T7).
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(), 'wansnap-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'wansnap-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'wansnap-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

const ROW = {
  site_id: 1, uplink: 'wan1', period_type: 'week', period_start: '2026-08-09', period_end: '2026-08-15',
  availability_pct: 99.86, status_color: 'green', loss_pct_avg: 0.08, latency_ms_avg: 26.1, jitter_ms_avg: 2.17,
  goodput_avg: 1000, status_current: 'active', uplink_label: 'Internet 1', device_serial: 'Q2-AB', network_id: 'N1',
  data_through: '2026-08-15', collected_at: '2026-08-16T05:20:00Z', source: 'meraki_api', raw_json: null,
};

test('upsert + read round-trips', async () => {
  await rdb.upsertWanSnapshots([ROW]);
  const got = await rdb.getWanSnapshots({ site_id: 1, period_type: 'week', period_start: '2026-08-09' });
  assert.equal(got.length, 1);
  assert.equal(got[0].availability_pct, 99.86);
  assert.equal(got[0].uplink, 'wan1');
  assert.equal(got[0].loss_pct_avg, 0.08);
  assert.equal(got[0].source, 'meraki_api');
});

test('ON CONFLICT updates by composite PK (site_id,uplink,period_type,period_start)', async () => {
  await rdb.upsertWanSnapshots([{ ...ROW, availability_pct: 97.5, status_color: 'orange', loss_pct_avg: 1.79 }]);
  const got = await rdb.getWanSnapshots({ site_id: 1, uplink: 'wan1', period_type: 'week', period_start: '2026-08-09' });
  assert.equal(got.length, 1);                 // still one row, updated in place
  assert.equal(got[0].availability_pct, 97.5);
  assert.equal(got[0].status_color, 'orange');
});

test('wan1 and wan2 coexist for the same site/week (per-link, not one wan row)', async () => {
  await rdb.upsertWanSnapshots([{ ...ROW, uplink: 'wan2', availability_pct: 97.87, uplink_label: 'Internet 2' }]);
  const both = await rdb.getWanSnapshots({ site_id: 1, period_type: 'week', period_start: '2026-08-09' });
  assert.equal(both.length, 2);
  assert.deepEqual(both.map(r => r.uplink).sort(), ['wan1', 'wan2']);
});

test('getWanSnapshots filters by uplink + period_start', async () => {
  const only = await rdb.getWanSnapshots({ site_id: 1, uplink: 'wan2', period_type: 'week', period_start: '2026-08-09' });
  assert.equal(only.length, 1);
  assert.equal(only[0].availability_pct, 97.87);
});
