'use strict';

// KPI denominator test (audit 3.5 / 5.x): Change Success Rate.
// Doctrine (CLAUDE.md + FORMULA_RECONCILIATION.md §6 D4):
//   success rate = Completed / executed
//   executed     = Completed + Failed + Backout (stage=Close, status=Backout)
//   Cancelled and Rejected are EXCLUDED from the denominator.
// We seed change_records in a throwaway temp DB and assert the helper applies
// exactly this denominator (not the older AP "/finalized" which includes
// cancelled + rejected).

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-kpi-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';

const rdb = require('../reports-db');

let n = 0;
function addChange(status, stage, site_id) {
  rdb.db.prepare(
    `INSERT INTO change_records (change_id, status, stage, site_id, created_time)
     VALUES (?,?,?,?,?)`
  ).run('CRQ-SMOKE-' + (++n), status, stage || 'Implement', site_id || 'S1', '2026-06-01T00:00:00');
}

before(() => {
  // 7 Completed, 2 Failed, 1 Backout(Close), 3 Cancelled, 1 Rejected
  for (let i = 0; i < 7; i++) addChange('Completed', 'Close');
  for (let i = 0; i < 2; i++) addChange('Failed', 'Implement');
  addChange('Backout', 'Close');
  for (let i = 0; i < 3; i++) addChange('Cancelled', 'Close');
  addChange('Rejected', 'Review');
});

test('Change Success Rate uses Completed / (Completed + Failed + Backout)', () => {
  const m = rdb.getChangeMetrics();
  assert.strictEqual(m.total, 14, 'total rows');
  assert.strictEqual(m.completed_count, 7, 'completed');
  assert.strictEqual(m.failed_count, 3, 'failed = 2 Failed + 1 Close/Backout');
  assert.strictEqual(m.cancelled_count, 3, 'cancelled');
  assert.strictEqual(m.rejected_count, 1, 'rejected');
  // executed denominator EXCLUDES cancelled + rejected
  assert.strictEqual(m.executed_count, 10, 'executed = 7 + 3');
  assert.strictEqual(m.finalized_count, 11, 'finalized (AP) = 7 + 3 + 1');
  // 7 / 10 = 70.0  (NOT 7/11 = 63.6 which the old AP /finalized would give)
  assert.strictEqual(m.change_success_rate, 70.0, 'ITSM rate excludes cancelled/rejected');
});

test('Change Success Rate is null when nothing executed', () => {
  const m = rdb.getChangeMetrics({ site_id: 'NO_SUCH_SITE' });
  assert.strictEqual(m.executed_count, 0);
  assert.strictEqual(m.change_success_rate, null, 'null, not 0 or NaN, when executed = 0');
});
