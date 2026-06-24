'use strict';
// One-shot copy of reports.db's AUTH tables → PostgreSQL (Sub-chunk A).
// sites → users → user_roles → sessions (FK order). Idempotent (upsert on PK).
// Applies db/postgres/reports/001_auth.sql first; advances the sites/users
// IDENTITY sequences past copied ids. Model: tools/pg/copy-tracker.js.
const fs   = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = fs.readFileSync(path.join(__dirname, '../../db/postgres/reports/001_auth.sql'), 'utf8');

// FK order. cols mirror the live sqlite auth schema.
const TABLES = [
  ['sites',      ['id', 'name', 'zoho_group', 'active', 'sort_order'], ['id']],
  ['users',      ['id', 'username', 'full_name', 'password_hash', 'salt', 'site_id', 'role', 'active', 'created_at'], ['id']],
  ['user_roles', ['user_id', 'role', 'granted_at'], ['user_id', 'role']],
  ['sessions',   ['token', 'user_id', 'expires_at', 'created_at', 'last_seen'], ['token']],
];

function _upsertSql(table, cols, pk) {
  const ph = cols.map(() => '?').join(', ');
  const setCols = cols.filter(c => !pk.includes(c));
  const conflict = setCols.length
    ? `ON CONFLICT (${pk.join(',')}) DO UPDATE SET ${setCols.map(c => `${c}=EXCLUDED.${c}`).join(', ')}`
    : `ON CONFLICT (${pk.join(',')}) DO NOTHING`;
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ${conflict}`;
}

async function copyReportsAuth(sqlitePath, pg) {
  const sdb = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const counts = {};
  try {
    await pg.exec(SCHEMA);
    await pg.runTransaction(async () => {
      for (const [table, cols, pk] of TABLES) {
        let rows = [];
        try { rows = sdb.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all(); }
        catch (_) { rows = []; }
        const ins = pg.prepare(_upsertSql(table, cols, pk));
        for (const r of rows) await ins.run(...cols.map(c => r[c]));
        counts[table] = rows.length;
      }
      for (const t of ['sites', 'users']) {
        await pg.exec(`SELECT setval(pg_get_serial_sequence('${t}','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM ${t}), 1))`);
      }
    });
  } finally { sdb.close(); }
  return counts;
}

module.exports = { copyReportsAuth, _upsertSql, TABLES };

if (require.main === module) {
  (async () => {
    const { makePgDb } = require('../../services/pgDb');
    const url = process.env.PG_URL || process.env.DATABASE_URL;
    if (!url) { console.error('Set PG_URL or DATABASE_URL'); process.exit(2); }
    const src = process.argv[2] || path.join(__dirname, '../../data/reports.db');
    if (!fs.existsSync(src)) { console.error('reports.db not found at ' + src); process.exit(2); }
    const pg = makePgDb(url); await pg.connect();
    try { console.log('[copy-reports-auth] copied', JSON.stringify(await copyReportsAuth(src, pg))); }
    finally { await pg.close(); }
  })().catch(e => { console.error(e); process.exit(1); });
}
