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
// ---------------------------------------------------------------------------
// Read side (Task 3) — enriched assets + lookups + summary. Every reader is
// dual-backend: the PG fork is async and every caller must await it.
// ---------------------------------------------------------------------------

// Whitelisted filters ONLY. An unknown key is ignored; a value is NEVER
// interpolated into SQL — it always rides as a bound parameter.
const _EXACT_FILTERS = ['site', 'state', 'product_type', 'manufacturer'];

// Build the WHERE clause fragments + params from a whitelisted filter object.
function _assetWhere(filters) {
  const clauses = [], params = [];
  const f = filters || {};
  for (const key of _EXACT_FILTERS) {
    if (f[key] != null && f[key] !== '') { clauses.push(`a.${key} = ?`); params.push(f[key]); }
  }
  if (f.q != null && f.q !== '') {
    clauses.push('(a.asset_name LIKE ? OR a.serial_number LIKE ?)');
    const like = `%${f.q}%`; params.push(like, like);
  }
  return { where: clauses.length ? ' AND ' + clauses.join(' AND ') : '', params };
}

const _ENRICHED_SELECT = `SELECT a.*,
  (SELECT COALESCE(SUM(CAST(capacity_gb AS REAL)),0) FROM asset_memory m WHERE m.workstation_id=a.asset_id) AS ram_total_gb,
  (SELECT capacity_gb FROM asset_logical_drives d WHERE d.workstation_id=a.asset_id AND d.drive_letter='C:' LIMIT 1) AS system_disk_gb,
  (SELECT free_pct    FROM asset_logical_drives d WHERE d.workstation_id=a.asset_id AND d.drive_letter='C:' LIMIT 1) AS system_disk_free_pct,
  (SELECT COUNT(*) FROM asset_monitors mo WHERE mo.workstation_id=a.asset_id) AS monitor_count
FROM assets a
WHERE 1=1`;

// Coerce the numeric fields the callers rely on; leave purchase_cost RAW.
// The AP export delivers `Free Space (%)` as a formatted string like '94%'
// (trailing percent sign, sometimes thousands commas) — a bare Number('94%')
// is NaN, so every real machine's free-pct silently became NaN→null on the
// wire. Strip %/comma/space before coercing, and map any residual NaN → null.
function _coerceEnriched(r) {
  r.ram_total_gb = Number(r.ram_total_gb) || 0;
  const fp = (r.system_disk_free_pct == null || r.system_disk_free_pct === '')
    ? null : Number(String(r.system_disk_free_pct).replace(/[%,\s]/g, ''));
  r.system_disk_free_pct = (fp == null || Number.isNaN(fp)) ? null : fp;
  r.monitor_count = Number(r.monitor_count) || 0;
  return r;
}

function getEnrichedAssets(filters) {
  if (ASSETS_BACKEND === 'postgres') return _getEnrichedAssetsPg(filters);
  const db = getDB();
  const { where, params } = _assetWhere(filters);
  const sql = `${_ENRICHED_SELECT}${where} ORDER BY a.site, a.asset_name`;
  return db.prepare(sql).all(...params).map(_coerceEnriched);
}
async function _getEnrichedAssetsPg(filters) {
  const h = pgHandle();
  const { where, params } = _assetWhere(filters);
  const sql = `${_ENRICHED_SELECT}${where} ORDER BY a.site, a.asset_name`;
  const rows = await h.prepare(sql).all(...params);
  return rows.map(_coerceEnriched);
}

function getAssetLookups() {
  if (ASSETS_BACKEND === 'postgres') return _getAssetLookupsPg();
  const db = getDB();
  const distinct = (col) => db.prepare(
    `SELECT DISTINCT ${col} AS v FROM assets WHERE ${col} IS NOT NULL AND ${col} <> '' ORDER BY ${col}`
  ).all().map(r => r.v);
  return {
    sites: distinct('site'),
    states: distinct('state'),
    product_types: distinct('product_type'),
    manufacturers: distinct('manufacturer'),
  };
}
async function _getAssetLookupsPg() {
  const h = pgHandle();
  const distinct = async (col) => (await h.prepare(
    `SELECT DISTINCT ${col} AS v FROM assets WHERE ${col} IS NOT NULL AND ${col} <> '' ORDER BY ${col}`
  ).all()).map(r => r.v);
  return {
    sites: await distinct('site'),
    states: await distinct('state'),
    product_types: await distinct('product_type'),
    manufacturers: await distinct('manufacturer'),
  };
}

function getAssetSummary() {
  if (ASSETS_BACKEND === 'postgres') return _getAssetSummaryPg();
  const db = getDB();
  const total = db.prepare('SELECT COUNT(*) AS n FROM assets').get().n;
  const rows = db.prepare("SELECT COALESCE(state,'') AS state, COUNT(*) AS n FROM assets GROUP BY state").all();
  const by_state = {};
  for (const r of rows) by_state[r.state] = r.n;
  return { total, by_state };
}
async function _getAssetSummaryPg() {
  const h = pgHandle();
  const total = (await h.prepare('SELECT COUNT(*) AS n FROM assets').get()).n;
  const rows = await h.prepare("SELECT COALESCE(state,'') AS state, COUNT(*) AS n FROM assets GROUP BY state").all();
  const by_state = {};
  for (const r of rows) by_state[r.state] = Number(r.n);
  return { total: Number(total), by_state };
}

if (ASSETS_BACKEND !== 'postgres') getDB();   // eager sqlite init at require, like tracker-db
module.exports = {
  getDB, initPgAssets, pgHandle, ASSETS_BACKEND, replaceTable,
  getEnrichedAssets, getAssetLookups, getAssetSummary,
};
