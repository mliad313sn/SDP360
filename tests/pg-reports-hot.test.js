'use strict';
// Chunk 4D-1 — reports.db hot-path load layer → PostgreSQL. TDD suite. Runs the
// postgres backend against a throwaway DB; skips cleanly when Postgres is down.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'rhot-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const { makePgDb } = require('../services/pgDb');
const SCHEMA4 = _fs.readFileSync(_path.join(__dirname, '../db/postgres/reports/004_hot.sql'), 'utf8');

// Row builders — the writers use @named params for EVERY column, and the adapter
// (like better-sqlite3) throws on a missing named param. So fill all keys (null
// default) and override. (udf_json is NOT a request-writer column — set via UDF batch.)
const _req = o => ({ request_id:null, display_id:null, subject:null, request_status:null,
  pending_status:1, overdue_status:0, request_type:null, template:null, service_request:0, is_escalated:0,
  reopen_count:0, due_by_time:null, time_elapsed_ms:null, created_time:null, resolved_time:null,
  completed_time:null, responded_time:null, assigned_time:null, last_updated_time:null,
  first_response_overdue:null, technician:null, requester:null, category:null, sub_category:null,
  site:null, tech_group:null, mode:null, impact:null, ...o });
const _chg = o => ({ change_id:null, display_id:null, subject:null, status:null, stage:null,
  stage_status:null, risk:null, change_type:null, emergency:0, category:null, sub_category:null,
  requester:null, requester_id:null, owner_id:null, manager:null, site_id:null, group_id:null,
  group_name:null, scheduled_start:null, scheduled_end:null, completed_time:null, created_time:null,
  closure_code:null, udf_json:null, ...o });
const _cab = o => ({ approval_id:null, change_id:null, approver_name:null, approval_status:null,
  approval_stage:null, approval_level:null, approval_level_status:null, recommendation_requested:null,
  action_taken_on:null, turnaround_minutes:null, rule_type:null, comments:null, ...o });
const _sres = o => ({ result_id:null, response_id:null, survey_id:null, survey_name:null,
  request_id:null, request_display_id:null, change_id:null, user_id:null, overall_score:null,
  survey_sent_on:null, survey_responded_on:null, ...o });
const _sans = o => ({ response_id:null, result_id:null, question_id:null, question_text:null,
  question_type:null, answer_text:null, answer_option:null, score:null, skipped:0, ...o });



async function boot() {
  const ctx = await provisionTestDb();
  if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  return { ctx, rdb };
}

test('hot pg: schema idempotent + sync_metadata seeded', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    await rdb.pgHandle().exec(SCHEMA4);   // re-apply → idempotent
    // Raw count (getSyncStatus isn't forked until Task 2; reading it now would
    // hit the sqlite path = false green).
    const n = Number((await rdb.pgHandle().prepare('SELECT COUNT(*) AS n FROM sync_metadata').get()).n);
    assert.equal(n, 4, '4 sync jobs seeded in pg');
    assert.ok((await rdb.pgHandle().prepare("SELECT to_regclass('public.request_records') AS t").get()).t, 'request_records exists');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('hot pg: writers + raw readers + UDF fallback', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    // request: insert then ON CONFLICT update
    assert.equal(await rdb.upsertRequestBatch([_req({ request_id:'R1', display_id:'#INC-1', request_status:'Open', pending_status:1, site:'Hounde', created_time:'2026-05-10 09:00:00' })]), 1);
    await rdb.upsertRequestBatch([_req({ request_id:'R1', display_id:'#INC-1', request_status:'Closed', pending_status:0, site:'Hounde', created_time:'2026-05-10 09:00:00' })]);
    let rr = await rdb.getRequestRecords({ site:'Hounde' });
    assert.equal(rr.length, 1); assert.equal(rr[0].request_status, 'Closed', 'ON CONFLICT replaced');
    // UDF long-id path (positional: udf_json, request_id)
    await rdb.upsertRequestUdfBatch([{ request_id:'R1', udf_json:'{"RCA":"x"}' }]);
    assert.equal(JSON.parse((await rdb.getRequestRecords({ site:'Hounde' }))[0].udf_json).RCA, 'x');
    // UDF display-id fallback (request_id miss → match display_id)
    await rdb.upsertRequestUdfBatch([{ request_id:'#INC-1', udf_json:'{"RCA":"y"}' }]);
    assert.equal(JSON.parse((await rdb.getRequestRecords({ site:'Hounde' }))[0].udf_json).RCA, 'y', 'display-id fallback');
    // change + CAB
    await rdb.upsertChangeBatch([_chg({ change_id:'C1', display_id:'CRQ-1', status:'Completed', emergency:0, site_id:'HGO', group_name:'Ops', stage_status:'done', created_time:'2026-05-01' })]);
    assert.equal((await rdb.getChangeRecords({ site_id:'HGO' })).length, 1);
    await rdb.upsertCABBatch([_cab({ approval_id:'A1', change_id:'C1', approval_status:'Approved', turnaround_minutes:30 })]);
    assert.equal((await rdb.getCABApprovals({ change_id:'C1' })).length, 1);
    // survey result + answers (append-only)
    await rdb.upsertSurveyResultBatch([_sres({ result_id:'SR1', response_id:'RESP1', overall_score:80, survey_sent_on:'2026-05-02' })]);
    assert.equal((await rdb.getSurveyResults({})).length, 1);
    await rdb.upsertSurveyAnswerBatch([_sans({ response_id:'RESP1', result_id:'SR1', question_text:'Q', score:5 })]);
    await rdb.upsertSurveyAnswerBatch([_sans({ response_id:'RESP1', result_id:'SR1', question_text:'Q', score:5 })]);
    assert.equal((await rdb.getSurveyAnswers('RESP1')).length, 2, 'survey_answers append-only (no unique → re-insert)');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('hot pg: sync metadata cursor + reconcilers', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    await rdb.markSyncSuccess('requests', 42, { deleted: 3, fullSync: true });
    assert.ok(await rdb.getLastSyncAt('requests'), 'cursor set');
    let st = (await rdb.getSyncStatus()).find(s => s.job_name === 'requests');
    assert.equal(st.last_sync_rows, 42); assert.equal(st.deleted_count, 3); assert.ok(st.last_full_sync_at);
    assert.equal(st.sync_count, 1);
    await rdb.markSyncSuccess('requests', 10, {});   // sync_count increments
    assert.equal((await rdb.getSyncStatus()).find(s => s.job_name === 'requests').sync_count, 2);
    await rdb.markSyncError('requests', 'boom');
    st = (await rdb.getSyncStatus()).find(s => s.job_name === 'requests');
    assert.equal(st.last_error, 'boom'); assert.ok(st.last_sync_at, 'error did not clobber last_sync_at');
    // reconcile: seed 3 requests, keep 1
    await rdb.upsertRequestBatch([_req({ request_id:'X1' }), _req({ request_id:'X2' }), _req({ request_id:'X3' })]);
    assert.equal(await rdb.reconcileRequestRecords(new Set(['X1'])), 2, 'deleted 2 stale');
    assert.equal(await rdb.reconcileRequestRecords(new Set()), 0, 'empty liveIds → no-op');
    // survey cascade: result + its answers both deleted
    await rdb.upsertSurveyResultBatch([_sres({ result_id:'S9', response_id:'P9', survey_sent_on:'2026-05-01' })]);
    await rdb.upsertSurveyAnswerBatch([_sans({ response_id:'P9', result_id:'S9', question_text:'Q' })]);
    assert.equal(await rdb.reconcileSurveyResults(new Set(['other'])), 1);
    assert.equal((await rdb.getSurveyAnswers('P9')).length, 0, 'answer cascade deleted');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});


