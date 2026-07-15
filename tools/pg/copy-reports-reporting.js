'use strict';
// One-shot copy of reports.db's REPORTING SUITE tables → PostgreSQL (Sub-chunk 4E).
// report_recipients + report_config + report_schedules + report_sent_log. Idempotent
// (upsert on PK). Applies 005_reporting.sql first; advances the report_sent_log IDENTITY
// sequence past copied ids. Guards for tables not yet created in a fresh reports.db
// (they auto-create the first time the app boots each service's _initSchema). Model:
// copy-reports-config.js.
const fs   = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = fs.readFileSync(path.join(__dirname, '../../db/postgres/reports/005_reporting.sql'), 'utf8');

// cols mirror the live sqlite reporting schema (services/report*.js _initSchema).
const TABLES = [
  ['report_recipients', ['site_code', 'site_name', 'coordinator_name', 'coordinator_email', 'coordinator_email_confirmed', 'fm_name', 'fm_email', 'fm_email_confirmed', 'cc_emails', 'active', 'updated_at', 'updated_by'], ['site_code']],
  ['report_config',     ['key', 'value', 'updated_at', 'updated_by'], ['key']],
  ['report_schedules',  ['report_type', 'cadence', 'enabled', 'day', 'time', 'updated_at', 'updated_by'], ['report_type', 'cadence']],
  ['report_sent_log',   ['id', 'report_type', 'site_code', 'period', 'recipients', 'result', 'sent_at'], ['id']],
];

function _upsertSql(table, cols, pk) {
  const ph = cols.map(() => '?').join(', ');
  const setCols = cols.filter(c => !pk.includes(c));
  const conflict = setCols.length
    ? `ON CONFLICT (${pk.join(',')}) DO UPDATE SET ${setCols.map(c => `${c}=EXCLUDED.${c}`).join(', ')}`
    : `ON CONFLICT (${pk.join(',')}) DO NOTHING`;
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ${conflict}`;
}

async function copyReportsReporting(sqlitePath, pg) {
  const sdb = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const counts = {};
  try {
    await pg.exec(SCHEMA);
    await pg.runTransaction(async () => {
      for (const [table, cols, pk] of TABLES) {
        let rows = [];
        try { rows = sdb.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all(); }
        catch (_) { rows = []; console.log(`[copy-reports-reporting] ${table} absent/empty in sqlite — skipped`); }
        const ins = pg.prepare(_upsertSql(table, cols, pk));
        for (const r of rows) await ins.run(...cols.map(c => r[c]));
        counts[table] = rows.length;
      }
      // Advance the report_sent_log IDENTITY/SERIAL sequence past copied ids
      // (COALESCE — empty table → MAX(id)=NULL → setval throws).
      await pg.exec(`SELECT setval(pg_get_serial_sequence('report_sent_log','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM report_sent_log), 1))`);
    });
  } finally { sdb.close(); }
  return counts;
}

module.exports = { copyReportsReporting, _upsertSql, TABLES };

if (require.main === module) {
  (async () => {
    const { makePgDb } = require('../../services/pgDb');
    const url = process.env.PG_URL || process.env.DATABASE_URL;
    if (!url) { console.error('Set PG_URL or DATABASE_URL'); process.exit(2); }
    const src = process.argv[2] || path.join(__dirname, '../../data/reports.db');
    if (!fs.existsSync(src)) { console.error('reports.db not found at ' + src); process.exit(2); }
    const pg = makePgDb(url); await pg.connect();
    try { console.log('[copy-reports-reporting] copied', JSON.stringify(await copyReportsReporting(src, pg))); }
    finally { await pg.close(); }
  })().catch(e => { console.error(e); process.exit(1); });
}
