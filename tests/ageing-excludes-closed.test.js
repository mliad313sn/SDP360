'use strict';
// Defence-in-depth (fix #3): the ageing readers must NOT count a ticket whose
// Request Status is terminal, even if its pending_status is (wrongly) 1. This is
// what protected the July-2026 ageing chart from the corrupt PG pending_status.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ageing-'));
process.env.DASH_USER = process.env.DASH_USER || 'ageing-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ageing-pass-0000';

const { test, before } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db.js');

const OLD = '2020-01-01T00:00:00.000Z';   // > 60 days old
function row(id, status, pending, group) {
  return {
    request_id: id, display_id: id, subject: 's', request_status: status,
    pending_status: pending, overdue_status: 0, request_type: 'Incident', template: null,
    service_request: 0, is_escalated: 0, reopen_count: 0, due_by_time: null, time_elapsed_ms: null,
    created_time: OLD, resolved_time: null, completed_time: null, responded_time: null, assigned_time: null,
    last_updated_time: OLD, first_response_overdue: 'false', technician: null, requester: null,
    category: null, sub_category: null, site: 'TestSite', tech_group: group, mode: null, impact: null,
  };
}

before(async () => {
  await rdb.upsertRequestBatch([
    row('R1', 'Open',      1, 'Test IT'),   // genuinely open >60d  → counted
    row('R2', 'Closed',    1, 'Test IT'),   // CORRUPT: pending=1 but Closed → must be excluded
    row('R3', 'Resolved',  1, 'Test IT'),   // CORRUPT: pending=1 but Resolved → excluded
    row('R4', 'Cancelled', 1, 'Test IT'),   // CORRUPT: pending=1 but Cancelled → excluded
    row('R5', 'Closed',    0, 'Test IT'),   // properly closed → excluded anyway
  ]);
});

test('getAgeingByGroupDB counts only genuinely-open tickets', async () => {
  const g = (await rdb.getAgeingByGroupDB()).find(x => x.group === 'Test IT');
  assert.ok(g, 'Test IT group present');
  assert.equal(g.total, 1, 'only R1 (Open) counts — the 3 corrupt closed-with-pending=1 are excluded');
  assert.equal(g.tOver60, 1, 'the one open ticket is >60d');
});

test('getAgeingBySiteDB counts only genuinely-open tickets', async () => {
  const s = (await rdb.getAgeingBySiteDB()).find(x => x.site === 'TestSite');
  assert.ok(s, 'TestSite present');
  assert.equal(s.total, 1, 'only R1 counts at the site level too');
});
