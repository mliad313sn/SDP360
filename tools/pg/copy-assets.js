'use strict';
// One-shot data copy: assets.db (SQLite) -> PostgreSQL, idempotent (upsert on PK).
// Applies db/postgres/assets/001_init.sql first, then copies all 5 Foundation asset
// tables preserving every TEXT value verbatim (purchase_cost / cost stay raw strings).
// No IDENTITY sequences to advance — every PK is a natural key from the AP export.
//
// Usage (CLI):  PG_URL=postgres://postgres:pass@localhost:5432/sdp_dashboard \
//               node tools/pg/copy-assets.js [path/to/assets.db]
// Programmatic: await copyAssets(sqlitePath, connectedPgDb)
const fs   = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = fs.readFileSync(path.join(__dirname, '../../db/postgres/assets/001_init.sql'), 'utf8');

// table -> { cols: [...], pk: [...] }. All 5 Foundation tables; column order matches
// db/postgres/assets/001_init.sql. asset_monitors carries a composite PK.
const TABLES = [
  ['assets', [
    'asset_id','asset_name','product','product_type','manufacturer','state','serial_number',
    'barcode','site','site_id','purchase_cost','acquisition_date','warranty_expiry','user_name',
    'department','last_successful_audit_time','last_audit_status','days_since_scan',
    'last_scan_source','created_time',
  ], ['asset_id']],
  ['asset_memory', ['memory_module_id','workstation_id','capacity_gb','socket_label','module_tag'], ['memory_module_id']],
  ['asset_logical_drives', ['drive_id','workstation_id','drive_letter','capacity_gb','free_gb','free_pct','file_type'], ['drive_id']],
  ['asset_monitors', ['workstation_id','monitor_id','monitor_type','manufacturer','serial_number'], ['workstation_id','monitor_id']],
  ['software_licenses', ['license_id','license_name','license_type','license_state','expiry_date','cost','site','vendor','software_id'], ['license_id']],
];

function _upsertSql(table, cols, pk) {
  const ph = cols.map(() => '?').join(', ');
  const setCols = cols.filter(c => !pk.includes(c));
  const setClause = setCols.length
    ? setCols.map(c => `${c}=EXCLUDED.${c}`).join(', ')
    : null;
  const conflict = setClause
    ? `ON CONFLICT (${pk.join(',')}) DO UPDATE SET ${setClause}`
    : `ON CONFLICT (${pk.join(',')}) DO NOTHING`;
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ${conflict}`;
}

// Copy from an open better-sqlite3 handle into a connected pgDb. Returns row counts.
async function copyAssets(sqlitePath, pg) {
  const sdb = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const counts = {};
  try {
    await pg.exec(SCHEMA);
    await pg.runTransaction(async () => {
      for (const [table, cols, pk] of TABLES) {
        let rows = [];
        try { rows = sdb.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all(); }
        catch (_) { rows = []; }                 // table absent in this sqlite snapshot → skip
        const sql = _upsertSql(table, cols, pk);
        const ins = pg.prepare(sql);
        for (const r of rows) await ins.run(...cols.map(c => r[c]));
        counts[table] = rows.length;
      }
    });
  } finally { sdb.close(); }
  return counts;
}

module.exports = { copyAssets, _upsertSql, TABLES };

// CLI
if (require.main === module) {
  (async () => {
    const { makePgDb } = require('../../services/pgDb');
    const url = process.env.PG_URL || process.env.DATABASE_URL;
    if (!url) { console.error('Set PG_URL or DATABASE_URL'); process.exit(2); }
    const src = process.argv[2] || path.join(__dirname, '../../data/assets.db');
    if (!fs.existsSync(src)) { console.error('assets.db not found at ' + src); process.exit(2); }
    const pg = makePgDb(url); await pg.connect();
    try {
      const counts = await copyAssets(src, pg);
      console.log('[copy-assets] copied', JSON.stringify(counts));
    } finally { await pg.close(); }
  })().catch(e => { console.error(e); process.exit(1); });
}
