'use strict';
// P11 F-01 — the survey sync reconciled (deleted) with NO truncation guard: a 5-row export
// wiped 95 stored results + answers, recorded as a success, and the incremental filter (only
// "Survey Sent on" > last sync) meant a later healthy run never restored the history.
// Contract now: (1) a partial export is refused BEFORE any write, nothing deleted, error is
// transient+truncation; (2) a healthy run re-inserts any live result that is missing locally,
// whatever its sent date — so a previously damaged table converges back to the source.
const test = require('node:test');
const assert = require('node:assert');
const { truncate } = require('./_pg-fresh');

const SENT = '06 Mar, 2026 10:00:00';
const mk = (i) => ({ 'Result ID': 'R' + i, 'Response ID': 'P' + i, 'Survey ID': 'S1', 'Survey Name': 'x',
  'Request ID': 'Q' + i, 'Request Display ID': String(i), 'Change ID': '', 'User ID': 'u',
  'Overall Score': '80%', 'Survey Sent on': SENT, 'Survey Responded on': SENT });
const ans = (i) => ({ 'Response ID': 'P' + i, 'Result ID': 'R' + i, 'Question ID': 'q1', 'Text': 't',
  'Option': 'o', 'Score': '5', 'Skipped by Logic': 'false' });
const FULL = Array.from({ length: 100 }, (_, i) => mk(i));

let rdb, sync, feed;
async function counts() {
  const H = rdb.pgHandle();
  return [Number((await H.prepare('SELECT count(*) AS n FROM survey_results').get()).n),
          Number((await H.prepare('SELECT count(*) AS n FROM survey_answers').get()).n)];
}
async function seedFull() {
  await truncate(['survey_results', 'survey_answers', 'sync_metadata']);
  feed = { results: FULL, answers: FULL.map((_, i) => ans(i)) };
  await sync.syncSurveyData();
  assert.deepStrictEqual(await counts(), [100, 100], 'seeded');
}

test.before(async () => {
  rdb = require('../reports-db');
  await rdb.initPgReports();
  sync = require('../zoho-sync');
  sync.init(async (id) => ({ rows: id === '106803000000002079' ? feed.results : feed.answers }), {});
});

test('a truncated survey export is refused (transient) and deletes nothing', async () => {
  await seedFull();
  feed = { results: FULL.slice(0, 5), answers: FULL.slice(0, 5).map((_, i) => ans(i)) };
  let err = null;
  try { await sync.syncSurveyData(); } catch (e) { err = e; }
  assert.ok(err, 'must throw');
  assert.equal(err.truncation, true);
  assert.equal(err.transient, true);
  assert.deepStrictEqual(await counts(), [100, 100], 'no result and no answer deleted');
});

test('within tolerance the reconcile still applies a genuine Zoho deletion', async () => {
  await seedFull();
  feed = { results: FULL.slice(0, 90), answers: FULL.slice(0, 90).map((_, i) => ans(i)) };
  const out = await sync.syncSurveyData();
  assert.equal(out.deleted, 10);
  assert.deepStrictEqual(await counts(), [90, 90]);
});

test('a healthy run restores live results missing locally, even with an old sent date', async () => {
  await seedFull();
  // simulate the pre-fix damage: 95 results + answers deleted while sync_metadata kept advancing
  await rdb.pgHandle().exec("DELETE FROM survey_answers WHERE result_id NOT IN ('R0','R1','R2','R3','R4')");
  await rdb.pgHandle().exec("DELETE FROM survey_results WHERE result_id NOT IN ('R0','R1','R2','R3','R4')");
  assert.deepStrictEqual(await counts(), [5, 5]);
  // stored (5) < fetched (100): growth is accepted by the guard; the old sent date must not hide them
  feed = { results: FULL, answers: FULL.map((_, i) => ans(i)) };
  await sync.syncSurveyData();
  assert.deepStrictEqual(await counts(), [100, 100], 'history restored to the source state');
});
