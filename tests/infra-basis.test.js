'use strict';
// V1b-B Task 4 — additive `basis` column on infra_metric_snapshots (labels recent-vs-window).
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(), 'infrabasis-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'basis-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'basis-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

test('infra snapshot round-trips the basis column', async () => {
  await rdb.upsertInfraSnapshots([{
    site_id: 1, period_type: 'week', period_start: '2026-08-09', period_end: '2026-08-15',
    kpi_family: 'lan', metric_name: 'availability', metric_value: 98, target_value: 99,
    status_color: 'orange', trend: null, source: 'opmanager_rest', data_through: '2026-08-15',
    device_count: 2, included_device_count: 2, collected_at: '2026-08-16T05:10:00Z', basis: 'recent', raw_json: null,
  }]);
  const rows = await rdb.getInfraSnapshots({ site_id: 1, period_type: 'week', kpi_family: 'lan', period_start: '2026-08-09' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].basis, 'recent');
  assert.equal(rows[0].source, 'opmanager_rest');
});

test('a V1a-style row without basis still upserts (basis → null)', async () => {
  await rdb.upsertInfraSnapshots([{
    site_id: 2, period_type: 'week', period_start: '2026-08-09', period_end: '2026-08-15',
    kpi_family: 'wan', metric_name: 'availability', metric_value: 99, target_value: 98,
    status_color: 'green', trend: 'up', source: 'analytics_opmanager', data_through: '2026-08-15',
    device_count: 3, included_device_count: 3, collected_at: '2026-08-16T05:10:00Z', raw_json: null,
  }]);
  const rows = await rdb.getInfraSnapshots({ site_id: 2, period_type: 'week', kpi_family: 'wan', period_start: '2026-08-09' });
  assert.equal(rows.length, 1);
  assert.strictEqual(rows[0].basis, null);
});
