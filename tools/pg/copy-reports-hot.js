'use strict';
// One-shot copy of reports.db's HOT-PATH (Zoho-synced) tables → PostgreSQL (Sub-chunk 4D-1).
// request_records / change_records / cab_approvals / survey_results / survey_answers /
// sync_metadata. Idempotent upsert on the Zoho-id PK (survey_answers + sync_metadata by their
// own PK). Advances the 5 IDENTITY sequences. Applies 001+002+003+004 schemas first.
// Batched: rows are inserted one-per-prepared-call inside a single transaction; the SELECT is
// paged (PAGE rows) so a 25k-row request_records table doesn't materialise all at once.
// Model: copy-reports-config.js / copy-reports-reports.js.
const fs   = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMAS = ['001_auth', '002_config', '003_reports', '004_hot'].map(n =>
  fs.readFileSync(path.join(__dirname, `../../db/postgres/reports/${n}.sql`), 'utf8'));

const PAGE = 5000;   // source SELECT page size (memory bound for big tables)

// cols mirror the live sqlite hot tables (incl ALTER-added cols). pk = upsert conflict target.
const TABLES = [
  ['change_records', ['id','change_id','display_id','subject','status','stage','stage_status','risk','change_type','emergency','category','sub_category','requester','requester_id','owner_id','manager','site_id','group_id','group_name','scheduled_start','scheduled_end','completed_time','created_time','closure_code','udf_json','fetched_at'], ['change_id']],
  ['cab_approvals', ['id','approval_id','change_id','approver_name','approval_status','approval_stage','approval_level','approval_level_status','recommendation_requested','action_taken_on','turnaround_minutes','rule_type','comments','fetched_at'], ['approval_id']],
  ['survey_results', ['id','result_id','response_id','survey_id','survey_name','request_id','request_display_id','change_id','user_id','overall_score','survey_sent_on','survey_responded_on','fetched_at'], ['result_id']],
  // survey_answers: 4th element = dedup WHERE clause. Pre-dedup-migration DBs
  // carry duplicate (response_id, question_id) rows (writer had no UNIQUE key);
  // PG's uq_sa_response_question would reject them mid-copy, so keep only the
  // oldest row per key at SELECT time. NULL-safe: no NULL question_ids in prod.
  ['survey_answers', ['id','response_id','result_id','question_id','question_text','question_type','answer_text','answer_option','score','skipped','fetched_at'], ['id'],
   'WHERE id IN (SELECT MIN(id) FROM survey_answers GROUP BY response_id, question_id)'],
  ['request_records', ['id','request_id','display_id','subject','request_status','pending_status','overdue_status','request_type','template','service_request','is_escalated','reopen_count','due_by_time','time_elapsed_ms','created_time','resolved_time','completed_time','responded_time','assigned_time','last_updated_time','first_response_overdue','technician','requester','category','sub_category','site','tech_group','mode','impact','udf_json','fetched_at'], ['request_id']],
  ['sync_metadata', ['job_name','last_sync_at','last_sync_rows','last_error','last_error_at','sync_count','last_full_sync_at','schema_snapshot','deleted_count'], ['job_name']],
];
const IDENTITY_TABLES = ['change_records', 'cab_approvals', 'survey_results', 'survey_answers', 'request_records'];

function _upsertSql(table, cols, pk) {
  const ph = cols.map(() => '?').join(', ');
  const setCols = cols.filter(c => !pk.includes(c));
  const conflict = setCols.length
    ? `ON CONFLICT (${pk.join(',')}) DO UPDATE SET ${setCols.map(c => `${c}=EXCLUDED.${c}`).join(', ')}`
    : `ON CONFLICT (${pk.join(',')}) DO NOTHING`;
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ${conflict}`;
}

async function copyReportsHot(sqlitePath, pg) {
  const sdb = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const counts = {};
  try {
    for (const s of SCHEMAS) await pg.exec(s);
    for (const [table, cols, pk, where] of TABLES) {
      const sql = _upsertSql(table, cols, pk);
      let copied = 0, offset = 0;
      // Page through the source so big tables don't materialise all rows at once.
      for (;;) {
        let page = [];
        try { page = sdb.prepare(`SELECT ${cols.join(', ')} FROM ${table} ${where || ''} LIMIT ? OFFSET ?`).all(PAGE, offset); }
        catch (_) { page = []; }
        if (!page.length) break;
        await pg.runTransaction(async () => {
          for (const r of page) await pg.prepare(sql).run(...cols.map(c => r[c]));
        });
        copied += page.length; offset += PAGE;
        if (page.length < PAGE) break;
      }
      counts[table] = copied;
    }
    for (const t of IDENTITY_TABLES) {
      await pg.exec(`SELECT setval(pg_get_serial_sequence('${t}','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM ${t}), 1))`);
    }
  } finally { sdb.close(); }
  return counts;
}

module.exports = { copyReportsHot, _upsertSql, TABLES, IDENTITY_TABLES };

if (require.main === module) {
  (async () => {
    const { makePgDb } = require('../../services/pgDb');
    const url = process.env.PG_URL || process.env.DATABASE_URL;
    if (!url) { console.error('Set PG_URL or DATABASE_URL'); process.exit(2); }
    const src = process.argv[2] || path.join(__dirname, '../../data/reports.db');
    if (!fs.existsSync(src)) { console.error('reports.db not found at ' + src); process.exit(2); }
    const pg = makePgDb(url); await pg.connect();
    try { console.log('[copy-reports-hot] copied', JSON.stringify(await copyReportsHot(src, pg))); }
    finally { await pg.close(); }
  })().catch(e => { console.error(e); process.exit(1); });
}
