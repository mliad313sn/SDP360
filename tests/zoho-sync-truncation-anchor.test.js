'use strict';
// P11 round 2 — N-01 / N-02.
// N-01: a requests export short by LESS than the tolerance (1000 → 810) deleted 190 tickets, and the
//       incremental filter (Last Updated Time > last sync) meant a later healthy run never put them
//       back: 810 stayed 810 until an operator forced a full sync. Same gap for CAB approvals.
//       Contract now: a healthy run re-inserts every live row missing locally.
// N-02: the guard compared each fetch to the CURRENT local count, so successive sub-tolerance
//       partial exports ratcheted a table down (100 → 81 → 66 → 54 …). Contract now: the baseline is
//       max(stored, last confirmed count); a lossy run never lowers it.
// F-14 / N-02r (P11 r3): a run with fetched ≥ stored but < anchor used to reset the anchor to that partial
//       count, so ALTERNATING, growing-by-one or REPEATED partial exports still ratcheted (1000 → 810 →
//       820 → 660 …, 100 → 81 → 81 → 66 …). Contract now: only fetched ≥ anchor moves it; a lower count is
//       pending until an operator confirms it (or the opt-in SRE policy SYNC_TRUNCATION_SHRINK_CONFIRMATIONS).
const test = require('node:test');
const assert = require('node:assert');
const { truncate } = require('./_pg-fresh');
const { assertNotTruncated, nextAnchor, nextAnchorState, confirmShrink, shrinkConfirmations, guardWithAnchor } = require('../services/sync/truncationGuard');

// ── pure ─────────────────────────────────────────────────────────────────────────────────────
test('guard baseline = max(stored, anchor); stored 0 still accepts anything', () => {
  assert.doesNotThrow(() => assertNotTruncated('j', 81, 100, 20, { anchor: 100 }));
  assert.throws(() => assertNotTruncated('j', 66, 81, 20, { anchor: 100 }), (e) => e.truncation && /last confirmed count 100/.test(e.message));
  assert.doesNotThrow(() => assertNotTruncated('j', 66, 81, 20, {}), 'without an anchor the old (ratcheting) rule');
  assert.doesNotThrow(() => assertNotTruncated('j', 5, 0, 20, { anchor: 1000 }), 'empty table = rebuild');
});

test('nextAnchorState: only a confirmed count moves the anchor; a lossy run never lowers it', () => {
  const st = (anchor, pending = null, agree = 0) => ({ anchor, pending, agree });
  assert.deepEqual(nextAnchorState(null, 100, 0), st(100));            // first run
  assert.deepEqual(nextAnchorState(st(100), 81, 100), st(100, 81, 1));  // lossy run: keeps the pre-loss count, 81 pending
  assert.deepEqual(nextAnchorState(st(100, 81, 1), 81, 81), st(100, 81, 2), 'agreement alone never lowers it by default (N-02r)');
  assert.deepEqual(nextAnchorState(st(100, 81, 1), 81, 81, { confirmations: 2 }), st(100, 81, 2), 'P11 r4: policy N=2 never lowers it by itself');
  assert.deepEqual(confirmShrink(st(100, 81, 2)), st(81), 'operator confirmation of the pending count');
  assert.deepEqual(confirmShrink(st(100), 70), st(70));
  assert.throws(() => confirmShrink(st(100)), /no pending count/);
  assert.equal(shrinkConfirmations({}), 0);
  assert.equal(shrinkConfirmations({ SYNC_TRUNCATION_SHRINK_CONFIRMATIONS: '1' }), 0, 'one run is never a confirmation');
  assert.equal(shrinkConfirmations({ SYNC_TRUNCATION_SHRINK_CONFIRMATIONS: '3' }), 3);
  assert.deepEqual(nextAnchorState(st(100), 120, 100), st(120));        // growth
  assert.deepEqual(nextAnchorState(null, 81, 100), st(100, 81, 1));     // no anchor yet: the stored count before the loss
  assert.deepEqual(nextAnchorState(100, 100, 100), st(100), 'legacy numeric anchor read as a state');
  // P11 r3 F-14: a run that lost nothing against what is STORED but sits below the anchor confirms nothing
  assert.deepEqual(nextAnchorState(st(1000, 810, 1), 820, 810), st(1000, 820, 1));
  assert.equal(nextAnchor(st(1000, 810, 1), 820, 810), 1000, 'nextAnchor = the anchor of nextAnchorState');
});

test('F-14: alternating partial exports can no longer ratchet the anchor (1000/810/820/660 → 660 refused)', () => {
  let stored = 1000, state = nextAnchorState(null, 1000, 0);
  const accepted = [];
  for (const f of [810, 820, 660, 670, 540]) {
    try { assertNotTruncated('j', f, stored, 20, { anchor: state.anchor }); }
    catch (e) { assert.ok(e.truncation); continue; }
    state = nextAnchorState(state, f, stored); stored = f; accepted.push(f);
  }
  assert.deepEqual(accepted, [810, 820], 'every run more than 20 % below the confirmed 1000 is refused');
  assert.equal(state.anchor, 1000, 'the anchor never moved down without two agreeing exports');
  assert.ok(stored >= 800, 'cumulative loss bounded by the tolerance');
});

test('F-14: pure ratchet model 100 → 81, 82, 66, 67, 54, 55, 44 stays bounded', () => {
  let stored = 100, state = nextAnchorState(null, 100, 0);
  for (const f of [81, 82, 66, 67, 54, 55, 44]) {
    try { assertNotTruncated('j', f, stored, 20, { anchor: state.anchor }); } catch (_) { continue; }
    state = nextAnchorState(state, f, stored); stored = f;
  }
  assert.equal(state.anchor, 100);
  assert.ok(stored >= 80, `stored ${stored} fell below the tolerance of the confirmed count`);
});

// Pure replay of an export sequence through guard + anchor: returns accepted fetches, final stored and anchor.
function replay(seq, start = 100, opts = {}) {
  let stored = start, state = nextAnchorState(null, start, 0, opts);
  const accepted = [];
  for (const f of seq) {
    try { assertNotTruncated('j', f, stored, 20, { anchor: state.anchor }); } catch (e) { assert.ok(e.truncation); continue; }
    state = nextAnchorState(state, f, stored, opts); stored = f; accepted.push(f);
  }
  return { accepted, stored, anchor: state.anchor };
}

test('N-02r: a REPEATED partial export (deterministic cap) never ratchets: 100 → 81, 81, 66, 66, 54, 54, 44, 44', () => {
  const r = replay([81, 81, 66, 66, 54, 54, 44, 44]);
  assert.deepEqual(r.accepted, [81, 81]);
  assert.equal(r.anchor, 100);
  assert.ok(r.stored >= 80);
});

test('N-02r: a partial export growing by one row per run never ratchets: 100 → 81, 82, 83, 66, 67, 54, 44', () => {
  const r = replay([81, 82, 83, 66, 67, 54, 44]);
  assert.deepEqual(r.accepted, [81, 82, 83]);
  assert.equal(r.anchor, 100);
});

// P11 r4 — SYNC_TRUNCATION_SHRINK_CONFIRMATIONS ≥ 2 used to lower the anchor after N agreeing exports, so a repeated
// row cap (81, 81, 81, 66, 66, 66, 54) walked the table down to 54. The policy now only adds a requirement to the
// operator confirmation; the ratchet holds whatever its value.
test('r4: policy N=2 or N=3 never re-opens the ratchet for a repeated cap 100 → 81,81,81,66,66,66,54', () => {
  for (const confirmations of [2, 3]) {
    const r = replay([81, 81, 81, 66, 66, 66, 54], 100, { confirmations });
    assert.deepEqual(r.accepted, [81, 81, 81], `N=${confirmations}`);
    assert.equal(r.anchor, 100);
    assert.ok(r.stored >= 80);
  }
  const prev = process.env.SYNC_TRUNCATION_SHRINK_CONFIRMATIONS; process.env.SYNC_TRUNCATION_SHRINK_CONFIRMATIONS = '2';
  try { assert.deepEqual(replay([81, 81, 81, 66, 66, 54]).accepted, [81, 81, 81], 'env default path too'); }
  finally { if (prev == null) delete process.env.SYNC_TRUNCATION_SHRINK_CONFIRMATIONS; else process.env.SYNC_TRUNCATION_SHRINK_CONFIRMATIONS = prev; }
});

test('r4: confirmShrink refuses a count above the anchor; policy N adds a confirmation requirement', () => {
  const st = (anchor, pending = null, agree = 0) => ({ anchor, pending, agree });
  assert.throws(() => confirmShrink(st(100), 999999), /above the current anchor 100/);
  assert.throws(() => confirmShrink(st(100, 81, 1), 101), /above the current anchor/);
  assert.deepEqual(confirmShrink(st(100), 100), st(100), 'confirming the anchor itself is harmless');
  assert.throws(() => confirmShrink(st(100, 81, 1), null, { confirmations: 2 }), /requires 2 consecutive runs/);
  assert.deepEqual(confirmShrink(st(100, 81, 2), null, { confirmations: 2 }), st(81));
  assert.deepEqual(confirmShrink(st(100, 81, 1), null, { confirmations: 0 }), st(81), 'no policy: operator alone decides');
});

// P11 r4 — an unreadable anchor store used to degrade silently (console.warn) to the stored-only guard, so 100 → 36
// was accepted. It now logs to the system log (category sync) and refuses any shrink; growth still syncs.
test('r4: an unreadable anchor store is logged and fails closed for shrinks, growth still syncs', async () => {
  const logs = [];
  const broken = { get: async () => { throw new Error('no table'); }, set: async () => { throw new Error('should not be called'); } };
  const orig = console.warn; console.warn = () => {};
  try {
    await assert.rejects(guardWithAnchor('j', 36, 100, broken, 20, { logEvent: (e) => logs.push(e) }), (e) => e.truncation && e.transient && /anchor could not be read/.test(e.message));
    await assert.rejects(guardWithAnchor('j', 99, 100, broken, 20, { logEvent: (e) => logs.push(e) }), (e) => e.truncation, 'even inside the tolerance');
    const commit = await guardWithAnchor('j', 120, 100, broken, 20, { logEvent: (e) => logs.push(e) });
    await commit();   // never writes over an anchor it could not read
    const commit0 = await guardWithAnchor('j', 50, 0, broken, 20, { logEvent: (e) => logs.push(e) });
    await commit0();  // empty table = rebuild
  } finally { console.warn = orig; }
  assert.equal(logs.length, 4);
  assert.ok(logs.every((l) => l.category === 'sync' && l.action === 'sync_truncation_anchor_unreadable' && l.risk === 1 && l.target === 'j'));
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

test('F-14: requests 1000 → 810 → 820 → 660 → 670 → 540 — the 660 run onwards is refused, nothing deleted', async () => {
  await truncate(['request_records', 'sync_metadata', 'sync_truncation_anchors']);
  feed.req = REQ; await sync.syncRequestData();
  const out = [];
  for (const k of [810, 820, 660, 670, 540]) {
    feed.req = REQ.slice(0, k);
    const err = await run(sync.syncRequestData);
    out.push({ k, refused: !!(err && err.truncation), stored: await n('request_records') });
  }
  assert.deepEqual(out.map(o => o.refused), [false, false, true, true, true]);
  assert.equal(await n('request_records'), 820, 'nothing deleted after the anchor refused the run');
  const a = await rdb.pgHandle().prepare("SELECT anchor_count FROM sync_truncation_anchors WHERE guard_key = 'requests'").get();
  assert.equal(Number(a.anchor_count), 1000, 'anchor still the confirmed count');
});

test('N-02r: requests repeated cap 1000 → 810, 810, 660, 660 — refused from 660, anchor stays 1000', async () => {
  await truncate(['request_records', 'sync_metadata', 'sync_truncation_anchors']);
  feed.req = REQ; await sync.syncRequestData();
  const refused = [];
  for (const k of [810, 810, 660, 660]) { feed.req = REQ.slice(0, k); const err = await run(sync.syncRequestData); refused.push(!!(err && err.truncation)); }
  assert.deepEqual(refused, [false, false, true, true]);
  assert.equal(await n('request_records'), 810);
  assert.equal((await rdb.truncationAnchorStore.get('requests')).anchor, 1000);
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

test('N-02r: a repeated partial survey export cannot lower the anchor; an operator-confirmed shrink can', async () => {
  await truncate(['survey_results', 'survey_answers', 'sync_metadata', 'sync_truncation_anchors']);
  const set = (rows) => { feed['106803000000002079'] = rows; feed['106803000000002076'] = rows.map((_, i) => mkAns(i)); };
  set(RES); await sync.syncSurveyData();
  set(RES.slice(0, 85)); await sync.syncSurveyData();
  await sync.syncSurveyData();                       // same 85 again — agreement is not a confirmation
  set(RES.slice(0, 70));
  const err = await run(sync.syncSurveyData);
  assert.ok(err && err.truncation, '70 vs confirmed 100 refused');
  assert.equal(await n('survey_results'), 85);
  const st = await rdb.truncationAnchorStore.get('survey/results');
  assert.deepEqual(st, { anchor: 100, pending: 85, agree: 2 });
  await rdb.truncationAnchorStore.set('survey/results', confirmShrink(st));   // the operator gesture
  assert.equal(await run(sync.syncSurveyData), null, '70 vs operator-confirmed 85 is inside the tolerance');
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

test('tools/sync/confirm-shrink.js: dry run by default, --apply lowers the anchor to the pending count', async () => {
  await truncate(['sync_truncation_anchors']);
  await rdb.truncationAnchorStore.set('fx/job', { anchor: 100, pending: 85, agree: 2 });
  const cli = require('../tools/sync/confirm-shrink');
  const out = []; const io = { log: (s) => out.push(s), err: (s) => out.push('ERR ' + s) };
  assert.equal(await cli.main(['--job=fx/job'], io), 0);
  assert.equal((await rdb.truncationAnchorStore.get('fx/job')).anchor, 100, 'dry run writes nothing');
  assert.equal(await cli.main(['--job=fx/job', '--apply'], io), 0);
  assert.deepEqual(await rdb.truncationAnchorStore.get('fx/job'), { anchor: 85, pending: null, agree: 0 });
  assert.equal(await cli.main(['--job=fx/job', '--apply'], io), 2, 'nothing pending any more: refuses without --count');
  assert.equal(await cli.main(['--job=fx/job', '--count=-3'], io), 2);
  assert.equal(await cli.main(['--job=fx/job', '--count=999999'], io), 2, 'P11 r4: a count above the anchor is refused');
  assert.match(out.join('\n'), /above the current anchor 85/);
  assert.equal(await cli.main(['--job=nope'], io), 2);
  assert.match(out.join('\n'), /anchor 100 → 85/);
});
