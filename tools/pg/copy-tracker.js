'use strict';
// One-shot data copy: tracker.db (SQLite) -> PostgreSQL, idempotent (upsert on PK).
// Applies db/postgres/tracker/001_init.sql first, copies all tracker tables
// (legacy + v2) preserving *_json TEXT verbatim, then advances the IDENTITY
// sequences past the copied ids so future inserts don't collide.
//
// Usage (CLI):  PG_URL=postgres://postgres:pass@localhost:5432/sdp_dashboard \
//               node tools/pg/copy-tracker.js [path/to/tracker.db]
// Programmatic: await copyTracker(sqlitePath, connectedPgDb)
const fs   = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = fs.readFileSync(path.join(__dirname, '../../db/postgres/tracker/001_init.sql'), 'utf8');

// table -> { cols: [...], pk: [...] }. Copy order respects FK (years→pillars→activities→v2).
const TABLES = [
  ['tracker_config',      ['id','activities_json','pillar_weights_json','active_sites_json','years_json','current_month'], ['id']],
  ['tracker_years',       ['year','active'], ['year']],
  ['tracker_pillars',     ['id','year','code','name','weight','display_order','active'], ['id']],
  ['tracker_activities',  ['id','pillar_id','code','name','kpi_type','start_month','end_month','display_order','active','legacy_id','legacy_num','weight','shared'], ['id']],
  ['tracker_targets',     ['site','activity_ix','target','active','activity_id'], ['site','activity_ix']],
  ['tracker_inputs',      ['year','site','activity_ix','months_json','activity_id'], ['year','site','activity_ix']],
  ['tracker_targets_v2',  ['year','site','activity_id','target','active'], ['year','site','activity_id']],
  ['tracker_inputs_v2',   ['year','site','activity_id','months_json'], ['year','site','activity_id']],
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
async function copyTracker(sqlitePath, pg) {
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
      // Advance IDENTITY sequences past copied ids (only for tables with an `id`).
      for (const t of ['tracker_pillars', 'tracker_activities']) {
        await pg.exec(
          `SELECT setval(pg_get_serial_sequence('${t}','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM ${t}), 1))`);
      }
    });
  } finally { sdb.close(); }
  return counts;
}

module.exports = { copyTracker, _upsertSql, TABLES };

// CLI
if (require.main === module) {
  (async () => {
    const { makePgDb } = require('../../services/pgDb');
    const url = process.env.PG_URL || process.env.DATABASE_URL;
    if (!url) { console.error('Set PG_URL or DATABASE_URL'); process.exit(2); }
    const src = process.argv[2] || path.join(__dirname, '../../data/tracker.db');
    if (!fs.existsSync(src)) { console.error('tracker.db not found at ' + src); process.exit(2); }
    const pg = makePgDb(url); await pg.connect();
    try {
      const counts = await copyTracker(src, pg);
      console.log('[copy-tracker] copied', JSON.stringify(counts));
    } finally { await pg.close(); }
  })().catch(e => { console.error(e); process.exit(1); });
}
