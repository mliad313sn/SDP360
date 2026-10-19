'use strict';
// One-shot copy of inspection.db → PostgreSQL (Chunk 3 cutover). FK order:
// lookups (sites/areas/types/categories) → insp_inspections → children.
// Idempotent (upsert on PK, full non-PK refresh). Columns auto-discovered
// from the SOURCE sqlite via PRAGMA. Advances IDENTITY sequences.
//
// NOTE blobs: photos/signatures live on the FILESYSTEM (<DATA_DIR>/blobs/…)
// since 2026-06-21 — this copy moves only the DB rows (file_ref pointers ride
// along untouched); the blobs directory itself stays where it is. Legacy rows
// with inline base64 copy byte-faithfully. Model: copy-reports-auth.js.
//
//   PG_URL=postgres://sdp_app:...@localhost:5432/sdp_dashboard \
//     node tools/pg/copy-inspection.js  [path\to\inspection.db]
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = fs.readFileSync(path.join(__dirname, '../../db/postgres/inspection/001_init.sql'), 'utf8');

// [table, pkCols] in FK order (parents first).
const TABLES = [
  ['insp_sites',          ['code']],
  ['insp_areas',          ['code']],
  ['insp_types',          ['code']],
  ['insp_categories',     ['code']],
  ['insp_inspections',    ['id']],                            // TEXT PK (EM-IT-…)
  ['insp_findings',       ['id']],
  ['insp_actions',        ['id']],
  ['insp_action_updates', ['id']],
  ['insp_photos',         ['id']],
  ['insp_signatures',     ['inspection_id', 'signer_type']],  // composite PK
];
const IDENTITY_TABLES = ['insp_findings', 'insp_actions', 'insp_action_updates', 'insp_photos'];

function _upsertSql(table, cols, pk) {
  const ph = cols.map(() => '?').join(', ');
  const setCols = cols.filter(c => !pk.includes(c));
  const conflict = setCols.length
    ? `ON CONFLICT (${pk.join(',')}) DO UPDATE SET ${setCols.map(c => `${c}=EXCLUDED.${c}`).join(', ')}`
    : `ON CONFLICT (${pk.join(',')}) DO NOTHING`;
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ${conflict}`;
}

async function copyInspection(sqlitePath, pg) {
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

module.exports = { copyInspection, TABLES, IDENTITY_TABLES };

if (require.main === module) {
  (async () => {
    const { makePgDb } = require('../../services/pgDb');
    const url = process.env.PG_URL || process.env.DATABASE_URL;
    if (!url) { console.error('Set PG_URL or DATABASE_URL'); process.exit(2); }
    const src = process.argv[2] || path.join(__dirname, '../../data/inspection.db');
    if (!fs.existsSync(src)) { console.error('inspection.db not found at ' + src); process.exit(2); }
    const pg = makePgDb(url); await pg.connect();
    try { console.log('[copy-inspection] copied', JSON.stringify(await copyInspection(src, pg))); }
    finally { await pg.close(); }
  })().catch(e => { console.error(e); process.exit(1); });
}
