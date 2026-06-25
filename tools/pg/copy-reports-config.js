'use strict';
// One-shot copy of reports.db's CONFIG tables → PostgreSQL (Sub-chunk 4B).
// action_departments + audit_log + dashboard_preset_groups. (sites is handled by
// copy-reports-auth.) Idempotent (upsert on PK). Applies 001_auth.sql + 002_config.sql
// first; advances the IDENTITY sequences past copied ids. Model: copy-reports-auth.js.
const fs   = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA1 = fs.readFileSync(path.join(__dirname, '../../db/postgres/reports/001_auth.sql'), 'utf8');
const SCHEMA2 = fs.readFileSync(path.join(__dirname, '../../db/postgres/reports/002_config.sql'), 'utf8');

// cols mirror the live sqlite config schema.
const TABLES = [
  ['action_departments',      ['id', 'name', 'sort_order', 'active', 'created_at', 'updated_at'], ['id']],
  ['audit_log',               ['id', 'report_id', 'site_id', 'user_id', 'username', 'action', 'details', 'created_at'], ['id']],
  ['dashboard_preset_groups', ['scope', 'preset_name', 'group_name', 'display_order', 'updated_at', 'updated_by'], ['scope', 'preset_name', 'group_name']],
];

function _upsertSql(table, cols, pk) {
  const ph = cols.map(() => '?').join(', ');
  const setCols = cols.filter(c => !pk.includes(c));
  const conflict = setCols.length
    ? `ON CONFLICT (${pk.join(',')}) DO UPDATE SET ${setCols.map(c => `${c}=EXCLUDED.${c}`).join(', ')}`
    : `ON CONFLICT (${pk.join(',')}) DO NOTHING`;
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ${conflict}`;
}

async function copyReportsConfig(sqlitePath, pg) {
  const sdb = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const counts = {};
  try {
    await pg.exec(SCHEMA1);
    await pg.exec(SCHEMA2);
    await pg.runTransaction(async () => {
      for (const [table, cols, pk] of TABLES) {
        let rows = [];
        try { rows = sdb.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all(); }
        catch (_) { rows = []; }
        const ins = pg.prepare(_upsertSql(table, cols, pk));
        for (const r of rows) await ins.run(...cols.map(c => r[c]));
        counts[table] = rows.length;
      }
      // Advance IDENTITY sequences (COALESCE — empty table → MAX(id)=NULL → setval throws).
      for (const t of ['action_departments', 'audit_log']) {
        await pg.exec(`SELECT setval(pg_get_serial_sequence('${t}','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM ${t}), 1))`);
      }
    });
  } finally { sdb.close(); }
  return counts;
}

module.exports = { copyReportsConfig, _upsertSql, TABLES };

if (require.main === module) {
  (async () => {
    const { makePgDb } = require('../../services/pgDb');
    const url = process.env.PG_URL || process.env.DATABASE_URL;
    if (!url) { console.error('Set PG_URL or DATABASE_URL'); process.exit(2); }
    const src = process.argv[2] || path.join(__dirname, '../../data/reports.db');
    if (!fs.existsSync(src)) { console.error('reports.db not found at ' + src); process.exit(2); }
    const pg = makePgDb(url); await pg.connect();
    try { console.log('[copy-reports-config] copied', JSON.stringify(await copyReportsConfig(src, pg))); }
    finally { await pg.close(); }
  })().catch(e => { console.error(e); process.exit(1); });
}
