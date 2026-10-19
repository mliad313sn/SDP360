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
  ['software', [
    'software_id','software_name','manufacturer','licensed_installations','installations',
    'installations_allowed','available_for_allocation','allocated_to_downgrades','purchased',
    'allocated','purchased_cal','compliance_type','software_category','software_type',
  ], ['software_id']],
  // ── IRREPLACEABLE capture tables — append-only / point-in-time. Unlike the 6
  // AP-synced tables above, these CANNOT be rebuilt by a re-sync, so the cutover
  // MUST copy them or the effort/reconcile history is lost forever. ────────────
  ['asset_effort_history', [
    'snapshot_date','site','total','no_cost','no_age','no_owner','never_scanned',
    'no_asset_tag','discovered','ghost','cost_pct','age_pct','owner_pct','scan_pct',
    'tag_pct','enrolled_pct','effort_score',
  ], ['snapshot_date','site']],
  ['asset_reconcile_history', [
    'snapshot_date','gaps_open','gaps_decided','sites_touched','ous_touched',
    'retirement_candidates','retirement_applicable','sources_present','by_site_json','captured_by',
  ], ['snapshot_date']],
  ['asset_reconcile_decisions', ['device_key','decision','reason','decided_by','decided_at'], ['device_key']],
  ['asset_external_devices', [
    'source','device_key','device_name','dns_name','os','os_version','last_seen',
    'enabled','join_type','ou_dn','model','raw_json','import_id','imported_at',
  ], ['source','device_key']],
  // asset_import_log has NO primary key (append-only log) — copied only into an
  // empty target (re-run guard below) so a second run can't duplicate the log.
  ['asset_import_log', ['source','imported_at','row_count','dated_count','imported_by'], []],
];

function _upsertSql(table, cols, pk) {
  const ph = cols.map(() => '?').join(', ');
  let conflict = '';
  if (pk && pk.length) {   // no PK (append-only log) → plain INSERT, no ON CONFLICT
    const setCols = cols.filter(c => !pk.includes(c));
    conflict = setCols.length
      ? `ON CONFLICT (${pk.join(',')}) DO UPDATE SET ${setCols.map(c => `${c}=EXCLUDED.${c}`).join(', ')}`
      : `ON CONFLICT (${pk.join(',')}) DO NOTHING`;
  }
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ${conflict}`.trim();
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
        // Append-only tables with NO PK aren't idempotent — copy them only into
        // an EMPTY target so a second run can't duplicate the log.
        if (rows.length && (!pk || pk.length === 0)) {
          const ex = await pg.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
          if (ex && Number(ex.n) > 0) {
            counts[table] = { copied: 0, skipped: rows.length, note: 'target not empty' };
            console.warn(`[copy-assets] ${table}: target already has ${ex.n} row(s) — skipped (append-only re-run guard)`);
            continue;
          }
        }
        const sql = _upsertSql(table, cols, pk);
        const ins = pg.prepare(sql);
        let copied = 0, skipped = 0;
        for (const r of rows) {
          // A row with a NULL/empty primary key can't be inserted (PG rejects
          // the NOT-NULL PK) and would abort the WHOLE transaction — one
          // malformed AP-export row must not block the entire cutover. Skip it
          // and log the count instead.
          if (pk.some(k => r[k] === null || r[k] === undefined || r[k] === '')) { skipped++; continue; }
          await ins.run(...cols.map(c => r[c]));
          copied++;
        }
        counts[table] = { copied, skipped };
        if (skipped) console.warn(`[copy-assets] ${table}: skipped ${skipped} row(s) with a NULL/empty primary key`);
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
    // Operator convenience: this is the one copy-* script run BY HAND from the
    // app root during the final cutover. If PG_URL isn't already exported in the
    // shell, load it from the app's .env (same file server.js reads) so
    // `node tools\pg\copy-assets.js` "just works" from C:\Apps\SDP-Dashboard.
    // Never overrides an explicitly-set env var; silent no-op if .env/dotenv absent.
    if (!process.env.PG_URL && !process.env.DATABASE_URL) {
      try { require('dotenv').config({ path: path.join(__dirname, '../../.env') }); } catch (_) {}
    }
    const url = process.env.PG_URL || process.env.DATABASE_URL;
    if (!url) { console.error('Set PG_URL or DATABASE_URL (or run from the app root where .env lives)'); process.exit(2); }
    const src = process.argv[2] || path.join(__dirname, '../../data/assets.db');
    if (!fs.existsSync(src)) { console.error('assets.db not found at ' + src); process.exit(2); }
    const pg = makePgDb(url); await pg.connect();
    try {
      const counts = await copyAssets(src, pg);
      console.log('[copy-assets] copied', JSON.stringify(counts));
    } finally { await pg.close(); }
  })().catch(e => { console.error(e); process.exit(1); });
}
