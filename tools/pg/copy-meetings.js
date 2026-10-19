'use strict';
// One-shot copy of meetings.db → PostgreSQL (Chunk 2 cutover). FK order:
// 11 code-PK lookups → md_meetings → children. Idempotent (upsert on PK,
// full non-PK refresh). Columns are auto-discovered from the SOURCE sqlite
// via PRAGMA (so ALTER-added columns ride along; a column missing from the
// PG schema fails loudly rather than silently dropping data). Advances the
// IDENTITY sequences past copied ids. Model: copy-reports-auth.js.
//
//   PG_URL=postgres://sdp_app:...@localhost:5432/sdp_dashboard \
//     node tools/pg/copy-meetings.js  [path\to\meetings.db]
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = fs.readFileSync(path.join(__dirname, '../../db/postgres/meetings/001_init.sql'), 'utf8');

// [table, pkCols] in FK order (parents first).
const TABLES = [
  ['md_intake_sources',     ['code']],
  ['md_departments',        ['code']],
  ['md_categories',         ['code']],
  ['md_severities',         ['code']],
  ['md_statuses',           ['code']],
  ['md_meeting_statuses',   ['code']],
  ['md_escalation_reasons', ['code']],
  ['md_council_themes',     ['code']],
  ['md_project_phases',     ['code']],
  ['md_it_involvement',     ['code']],
  ['md_engagements',        ['code']],
  ['md_meetings',           ['id']],
  ['md_meeting_projects',   ['id']],
  ['md_issues',             ['id']],
  ['md_issue_updates',      ['id']],
  ['md_actions',            ['id']],
  ['md_action_updates',     ['id']],
  ['md_meeting_attachments',['id']],
];
const IDENTITY_TABLES = ['md_meetings', 'md_meeting_projects', 'md_issues',
  'md_issue_updates', 'md_actions', 'md_action_updates', 'md_meeting_attachments'];

function _upsertSql(table, cols, pk) {
  const ph = cols.map(() => '?').join(', ');
  const setCols = cols.filter(c => !pk.includes(c));
  const conflict = setCols.length
    ? `ON CONFLICT (${pk.join(',')}) DO UPDATE SET ${setCols.map(c => `${c}=EXCLUDED.${c}`).join(', ')}`
    : `ON CONFLICT (${pk.join(',')}) DO NOTHING`;
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ${conflict}`;
}

async function copyMeetings(sqlitePath, pg) {
  const sdb = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const counts = {};
  try {
    await pg.exec(SCHEMA);
    await pg.runTransaction(async () => {
      for (const [table, pk] of TABLES) {
        let cols = [];
        try { cols = sdb.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name); }
        catch (_) { cols = []; }
        if (!cols.length) { counts[table] = 0; continue; }
        const rows = sdb.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all();
        const ins = pg.prepare(_upsertSql(table, cols, pk));
        for (const r of rows) await ins.run(...cols.map(c => r[c]));
        counts[table] = rows.length;
      }
      for (const t of IDENTITY_TABLES) {
        await pg.exec(`SELECT setval(pg_get_serial_sequence('${t}','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM ${t}), 1))`);
      }
    });
  } finally { sdb.close(); }
  return counts;
}

module.exports = { copyMeetings, TABLES, IDENTITY_TABLES };

if (require.main === module) {
  (async () => {
    const { makePgDb } = require('../../services/pgDb');
    const url = process.env.PG_URL || process.env.DATABASE_URL;
    if (!url) { console.error('Set PG_URL or DATABASE_URL'); process.exit(2); }
    const src = process.argv[2] || path.join(__dirname, '../../data/meetings.db');
    if (!fs.existsSync(src)) { console.error('meetings.db not found at ' + src); process.exit(2); }
    const pg = makePgDb(url); await pg.connect();
    try { console.log('[copy-meetings] copied', JSON.stringify(await copyMeetings(src, pg))); }
    finally { await pg.close(); }
  })().catch(e => { console.error(e); process.exit(1); });
}
