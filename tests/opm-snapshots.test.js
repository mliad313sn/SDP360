'use strict';
// V1a Task 5 — infra_metric_snapshots dual-backend upsert + read + idempotency.
const os = require('os'), fs = require('fs'), path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'opm-snap-'));
process.env.DASH_USER = process.env.DASH_USER || 'opm-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'opm-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

const row = (over = {}) => ({
  site_id: 42, period_type: 'week', period_start: '2026-07-20', period_end: '2026-07-26',
  kpi_family: 'lan', metric_name: 'availability', metric_value: 99.7, target_value: 99,
  status_color: 'green', trend: null, source: 'analytics_opmanager', source_view: 'V123',
  data_through: '2026-07-26', device_count: 5, included_device_count: 5,
  collected_at: '2026-07-27T00:00:00Z', raw_json: '{}', ...over,
});

test('upsert + read round-trip', async () => {
  await rdb.upsertInfraSnapshots([row()]);
  const rows = await rdb.getInfraSnapshots({ site_id: 42, period_type: 'week' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].metric_value, 99.7);
  assert.equal(rows[0].kpi_family, 'lan');
  assert.equal(rows[0].status_color, 'green');
});

test('idempotent: re-upsert same PK updates in place (no dup)', async () => {
  await rdb.upsertInfraSnapshots([row({ metric_value: 98.0, status_color: 'orange' })]);
  const rows = await rdb.getInfraSnapshots({ site_id: 42, period_type: 'week', kpi_family: 'lan' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].metric_value, 98.0);
  assert.equal(rows[0].status_color, 'orange');
});

test('filter by kpi_family + period_start', async () => {
  await rdb.upsertInfraSnapshots([row({ kpi_family: 'wan', metric_value: 100 })]);
  const wan = await rdb.getInfraSnapshots({ site_id: 42, period_type: 'week', kpi_family: 'wan' });
  assert.equal(wan.length, 1); assert.equal(wan[0].metric_value, 100);
  const all = await rdb.getInfraSnapshots({ site_id: 42, period_type: 'week' });
  assert.ok(all.length >= 2);
});
