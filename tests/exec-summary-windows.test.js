'use strict';
// A-08 — Exec View month windows. getRequestMetrics / getChangeMetrics take an
// optional EXCLUSIVE `until` ('YYYY-MM-DD', applied as substr(created_time,1,10) < ?),
// and getChangesWindow(from, to) is the fleet-wide twin of getSiteChangesWindow
// (inclusive dates, classified by the same _computeSiteChanges as the deck).
const test = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

let n = 0;
async function addReq(created, site = 'WIN-SITE') {
  await rdb.db.prepare(
    `INSERT INTO request_records (request_id, request_status, pending_status, overdue_status, reopen_count, site, created_time)
     VALUES (?,?,?,?,?,?,?)`
  ).run('REQ-WIN-' + (++n), 'Closed', 0, 0, 0, site, created);
}
async function addChange(created, status = 'Completed', site_id = 'WIN-SITE') {
  await rdb.db.prepare(
    `INSERT INTO change_records (change_id, status, stage, site_id, created_time)
     VALUES (?,?,?,?,?)`
  ).run('CRQ-WIN-' + (++n), status, 'Close', site_id, created);
}

test.before(async () => {
  await addReq('2026-05-31T23:00:00.000Z');
  await addReq('2026-06-01T00:10:00.000Z');
  await addChange('2026-05-31T23:00:00.000Z', 'Completed');
  await addChange('2026-06-01T00:10:00.000Z', 'Failed');
});

test('getRequestMetrics until excludes the boundary day', async () => {
  const m = await rdb.getRequestMetrics({ site: 'WIN-SITE', since: '2026-05-01', until: '2026-06-01' });
  assert.strictEqual(m.total, 1);
});

test('getRequestMetrics without until keeps today\'s totals (regression)', async () => {
  const m = await rdb.getRequestMetrics({ site: 'WIN-SITE', since: '2026-05-01' });
  assert.strictEqual(m.total, 2);
});

test('getChangeMetrics until excludes later changes', async () => {
  const bounded = await rdb.getChangeMetrics({ site_id: 'WIN-SITE', since: '2026-05-01', until: '2026-06-01' });
  assert.strictEqual(bounded.total, 1);
  assert.strictEqual(bounded.change_success_rate, 100);
  const open = await rdb.getChangeMetrics({ site_id: 'WIN-SITE', since: '2026-05-01' });
  assert.strictEqual(open.total, 2);
});

test('getChangesWindow returns the _computeSiteChanges shape (inclusive dates)', async () => {
  const w = await rdb.getChangesWindow('2026-05-01', '2026-05-31');
  const ref = rdb._computeSiteChanges([]);
  for (const k of Object.keys(ref)) assert.ok(k in w, `missing key ${k}`);
  assert.strictEqual(w.total, 1);
  const both = await rdb.getChangesWindow('2026-05-31', '2026-06-01');
  assert.strictEqual(both.total, 2);
});

test('getChangesWindow: nothing executed → success_pct null, never 0', async () => {
  const w = await rdb.getChangesWindow('2020-01-01', '2020-01-31');
  assert.strictEqual(w.total, 0);
  assert.strictEqual(w.success_pct, null);
  assert.strictEqual(w.success_pct_itsm, null);
});
