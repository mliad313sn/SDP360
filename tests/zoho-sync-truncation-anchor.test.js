'use strict';
// P11 round 2 — N-01 / N-02.
// N-01: a requests export short by LESS than the tolerance (1000 → 810) deleted 190 tickets, and the
//       incremental filter (Last Updated Time > last sync) meant a later healthy run never put them
//       back: 810 stayed 810 until an operator forced a full sync. Same gap for CAB approvals.
//       Contract now: a healthy run re-inserts every live row missing locally.
// N-02: the guard compared each fetch to the CURRENT local count, so successive sub-tolerance
//       partial exports ratcheted a table down (100 → 81 → 66 → 54 …). Contract now: the baseline is
//       max(stored, last confirmed count); a lossy run never lowers it; a genuine shrink is accepted
//       once two consecutive exports agree on the lower count.
const test = require('node:test');
const assert = require('node:assert');
const { truncate } = require('./_pg-fresh');
const { assertNotTruncated, nextAnchor, guardWithAnchor } = require('../services/sync/truncationGuard');

// ── pure ─────────────────────────────────────────────────────────────────────────────────────
test('guard baseline = max(stored, anchor); stored 0 still accepts anything', () => {
  assert.doesNotThrow(() => assertNotTruncated('j', 81, 100, 20, { anchor: 100 }));
  assert.throws(() => assertNotTruncated('j', 66, 81, 20, { anchor: 100 }), (e) => e.truncation && /last confirmed count 100/.test(e.message));
  assert.doesNotThrow(() => assertNotTruncated('j', 66, 81, 20, {}), 'without an anchor the old (ratcheting) rule');
  assert.doesNotThrow(() => assertNotTruncated('j', 5, 0, 20, { anchor: 1000 }), 'empty table = rebuild');
});

test('nextAnchor: a lossy run never lowers it; a run that lost nothing confirms the source size', () => {
  assert.equal(nextAnchor(null, 100, 0), 100);      // first run
  assert.equal(nextAnchor(100, 81, 100), 100);      // lossy run: keeps the pre-loss count
  assert.equal(nextAnchor(100, 81, 81), 81);        // second consecutive export agrees → genuine shrink
  assert.equal(nextAnchor(100, 120, 100), 120);     // growth
  assert.equal(nextAnchor(null, 81, 100), 100);     // no anchor yet: the stored count before the loss
});

test('guardWithAnchor: a failing anchor store never blocks a sync', async () => {
  const commit = await guardWithAnchor('j', 90, 100, { get: async () => { throw new Error('no table'); }, set: async () => { throw new Error('no table'); } });
  await commit();
});

// ── PostgreSQL: the repro sequences ───────────────────────────────────────────────────────────
let rdb, sync, feed = {};
const mkReq = (i) => ({ 'Request ID': 'X' + i, 'Request Display ID': String(i), 'Subject': 's', 'Request Status': 'Closed',
  'Request Pending Status': '0', 'Overdue Status': '', 'Service Request': '0', 'Request Type': 'Incident', 'IsEscalated': 'false',
  'Reopen Count': '0', 'DueBy Time': '', 'Time Elapsed': '0', 'Created Time': '01 Jan, 2026 10:00:00', 'Resolved Time': '',
  'Completed Time': '', 'Responded Time': '', 'Assigned Time': '', 'Last Updated Time': '02 Jan, 2026 10:00:00',
  'First Response Overdue Status': '', 'Technician': 't', 'Requester': 'r', 'Category': 'c', 'Sub Category': 's', 'Site': 'HOUNDE',
  'Group': 'g', 'Mode': 'Email', 'Request Template': 'Default' });
const mkRes = (i) => ({ 'Result ID': 'R' + i, 'Response ID': 'P' + i, 'Survey ID': 'S1', 'Survey Name': 'x', 'Request ID': 'Q' + i,
  'Request Display ID': String(i), 'Change ID': '', 'User ID': 'u', 'Overall Score': '80%', 'Survey Sent on': '06 Mar, 2026 10:00:00',
  'Survey Responded on': '06 Mar, 2026 10:00:00' });
const mkAns = (i) => ({ 'Response ID': 'P' + i, 'Result ID': 'R' + i, 'Question ID': 'q1', 'Text': 't', 'Option': 'o', 'Score': '5', 'Skipped by Logic': 'false' });
const mkChg = (i) => ({ 'Change ID': 'C' + i, 'Change Display ID': String(i), 'Title': 't', 'Created Time': '01 Jan, 2026 10:00:00' });
const mkCab = (i) => ({ 'Approval ID': 'A' + i, 'Change ID': 'C' + i, 'Approval Status': 'Approved', 'Recommendation Requested Time': '01 Jan, 2026 10:00:00' });

const REQ = Array.from({ length: 1000 }, (_, i) => mkReq(i));
const RES = Array.from({ length: 100 }, (_, i) => mkRes(i));
const CHG = Array.from({ length: 100 }, (_, i) => mkChg(i));
const CAB = Array.from({ length: 100 }, (_, i) => mkCab(i));

const n = async (t) => Number((await rdb.pgHandle().prepare(`SELECT count(*) AS n FROM ${t}`).get()).n);
async function run(fn, opts) { try { await fn(opts); return null; } catch (e) { return e; } }

test.before(async () => {
  rdb = require('../reports-db');
  await rdb.initPgReports();
  sync = require('../zoho-sync');
  sync.init(async (id) => ({ rows: feed[id] || [] }), { REQUEST_TABLE: 'req', MAJOR_INCIDENTS: 'mi', CHANGE_TABLE: 'chg', CAB_RECOMMENDATIONS: 'cab' });
});

test('N-01: requests 1000 → 81 % export → healthy incremental run restores all 1000 (no force needed)', async () => {
  await truncate(['request_records', 'sync_metadata', 'sync_truncation_anchors']);
  feed.req = REQ; await sync.syncRequestData();
  assert.equal(await n('request_records'), 1000, 'full run');
  feed.req = REQ.slice(0, 810);
  assert.equal(await run(sync.syncRequestData), null, 'inside the tolerance: accepted');
  assert.equal(await n('request_records'), 810);
  feed.req = REQ; await sync.syncRequestData();
  assert.equal(await n('request_records'), 1000, 'healthy incremental run re-inserts the 190 lost tickets');
});

test('N-02: requests cannot ratchet — a second 81 % export of what is left is refused, nothing deleted', async () => {
  await truncate(['request_records', 'sync_metadata', 'sync_truncation_anchors']);
  feed.req = REQ; await sync.syncRequestData();
  feed.req = REQ.slice(0, 810); await sync.syncRequestData();
  feed.req = REQ.slice(0, 657);   // 81 % of 810 — was accepted before the fix
  const err = await run(sync.syncRequestData);
  assert.ok(err && err.truncation && err.transient, 'refused against the last confirmed count (1000)');
  assert.equal(await n('request_records'), 810, 'nothing deleted');
});

test('N-02: survey ratchet repro (100 → 81 → 66 …) is stopped at the second run; healthy run restores', async () => {
  await truncate(['survey_results', 'survey_answers', 'sync_metadata', 'sync_truncation_anchors']);
  const set = (rows) => { feed['106803000000002079'] = rows; feed['106803000000002076'] = rows.map((_, i) => mkAns(i)); };
  set(RES); await sync.syncSurveyData();
  set(RES.slice(0, 81)); assert.equal(await run(sync.syncSurveyData), null);
  assert.equal(await n('survey_results'), 81);
  set(RES.slice(0, 66));
  const err = await run(sync.syncSurveyData);
  assert.ok(err && err.truncation, 'second partial run refused');
  assert.equal(await n('survey_results'), 81);
  set(RES); await sync.syncSurveyData();
  assert.equal(await n('survey_results'), 100);
});

test('N-02: a genuine shrink is accepted once two consecutive exports agree on it', async () => {
  await truncate(['survey_results', 'survey_answers', 'sync_metadata', 'sync_truncation_anchors']);
  const set = (rows) => { feed['106803000000002079'] = rows; feed['106803000000002076'] = rows.map((_, i) => mkAns(i)); };
  set(RES); await sync.syncSurveyData();
  set(RES.slice(0, 85)); await sync.syncSurveyData();
  await sync.syncSurveyData();                       // same 85 again → confirmed
  set(RES.slice(0, 70)); assert.equal(await run(sync.syncSurveyData), null, '70 vs confirmed 85 is inside the tolerance');
  assert.equal(await n('survey_results'), 70);
});

test('N-01: CAB approvals lost to a sub-tolerance partial run come back on the next healthy run', async () => {
  await truncate(['change_records', 'cab_approvals', 'sync_metadata', 'sync_truncation_anchors']);
  feed.chg = CHG; feed.cab = CAB; await sync.syncChangeCab();
  assert.equal(await n('cab_approvals'), 100);
  feed.cab = CAB.slice(0, 85); await sync.syncChangeCab();
  assert.equal(await n('cab_approvals'), 85);
  feed.cab = CAB; await sync.syncChangeCab();
  assert.equal(await n('cab_approvals'), 100, 'old requested time no longer hides the missing approvals');
});

test('N-02: assets full-replace cannot ratchet when the live anchor store is wired', async () => {
  const adb = require('../assets-db');
  adb.getDB();
  const { syncAssetView, ASSET_VIEWS } = require('../assets-sync');
  const def = ASSET_VIEWS.find(v => v.name === 'assets');
  await truncate(['sync_truncation_anchors']);
  await adb.replaceTable(def.table, Object.values(def.columns), []);
  const rows = (k) => Array.from({ length: k }, (_, i) => ({ 'Asset ID': 'Z' + i, 'State': 'In Use', 'Site': 'MANA' }));
  const deps = (k) => ({ fetchView: async () => ({ rows: rows(k) }), replaceTable: adb.replaceTable, countRows: adb.countRows,
    markSuccess: async () => {}, markError: async () => {}, anchorStore: rdb.truncationAnchorStore });
  await syncAssetView(def, deps(100));
  await syncAssetView(def, deps(81));
  await assert.rejects(() => syncAssetView(def, deps(66)), (e) => e.truncation === true);
  assert.equal(await adb.countRows(def.table), 81);
});
