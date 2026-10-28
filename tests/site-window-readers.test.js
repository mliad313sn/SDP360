'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The snapshot tests run against a restored COPY of the prod database (PostgreSQL):
//   SDP_SNAPSHOT=1 SDP_TEST_PG_URL=postgres://…/sdp_snapshot_copy node --test tests/site-window-readers.test.js
// (tests/_pg-boot.mjs then uses that database instead of a throwaway one, and never drops it).
const hasSnap = process.env.SDP_SNAPSHOT === '1' && !!process.env.SDP_TEST_PG_URL;
const rdb = require('../reports-db');
const { _computeSiteChanges, _changeOutcome, getSiteHelpdeskWindow, getSiteChangesWindow } = rdb;
const skipSnap = !hasSnap && 'no prod-snapshot';
const siteId = async (code) => (await rdb.getSiteIdByModuleCode('meetings', code)).site_id;

// The shipped classifier reads the RAW ZOHO key names off a row object:
//   r['Change Closure Code'] · r['UDF:Change Implementation Outcome'] · r['UDF:Review decision']
// Our DB row is shaped differently: a `closure_code` COLUMN + a `udf_json` TEXT blob.
// So the port MUST map DB row → those three strings before classifying. Feed the
// pure core the same shape the DB hands it, so the test proves the mapping too.
const row = (o = {}) => ({ status: 'Completed', closure_code: null, emergency: 0,
  udf_json: null, completed_time: null, ...o });
const udf = (o) => JSON.stringify(o);
const outc = (v) => udf({ 'UDF:Change Implementation Outcome': v });

test('_changeOutcome: the nine shipped bucket names', () => {
  // Bucket is 'success' — NOT 'successful'. (executive-report.html:5066)
  assert.strictEqual(_changeOutcome(row({ udf_json: outc('Successful') })),           'success');
  assert.strictEqual(_changeOutcome(row({ udf_json: outc('Partially successful') })), 'partial');
  assert.strictEqual(_changeOutcome(row({ udf_json: outc('Backed out') })),           'backed_out');
  assert.strictEqual(_changeOutcome(row({ udf_json: outc('Cancelled') })),            'cancelled');
  assert.strictEqual(_changeOutcome(row({ udf_json: outc('Deferred') })),             'deferred');
  // 'Failed' exists NOWHERE in the data — derived from the closure code (:5072).
  assert.strictEqual(_changeOutcome(row({ closure_code: 'Closed - Rejected' })),      'failed');
  assert.strictEqual(_changeOutcome(row({ closure_code: 'Closed - Canceled' })),      'cancelled');
  assert.strictEqual(_changeOutcome(row({ closure_code: 'Closed - Completed' })),     'success');
});

// Pins the ported branch. NOTE: on today's data this branch is dead except
// 'rework' — every row with a Review decision also has an Outcome, which wins.
// The test proves the PORT, not the dataset. Don't "simplify" it away.
test('_changeOutcome: UDF:Review decision branch', () => {
  assert.strictEqual(_changeOutcome(row({ udf_json: udf({ 'UDF:Review decision': 'Approved for closure' }) })),           'success');
  assert.strictEqual(_changeOutcome(row({ udf_json: udf({ 'UDF:Review decision': 'Approved for closure -Cancelled' }) })), 'cancelled');
  assert.strictEqual(_changeOutcome(row({ udf_json: udf({ 'UDF:Review decision': 'request rework' }) })),                 'rework');
});

test('_changeOutcome: priority is per-VALUE, not per-field', () => {
  // Review only short-circuits on 'rework' (:5059). Everything else in review is
  // checked BELOW the outcome checks — so outcome WINS over review's success/cancel.
  assert.strictEqual(_changeOutcome(row({ udf_json: udf({ 'UDF:Review decision': 'request rework', 'UDF:Change Implementation Outcome': 'Successful' }) })), 'rework');
  assert.strictEqual(_changeOutcome(row({ udf_json: udf({ 'UDF:Review decision': 'Approved for closure', 'UDF:Change Implementation Outcome': 'Backed out' }) })), 'backed_out');
  // Outcome beats closure code.
  assert.strictEqual(_changeOutcome(row({ udf_json: outc('Backed out'), closure_code: 'Closed - Completed' })), 'backed_out');
});

test('_changeOutcome: no signal → "pending", NOT null (82% have a NULL closure_code)', () => {
  assert.strictEqual(_changeOutcome(row()), 'pending');
  assert.strictEqual(_changeOutcome(row({ udf_json: 'not json' })), 'pending');   // must not throw
  assert.strictEqual(_changeOutcome(null), 'pending');
});

test('_computeSiteChanges: shape mirrors the shipped _tallyChanges + our three extras', () => {
  const rows = [
    row({ udf_json: outc('Successful') }),
    row({ udf_json: outc('Backed out') }),
    row({ udf_json: outc('Successful'), emergency: 1 }),
    row({ status: 'In Progress' }),                       // → pending (all 3 signals null; `status` is never read)
  ];
  const r = _computeSiteChanges(rows);
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.successful, 2);
  assert.strictEqual(r.failed, 1);          // backed_out is MERGED into failed (:5086)
  assert.strictEqual(r.pending, 1);
  assert.strictEqual(r.executed, 3);
  assert.strictEqual(r.emergency, 1);
  assert.strictEqual(r.buckets.backed_out, 1);   // the raw bucket is still there
});

test('_computeSiteChanges: success_pct is over EXECUTED, not total', () => {
  // executed = successful + partial + failed(incl. backed_out) + cancelled  (:5087)
  const rows = [
    row({ udf_json: outc('Successful') }),
    row({ closure_code: 'Closed - Rejected' }),   // failed
    row({ status: 'In Progress' }),               // pending (no signal) → NOT executed
  ];
  assert.strictEqual(_computeSiteChanges(rows).success_pct, 50);   // 1 of 2 executed, NOT 1 of 3
});

test('_computeSiteChanges: cancelled IS executed (shipped formula, not the doc line)', () => {
  const rows = [row({ udf_json: outc('Successful') }), row({ udf_json: outc('Cancelled') })];
  assert.strictEqual(_computeSiteChanges(rows).executed, 2);
  assert.strictEqual(_computeSiteChanges(rows).success_pct, 50);
});

test('_computeSiteChanges: nothing executed → success_pct null, NOT 0', () => {
  const r = _computeSiteChanges([row({ status: 'In Progress' })]);
  assert.strictEqual(r.success_pct, null);   // "nothing to judge" != "0% success"
});

test('_computeSiteChanges: empty → zeros, never throws', () => {
  const r = _computeSiteChanges([]);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.executed, 0);
  assert.strictEqual(r.success_pct, null);
});

test('emergency accepts 1 and "1"', () => {
  assert.strictEqual(_computeSiteChanges([row({ emergency: '1' })]).emergency, 1);
});

// ── INTEGRATION — against a copy of prod-snapshot/reports.db. These prove the
// GROUP SCOPING and the window, which no pure-core test can.

test('getSiteHelpdeskWindow: MGO June 2026, group-scoped', { skip: skipSnap }, async () => {
  const r = getSiteHelpdeskWindow((await siteId('MGO')), '2026-06-01', '2026-06-30');
  assert.strictEqual(r.sla_overdue, 7);        // real field names — _computeSiteHelpdesk
  assert.strictEqual(r.major_incidents, 1);
  assert.ok(r.created > 0);
});

test('getSiteChangesWindow: MGO May 2026 → 4 rows', { skip: skipSnap }, async () => {
  // NOT June: MGO has 0 changes in June, so a June test would pass against an
  // empty set and prove nothing about the scoping.
  assert.strictEqual(getSiteChangesWindow((await siteId('MGO')), '2026-05-01', '2026-05-31').total, 4);
});

test('getSiteChangesWindow: the panel window (2026-04-15..2026-07-14) is group-scoped per site', { skip: skipSnap }, () => {
  const per = ['SML', 'SMI', 'HGO', 'MGO', 'SGO']
    .map(async c => getSiteChangesWindow((await siteId(c)), '2026-04-15', '2026-07-14').total);
  assert.deepStrictEqual(per, [4, 3, 2, 6, 2]);
  // Sum is 17, NOT 43. 43 is every change_records row with NO group filter —
  // it includes Ouagadougou/Abidjan/Exploration and ungrouped rows. This reader
  // is per-site and group-scoped; it can never return 43.
  assert.strictEqual(per.reduce((s, n) => s + n, 0), 17);
});

// ── _computeOpenChanges — the "what is stuck right now" aggregator ───────────
// The month block above can read 0/0/0 for a site that is carrying a change open
// since last year. This is the reader that makes that visible, so its edges
// matter more than its happy path.
const { _computeOpenChanges, getSiteOpenChanges } = rdb;

test('_computeOpenChanges: overdue needs BOTH a planned end AND asOf', () => {
  const out = _computeOpenChanges([
    { change_id: 'a', display_id: '1', stage: 'Implementation', status: 'In Progress',
      scheduled_end: '2026-05-01T00:00:00.000Z', created_time: '2026-01-01T00:00:00.000Z' },
    // No planned end. NOT overdue — it is UNPLANNED, counted separately. Treating
    // a missing date as late would flag half the register on a data gap.
    { change_id: 'b', display_id: '2', stage: 'Close', status: 'In Progress',
      scheduled_end: '', created_time: '2026-06-01T00:00:00.000Z' },
    { change_id: 'c', display_id: '3', stage: 'Review', status: 'In Progress',
      scheduled_end: '2026-12-31T00:00:00.000Z', created_time: '2026-07-01T00:00:00.000Z' },
  ], '2026-07-22');

  assert.strictEqual(out.total, 3);
  assert.strictEqual(out.overdue, 1, 'only the past-dated one');
  assert.strictEqual(out.no_planned_end, 1);
  assert.strictEqual(out.oldest_days, 202, 'age is measured to asOf, never to a live clock');
  // Worklist order: overdue first, then oldest. Creation order would bury the
  // 200-day-old change under this week's noise.
  assert.deepStrictEqual(out.rows.map(r => r.display_id), ['1', '2', '3']);
});

test('_computeOpenChanges: stages follow the ITIL pipeline, not the alphabet', () => {
  const out = _computeOpenChanges([
    { change_id: 'a', stage: 'Close',          status: 'In Progress', created_time: '2026-07-01' },
    { change_id: 'b', stage: 'Submission',     status: 'Requested',   created_time: '2026-07-01' },
    { change_id: 'c', stage: 'Implementation', status: 'In Progress', created_time: '2026-07-01' },
    { change_id: 'd', stage: 'Implementation', status: 'On Hold',     created_time: '2026-07-01' },
    { change_id: 'e', stage: 'Weird',          status: 'In Progress', created_time: '2026-07-01' },
  ], '2026-07-22');
  // A stage the data invents later is APPENDED, never dropped — losing a stuck
  // change because its stage is unknown is the one failure this must not have.
  assert.deepStrictEqual(out.by_stage,
    [{ stage: 'Submission', n: 1 }, { stage: 'Implementation', n: 2 }, { stage: 'Close', n: 1 }, { stage: 'Weird', n: 1 }]);
});

test('_computeOpenChanges: no rows → zeros and a null oldest, never NaN', () => {
  const out = _computeOpenChanges([], '2026-07-22');
  assert.deepStrictEqual(
    { total: out.total, overdue: out.overdue, no_planned_end: out.no_planned_end, oldest: out.oldest_days, rows: out.rows.length },
    { total: 0, overdue: 0, no_planned_end: 0, oldest: null, rows: 0 });
});

test('getSiteOpenChanges is GROUP-scoped and returns zeros for an unmapped site', { skip: !hasSnap && 'no prod-snapshot' }, () => {
  // No zoho_group → no groups → an empty (not throwing, not fleet-wide) result.
  // Reading change_records.site_id instead would return the wrong site's changes.
  const out = getSiteOpenChanges(-1, '2026-07-22');
  assert.strictEqual(out.total, 0);
  assert.deepStrictEqual(out.by_stage, []);
});
