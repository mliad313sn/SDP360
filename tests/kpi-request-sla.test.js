'use strict';

// KPI denominator tests (audit 3.5): Resolution SLA %, Reopen Rate, First
// Response SLA % — the verdict-only ITSM denominators documented in
// FORMULA_RECONCILIATION.md §6 (D1/D2/D3) and CLAUDE.md:
//   Resolution SLA %   = (closed AND not overdue) / closed     (NOT /total)
//   Reopen Rate        = reopened-of-closed / closed           (NOT /total)
//   First Response SLA = (responded AND violated) / responded  (NOT /total)
// We seed request_records in a throwaway temp DB and assert getRequestMetrics
// uses exactly these denominators.

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-kpi-req-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';

const rdb = require('../reports-db');

let n = 0;
function addReq(o) {
  rdb.db.prepare(
    `INSERT INTO request_records
       (request_id, request_status, pending_status, overdue_status, reopen_count,
        responded_time, first_response_overdue, site, created_time)
     VALUES (@request_id, @request_status, @pending_status, @overdue_status, @reopen_count,
             @responded_time, @first_response_overdue, @site, @created_time)`
  ).run({
    request_id: 'REQ-SMOKE-' + (++n),
    request_status: o.request_status || (o.pending_status === 0 ? 'Closed' : 'Open'),
    pending_status: o.pending_status,
    overdue_status: o.overdue_status || 0,
    reopen_count: o.reopen_count || 0,
    responded_time: o.responded_time === undefined ? '2026-06-01T01:00:00' : o.responded_time,
    first_response_overdue: o.first_response_overdue || 'false',
    site: o.site || 'S1',
    created_time: '2026-06-01T00:00:00',
  });
}

before(() => {
  // 6 closed within SLA, on-time response, not reopened
  for (let i = 0; i < 6; i++) addReq({ pending_status: 0, overdue_status: 0 });
  // 2 closed but SLA-overdue
  for (let i = 0; i < 2; i++) addReq({ pending_status: 0, overdue_status: 1 });
  // 2 closed AND reopened
  for (let i = 0; i < 2; i++) addReq({ pending_status: 0, overdue_status: 0, reopen_count: 1 });
  // 1 closed with first-response violated
  addReq({ pending_status: 0, overdue_status: 0, first_response_overdue: 'true' });
  // 3 open (not responded yet)
  for (let i = 0; i < 3; i++) addReq({ pending_status: 1, overdue_status: 0, responded_time: null });
});

test('Resolution SLA % = (closed AND not overdue) / closed', () => {
  const m = rdb.getRequestMetrics();
  assert.strictEqual(m.total, 14);
  assert.strictEqual(m.closed_count, 11);
  assert.strictEqual(m.open_count, 3);
  // closed & not overdue = 6 + 2(reopened, overdue=0) + 1(frt) = 9 ; 9/11 = 81.8
  assert.strictEqual(m.sla_ok_pct, 81.8, 'denominator is closed, not total');
});

test('Reopen Rate = reopened-of-closed / closed', () => {
  const m = rdb.getRequestMetrics();
  assert.strictEqual(m.reopen_count, 2);
  assert.strictEqual(m.reopen_pct, 18.2, '2 reopened of 11 closed'); // not 2/14
});

test('First Response SLA % = (responded AND violated) / responded', () => {
  const m = rdb.getRequestMetrics();
  assert.strictEqual(m.first_resp_violated_count, 1);
  // responded = 11 (the 3 open have no responded_time) ; 1/11 = 9.1
  assert.strictEqual(m.first_resp_violated_pct, 9.1, 'denominator is responded, not total');
});

test('percentages are null (not 0/NaN) when the denominator is empty', () => {
  const m = rdb.getRequestMetrics({ site: 'NO_SUCH_SITE' });
  assert.strictEqual(m.closed_count, 0);
  assert.strictEqual(m.sla_ok_pct, null);
  assert.strictEqual(m.reopen_pct, null);
  assert.strictEqual(m.first_resp_violated_pct, null);
});
