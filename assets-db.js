'use strict';
const path = require('path'), fs = require('fs');
const DATA_DIR = process.env.SDP_DATA_DIR || path.join(__dirname, 'data');
const ASSETS_BACKEND = (process.env.ASSETS_BACKEND || 'sqlite').toLowerCase();
const SCHEMA = fs.readFileSync(path.join(__dirname, 'db', 'postgres', 'assets', '001_init.sql'), 'utf8');

let _db = null, _pg = null;
function getDB() {
  if (_db) return _db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const Database = require('better-sqlite3');
  _db = new Database(path.join(DATA_DIR, 'assets.db'));
  _db.pragma('journal_mode = WAL');
  _db.exec(SCHEMA);
  return _db;
}
async function initPgAssets() {
  const { makePgDb } = require('./services/pgDb');
  const url = process.env.PG_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('ASSETS_BACKEND=postgres but PG_URL/DATABASE_URL is not set');
  _pg = makePgDb(url); await _pg.connect(); await _pg.exec(SCHEMA); return _pg;
}
function pgHandle() {
  if (!_pg) throw new Error('pgDb not initialised — await initPgAssets() at boot');
  return _pg;
}

// Full-replace one table in a single transaction: DELETE everything, then batch-insert `rows`.
// The caller MUST fetch its data BEFORE calling this — a failed fetch never reaches here, so the
// table is never emptied on a fetch error. INSERT OR REPLACE (sqlite) / ON CONFLICT DO NOTHING (pg)
// guard against a duplicate PK WITHIN one fetch. Returns rows.length. Dispatched by ASSETS_BACKEND.
function replaceTable(table, cols, rows) {
  if (ASSETS_BACKEND === 'postgres') return _replaceTablePg(table, cols, rows);
  const db = getDB();
  const ph = cols.map(() => '?').join(', ');
  const insert = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${ph})`);
  const tx = db.transaction((rs) => {
    db.prepare(`DELETE FROM ${table}`).run();
    for (const m of rs) insert.run(...cols.map(c => m[c] ?? null));
  });
  tx(rows);
  return rows.length;
}
async function _replaceTablePg(table, cols, rows) {
  const h = pgHandle();
  const ph = cols.map(() => '?').join(', ');   // pgDb translates ? -> $N
  const insertSql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ON CONFLICT DO NOTHING`;
  return h.runTransaction(async () => {
    const del = h.prepare(`DELETE FROM ${table}`);
    const ins = h.prepare(insertSql);
    await del.run();
    for (const m of rows) await ins.run(...cols.map(c => m[c] ?? null));
    return rows.length;
  });
}
if (ASSETS_BACKEND !== 'postgres') getDB();   // eager sqlite init at require, like tracker-db
module.exports = { getDB, initPgAssets, pgHandle, ASSETS_BACKEND, replaceTable };
