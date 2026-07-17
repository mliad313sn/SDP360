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
// Count rows in one of the Foundation tables. The table name comes from the trusted
// ASSET_VIEWS config (never user input), but it is still validated against the known
// set before interpolation so it can never become an injection vector if a future caller
// passes a variable. Dual-backend: pg fork is async, every caller MUST await it.
const _ASSET_TABLES = new Set(['assets', 'asset_memory', 'asset_logical_drives', 'asset_monitors', 'software_licenses']);
function _assertTable(table) {
  if (!_ASSET_TABLES.has(table)) throw new Error(`countRows: unknown table "${table}" — not an Assets Foundation table`);
  return table;
}
function countRows(table) {
  if (ASSETS_BACKEND === 'postgres') return _countRowsPg(table);
  const db = getDB();
  return db.prepare(`SELECT COUNT(*) AS n FROM ${_assertTable(table)}`).get().n;
}
async function _countRowsPg(table) {
  const h = pgHandle();
  return Number((await h.prepare(`SELECT COUNT(*) AS n FROM ${_assertTable(table)}`).get()).n);
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

// ---------------------------------------------------------------------------
// Hygiene readers (sub-project B, Task 0) — six exception kinds + a completeness
// summary. Purely additive: nothing above changes. Every fragment is the spec
// predicate VERBATIM (see docs/superpowers/specs/2026-07-17-assets-hygiene-design.md
// §2) — the counts are load-bearing, do not "tidy" them.
//
// Two invariants worth restating at the code:
//  - `ghost` requires a SUCCESSFUL prior scan (LIKE '%success%') AND >90d, while
//    `never_scanned` fires whenever the CURRENT status isn't a success. So a
//    failing-but-stale row is never_scanned ONLY — the two are disjoint.
//  - `days_since_scan` is TEXT → CAST(NULLIF(days_since_scan,'') AS INTEGER); the
//    NULLIF keeps pg's strict cast from 500-ing on '' (sqlite is lenient). The pg
//    fork carries the identical NULLIF — do not drop it.
// ---------------------------------------------------------------------------

// Ordered single source of truth. Routes + Excel + digest all read this map, so a
// kind is defined exactly once. `where` is a bare predicate over the `assets`
// columns (unqualified — the queries alias `assets AS a`, so unqualified names
// resolve to it); the shared whitelisted filters are ANDed in separately.
const HYGIENE_KINDS = {
  discovered:    { label: 'Discovered',                  where: "state = 'Discovered'" },
  never_scanned: { label: 'Never successfully scanned',  where: "last_successful_audit_time IS NULL OR last_successful_audit_time = '' OR last_audit_status IS NULL OR lower(last_audit_status) NOT LIKE '%success%'" },
  ghost:         { label: 'Ghost (was healthy, stale >90d)', where: "lower(last_audit_status) LIKE '%success%' AND CAST(NULLIF(days_since_scan,'') AS INTEGER) > 90" },
  no_owner:      { label: 'No owner',                    where: "(user_name IS NULL OR user_name = '') AND (department IS NULL OR department = '')" },
  no_age:        { label: 'No acquisition date',         where: "acquisition_date IS NULL OR acquisition_date = ''" },
  no_cost:       { label: 'No cost data',                where: "purchase_cost IS NULL OR purchase_cost IN ('0.00','0','')" },
};

// The kind's predicate ANDed with the SAME whitelisted filters getEnrichedAssets
// accepts (site/state/product_type/manufacturer/q) — parameter-bound, no interpolation.
// `_assetWhere` emits `a.`-qualified clauses, so the callers query `assets AS a`.
function _hygieneWhere(kind, filters) {
  const k = HYGIENE_KINDS[kind];
  if (!k) throw new Error(`getHygieneExceptions: unknown hygiene kind "${kind}"`);
  const { where, params } = _assetWhere(filters);   // ' AND a.site = ?' …  (or '')
  return { sql: `(${k.where})${where}`, params };
}

const _HYGIENE_EXC_COLS = 'a.asset_id, a.asset_name, a.product, a.product_type, a.manufacturer, a.state, a.site, a.serial_number, a.days_since_scan, a.last_audit_status, a.last_scan_source';

// The four completeness attributes, expressed as PRESENT-counts. Present = NOT
// the gap predicate, written as CASE WHEN <gap> THEN 0 ELSE 1 — the exact boolean
// negation, so Σ_site(present) + by_kind[gap] === total reconciles (the M-4 cross-check).
const _PRESENT_SELECT =
  `SUM(CASE WHEN (${HYGIENE_KINDS.no_cost.where})       THEN 0 ELSE 1 END) AS cost_present,
   SUM(CASE WHEN (${HYGIENE_KINDS.no_age.where})        THEN 0 ELSE 1 END) AS age_present,
   SUM(CASE WHEN (${HYGIENE_KINDS.no_owner.where})      THEN 0 ELSE 1 END) AS owner_present,
   SUM(CASE WHEN (${HYGIENE_KINDS.never_scanned.where}) THEN 0 ELSE 1 END) AS scan_present`;

// Scan-freshness buckets over CAST(NULLIF(days_since_scan,'') AS INTEGER). `never`
// is the never_scanned population; the rest bucket the successfully-scanned rows.
const _FRESHNESS_SELECT =
  `SUM(CASE WHEN (${HYGIENE_KINDS.never_scanned.where}) THEN 1 ELSE 0 END) AS never,
   SUM(CASE WHEN NOT (${HYGIENE_KINDS.never_scanned.where}) AND CAST(NULLIF(days_since_scan,'') AS INTEGER) > 90 THEN 1 ELSE 0 END) AS over90,
   SUM(CASE WHEN NOT (${HYGIENE_KINDS.never_scanned.where}) AND CAST(NULLIF(days_since_scan,'') AS INTEGER) >= 30 AND CAST(NULLIF(days_since_scan,'') AS INTEGER) <= 90 THEN 1 ELSE 0 END) AS d30_90,
   SUM(CASE WHEN NOT (${HYGIENE_KINDS.never_scanned.where}) AND CAST(NULLIF(days_since_scan,'') AS INTEGER) >= 7  AND CAST(NULLIF(days_since_scan,'') AS INTEGER) < 30 THEN 1 ELSE 0 END) AS d7_30,
   SUM(CASE WHEN NOT (${HYGIENE_KINDS.never_scanned.where}) AND CAST(NULLIF(days_since_scan,'') AS INTEGER) < 7  THEN 1 ELSE 0 END) AS under7`;

// pct helper: present/total → 1-decimal percent; total 0 → null (not 0, not NaN).
function _pct(present, total) { return total ? Math.round(1000 * present / total) / 10 : null; }

function _buildBySite(siteRows) {
  return siteRows.map(r => {
    const total = Number(r.total);
    const cost_present = Number(r.cost_present), age_present = Number(r.age_present),
          owner_present = Number(r.owner_present), scan_present = Number(r.scan_present);
    const cost_pct = _pct(cost_present, total), age_pct = _pct(age_present, total),
          owner_pct = _pct(owner_present, total), scan_pct = _pct(scan_present, total);
    const completeness = total
      ? Math.round(1000 * ((cost_present + age_present + owner_present + scan_present) / 4) / total) / 10
      : null;
    return { site: r.site, total, cost_present, age_present, owner_present, scan_present,
      cost_pct, age_pct, owner_pct, scan_pct, completeness };
  });
}

function getHygieneSummary(filters) {
  if (ASSETS_BACKEND === 'postgres') return _getHygieneSummaryPg(filters);
  const db = getDB();
  const { where, params } = _assetWhere(filters);         // ' AND a.…' (or '')
  const filt = `WHERE 1=1${where}`;
  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM assets a ${filt}`).get(...params).n);
  const by_kind = {};
  for (const kind of Object.keys(HYGIENE_KINDS)) {
    const w = _hygieneWhere(kind, filters);
    by_kind[kind] = Number(db.prepare(`SELECT COUNT(*) AS n FROM assets a WHERE ${w.sql}`).get(...w.params).n);
  }
  const siteRows = db.prepare(
    `SELECT COALESCE(a.site,'') AS site, COUNT(*) AS total, ${_PRESENT_SELECT} FROM assets a ${filt} GROUP BY a.site ORDER BY a.site`
  ).all(...params);
  const fr = db.prepare(`SELECT ${_FRESHNESS_SELECT} FROM assets a ${filt}`).get(...params);
  const scan_freshness = { never: Number(fr.never) || 0, over90: Number(fr.over90) || 0,
    d30_90: Number(fr.d30_90) || 0, d7_30: Number(fr.d7_30) || 0, under7: Number(fr.under7) || 0 };
  const stateRows = db.prepare(
    `SELECT COALESCE(a.state,'') AS state, COUNT(*) AS n FROM assets a ${filt} GROUP BY a.state`
  ).all(...params);
  const by_state = {};
  for (const r of stateRows) by_state[r.state] = Number(r.n);
  return { total, by_kind, by_site: _buildBySite(siteRows), scan_freshness, by_state };
}
async function _getHygieneSummaryPg(filters) {
  const h = pgHandle();
  const { where, params } = _assetWhere(filters);
  const filt = `WHERE 1=1${where}`;
  const total = Number((await h.prepare(`SELECT COUNT(*) AS n FROM assets a ${filt}`).get(...params)).n);
  const by_kind = {};
  for (const kind of Object.keys(HYGIENE_KINDS)) {
    const w = _hygieneWhere(kind, filters);
    by_kind[kind] = Number((await h.prepare(`SELECT COUNT(*) AS n FROM assets a WHERE ${w.sql}`).get(...w.params)).n);
  }
  const siteRows = await h.prepare(
    `SELECT COALESCE(a.site,'') AS site, COUNT(*) AS total, ${_PRESENT_SELECT} FROM assets a ${filt} GROUP BY a.site ORDER BY a.site`
  ).all(...params);
  const fr = await h.prepare(`SELECT ${_FRESHNESS_SELECT} FROM assets a ${filt}`).get(...params);
  const scan_freshness = { never: Number(fr.never) || 0, over90: Number(fr.over90) || 0,
    d30_90: Number(fr.d30_90) || 0, d7_30: Number(fr.d7_30) || 0, under7: Number(fr.under7) || 0 };
  const stateRows = await h.prepare(
    `SELECT COALESCE(a.state,'') AS state, COUNT(*) AS n FROM assets a ${filt} GROUP BY a.state`
  ).all(...params);
  const by_state = {};
  for (const r of stateRows) by_state[r.state] = Number(r.n);
  return { total, by_kind, by_site: _buildBySite(siteRows), scan_freshness, by_state };
}

function getHygieneExceptions(kind, filters) {
  if (ASSETS_BACKEND === 'postgres') return _getHygieneExceptionsPg(kind, filters);
  const db = getDB();
  const { sql, params } = _hygieneWhere(kind, filters);   // throws on unknown kind
  return db.prepare(
    `SELECT ${_HYGIENE_EXC_COLS} FROM assets a WHERE ${sql} ORDER BY a.site, a.asset_name`
  ).all(...params);
}
async function _getHygieneExceptionsPg(kind, filters) {
  const h = pgHandle();
  const { sql, params } = _hygieneWhere(kind, filters);   // throws on unknown kind
  return h.prepare(
    `SELECT ${_HYGIENE_EXC_COLS} FROM assets a WHERE ${sql} ORDER BY a.site, a.asset_name`
  ).all(...params);
}

if (ASSETS_BACKEND !== 'postgres') getDB();   // eager sqlite init at require, like tracker-db
module.exports = {
  getDB, initPgAssets, pgHandle, ASSETS_BACKEND, replaceTable, countRows,
  getEnrichedAssets, getAssetLookups, getAssetSummary,
  HYGIENE_KINDS, getHygieneSummary, getHygieneExceptions,
};
