'use strict';
const path = require('path'), fs = require('fs');
const money = require('./services/money');   // ONE money parser for all finance sums
const DATA_DIR = process.env.SDP_DATA_DIR || path.join(__dirname, 'data');
const ASSETS_BACKEND = (process.env.ASSETS_BACKEND || 'sqlite').toLowerCase();
const SCHEMA = fs.readFileSync(path.join(__dirname, 'db', 'postgres', 'assets', '001_init.sql'), 'utf8');

// Additive columns landed by Task 1 (Licence/Finance). The shared 001_init.sql CREATE
// statements carry these, so fresh DBs get them from CREATE. For an EXISTING table the
// CREATE-IF-NOT-EXISTS is a no-op, so we ALTER-add any missing column JS-side, backend-
// branched — NEVER an ALTER in the shared SQL (sqlite has no ALTER … ADD COLUMN IF NOT
// EXISTS, and the shared .exec would then throw and crash every boot/test). All TEXT.
const _ADDED_COLS = {
  assets: ['asset_tag', 'total_cost_of_ownership', 'operational_cost',
           'current_book_value', 'months_since_acquisition'],
  software_licenses: ['license_option', 'installations_allowed', 'acquisition_date',
                      'organization_license'],
};

let _db = null, _pg = null;
function getDB() {
  if (_db) return _db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const Database = require('better-sqlite3');
  _db = new Database(path.join(DATA_DIR, 'assets.db'));
  _db.pragma('journal_mode = WAL');
  _db.exec(SCHEMA);
  // Idempotent additive migration for pre-existing tables (sqlite has no IF NOT EXISTS on
  // ADD COLUMN, so PRAGMA-check the present columns and plain-ALTER only the missing ones).
  for (const [table, cols] of Object.entries(_ADDED_COLS)) {
    const present = new Set(_db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name));
    for (const c of cols) {
      if (present.has(c)) continue;
      try { _db.exec(`ALTER TABLE ${table} ADD COLUMN ${c} TEXT`); } catch (_) { /* defensive: already added */ }
    }
  }
  return _db;
}
async function initPgAssets() {
  const { makePgDb } = require('./services/pgDb');
  const url = process.env.PG_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('ASSETS_BACKEND=postgres but PG_URL/DATABASE_URL is not set');
  _pg = makePgDb(url); await _pg.connect(); await _pg.exec(SCHEMA);
  // pg supports ADD COLUMN IF NOT EXISTS — idempotent additive migration for existing tables.
  for (const [table, cols] of Object.entries(_ADDED_COLS)) {
    for (const c of cols) await _pg.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${c} TEXT`);
  }
  return _pg;
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
const _ASSET_TABLES = new Set(['assets', 'asset_memory', 'asset_logical_drives', 'asset_monitors', 'software_licenses', 'software', 'asset_effort_history', 'asset_first_seen']);
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

// Asset-class coverage — [{ product_type, count }] grouped by product_type, count desc.
// COALESCE(NULLIF(product_type,''),'Unknown') folds BOTH null and '' into 'Unknown'.
// Mirrors getAssetSummary's ASSETS_BACKEND fork (sqlite sync + pg async). Feeds the
// Roadmap Obj-2 platform evidence composer (services/roadmapEvidence.js).
const _COUNTS_BY_TYPE_SQL =
  "SELECT COALESCE(NULLIF(product_type,''),'Unknown') AS product_type, COUNT(*) AS count " +
  "FROM assets GROUP BY COALESCE(NULLIF(product_type,''),'Unknown') ORDER BY count DESC";
function getAssetCountsByType() {
  if (ASSETS_BACKEND === 'postgres') return _getAssetCountsByTypePg();
  const db = getDB();
  return db.prepare(_COUNTS_BY_TYPE_SQL).all().map(r => ({ product_type: r.product_type, count: Number(r.count) }));
}
async function _getAssetCountsByTypePg() {
  const h = pgHandle();
  const rows = await h.prepare(_COUNTS_BY_TYPE_SQL).all();
  return rows.map(r => ({ product_type: r.product_type, count: Number(r.count) }));
}

// ---------------------------------------------------------------------------
// Hygiene readers (sub-project B, Task 0) — six exception kinds + a completeness
// summary. Purely additive: nothing above changes. Every fragment is the spec
// predicate VERBATIM (see docs/superpowers/specs/2026-07-17-assets-hygiene-design.md
// §2) — the counts are load-bearing, do not "tidy" them.
//
// Two invariants worth restating at the code:
//  - `ghost` is EXACTLY `NOT(never_scanned) AND >90d` — it reuses the very same
//    never_scanned predicate string (single-sourced in `_NEVER_SCANNED_WHERE`)
//    that the `over90` freshness bucket negates. So `by_kind.ghost` and
//    `scan_freshness.over90` are the SAME expression and reconcile on all data,
//    and a contradictory row (status='Success' but no success-time) lands in
//    never_scanned ONLY — never both. The two remain disjoint.
//  - `days_since_scan` is TEXT → CAST(NULLIF(days_since_scan,'') AS INTEGER); the
//    NULLIF keeps pg's strict cast from 500-ing on '' (sqlite is lenient). The pg
//    fork carries the identical NULLIF — do not drop it.
// ---------------------------------------------------------------------------

// The never_scanned predicate, single-sourced: `never_scanned.where`, `ghost.where`
// (via NOT(...)), and the `over90` freshness bucket (via NOT(...)) all interpolate
// this ONE string, so ghost === over90 by construction.
const _NEVER_SCANNED_WHERE = "last_successful_audit_time IS NULL OR last_successful_audit_time = '' OR last_audit_status IS NULL OR lower(last_audit_status) NOT LIKE '%success%'";

// Ordered single source of truth. Routes + Excel + digest all read this map, so a
// kind is defined exactly once. `where` is a bare predicate over the `assets`
// columns (unqualified — the queries alias `assets AS a`, so unqualified names
// resolve to it); the shared whitelisted filters are ANDed in separately.
const HYGIENE_KINDS = {
  discovered:    { label: 'Discovered',                  where: "state = 'Discovered'" },
  never_scanned: { label: 'Never successfully scanned',  where: _NEVER_SCANNED_WHERE },
  ghost:         { label: 'Ghost (was healthy, stale >90d)', where: `NOT (${_NEVER_SCANNED_WHERE}) AND CAST(NULLIF(days_since_scan,'') AS INTEGER) > 90` },
  no_owner:      { label: 'No owner',                    where: "(user_name IS NULL OR user_name = '') AND (department IS NULL OR department = '')" },
  no_age:        { label: 'No acquisition date',         where: "acquisition_date IS NULL OR acquisition_date = ''" },
  no_cost:       { label: 'No cost data',                where: "purchase_cost IS NULL OR purchase_cost IN ('0.00','0','')" },
  // Task 4 enrichment (ITAM training deck) — purely additive worklists. NOT completeness
  // gaps → deliberately absent from _PRESENT_SELECT/_FRESHNESS_SELECT so the shipped B
  // completeness numbers stay pinned. They flow into summary/routes/export/digest via the
  // Object.keys(HYGIENE_KINDS) iteration alone.
  no_asset_tag:        { label: 'No asset tag / QR',           where: "(asset_tag IS NULL OR asset_tag='') AND (barcode IS NULL OR barcode='')" },
  lifecycle_exception: { label: 'In repair / expired / lost',  where: "state IN ('In Repair','Expired','Lost/Stolen','Lost','Stolen')" },
};

// ─── Asset engagement worklists (2026-09-18) ────────────────────────────────
// Deliberately NOT HYGIENE_KINDS.no_owner / no_cost / no_age: those do not trim
// and have no state filter. No SQL CAST on the TEXT columns — TRIM + IN only.
const FOLLOWUP_ACTIVE_STATES = "state IN ('In Use','In Store','In Repair')";
// Not assigned to a user, in any active state (In Store included: at some sites most
// deployed kit is still recorded In Store, and that is exactly what must be fixed).
const FOLLOWUP_UNASSIGNED = `(${FOLLOWUP_ACTIVE_STATES}) AND TRIM(COALESCE(user_name,'')) = ''`;
const FOLLOWUP_NO_COST = `(${FOLLOWUP_ACTIVE_STATES}) AND (purchase_cost IS NULL OR TRIM(purchase_cost) IN ('','0','0.00'))`;
const FOLLOWUP_NO_DATE = `(${FOLLOWUP_ACTIVE_STATES}) AND (acquisition_date IS NULL OR TRIM(acquisition_date) = '')`;

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

// ─── Hardware-health worklist readers (sub-project D, Task 0) ──────────────
// Four count-based worklists over already-synced data: low RAM · full disk ·
// refresh-due · no real monitor. NO money is ever selected or summed here.
//
// The RAW `monitor_count` (COUNT(asset_monitors)) OVER-COUNTS — AP records
// cameras + virtual displays as monitors (`Intel(R) AVStream Camera`,
// `Integrated Webcam`, `HyperVMonitor`, `Parallels Vu`, `No Monitor`). The
// trustworthy `real_monitor_count` applies a `monitor_type` DENYLIST. Two
// load-bearing guards in that chain:
//  - the SPACE in `%no monitor%` is required — a bare `%monitor%` would exclude
//    every REAL monitor.
//  - the `<> ''` is required — `'' NOT LIKE '%camera%'` is TRUE, so an empty
//    monitor_type would wrongly count as a real monitor.
// `no_real_monitor` is SCOPED to workstation-type devices (laptop/desktop/…)
// so headless-by-design servers / network gear / VMs / phones don't flood it.
//
// The RAM / disk-free / months columns are TEXT (free-pct may carry `'%'`), so
// every threshold is computed IN JS via `_toNum` (strip %/comma/space → Number|
// null) — NO SQL CAST on the raw text (the '94%' free-pct would NaN a bare CAST
// and pg's strict cast would 500 on it).
const HARDWARE_KINDS = {
  low_ram:         { label: 'Low RAM (<8 GB)' },
  full_disk:       { label: 'Full system disk (<10% free)' },
  refresh_due:     { label: 'Refresh due (past replacement cycle)' },
  no_real_monitor: { label: 'No real monitor (workstation)' },
};

// The real-monitor denylist subquery — shared by summary + exceptions. The
// LIKE chain is the load-bearing part; keep it byte-identical on both backends.
const _REAL_MONITOR_SUBQ =
  `(SELECT COUNT(*) FROM asset_monitors mo WHERE mo.workstation_id = a.asset_id
      AND mo.monitor_type IS NOT NULL AND mo.monitor_type <> ''
      AND lower(mo.monitor_type) NOT LIKE '%camera%'
      AND lower(mo.monitor_type) NOT LIKE '%webcam%'
      AND lower(mo.monitor_type) NOT LIKE '%hypervmonitor%'
      AND lower(mo.monitor_type) NOT LIKE '%parallels%'
      AND lower(mo.monitor_type) NOT LIKE '%no monitor%') AS real_monitor_count`;

// Explicit NO-MONEY column list (I1) — NEVER `a.*` (it carries purchase_cost /
// current_book_value → money leak). Identity + the 3 computed health subqueries.
const _HARDWARE_EXC_COLS = `a.asset_id, a.asset_name, a.product, a.product_type,
  a.manufacturer, a.state, a.site, a.serial_number, a.months_since_acquisition,
  (SELECT COALESCE(SUM(CAST(capacity_gb AS REAL)),0) FROM asset_memory m WHERE m.workstation_id = a.asset_id) AS ram_total_gb,
  (SELECT free_pct FROM asset_logical_drives d WHERE d.workstation_id = a.asset_id AND d.drive_letter = 'C:' LIMIT 1) AS system_disk_free_pct,
  ${_REAL_MONITOR_SUBQ}`;

// Strip %/comma/space → Number, or null when empty/non-numeric (mirrors
// _coerceEnriched). Used for the RAM + free-pct TEXT columns.
function _toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[%,\s]/g, ''));
  return Number.isNaN(n) ? null : n;
}

const _WORKSTATION_TYPE = /laptop|desktop|computer|workstation|notebook/i;

// Coerce the three computed health fields to numbers on a returned row (the AP
// free-pct arrives as '5%' etc.). Identity columns are untouched; no money is
// present to begin with (the SELECT never asked for it).
function _coerceHardwareRow(r) {
  r.ram_total_gb = Number(r.ram_total_gb) || 0;
  r.system_disk_free_pct = _toNum(r.system_disk_free_pct);
  r.real_monitor_count = Number(r.real_monitor_count) || 0;
  return r;
}

// Per-row flags for each hardware kind. Thresholds computed in JS on the raw
// TEXT columns. `real_monitor_count` arrives from the denylist subquery.
function _hardwareFlags(r) {
  const ram = _toNum(r.ram_total_gb);
  const free = _toNum(r.system_disk_free_pct);
  const months = parseInt(r.months_since_acquisition, 10);
  const real = Number(r.real_monitor_count);
  return {
    low_ram: ram != null && ram > 0 && ram < 8,
    // keep the `!= null` guard — `null < 10` coerces TRUE, do NOT simplify.
    full_disk: free != null && free < 10,
    refresh_due: Number.isFinite(months) && months >= _refreshCycleMonths(r.product_type),
    no_real_monitor: _WORKSTATION_TYPE.test(String(r.product_type || '')) && real === 0,
  };
}

// SHARED pure pass — both backends hand it the same rows → parity by
// construction. Tallies by_kind + by_site + a monitors block; the rows carry NO
// money (the SELECT never asked for it).
function _aggregateHardware(rows) {
  const KINDS = Object.keys(HARDWARE_KINDS);
  const by_kind = Object.fromEntries(KINDS.map(k => [k, 0]));
  const acc = new Map();   // site -> {total, <kind>...}
  let realSum = 0, withReal = 0;
  for (const r of rows) {
    const f = _hardwareFlags(r);
    const site = r.site == null ? '' : String(r.site);
    if (!acc.has(site)) acc.set(site, Object.assign({ site, total: 0 }, ...KINDS.map(k => ({ [k]: 0 }))));
    const a = acc.get(site);
    a.total++;
    for (const k of KINDS) if (f[k]) { by_kind[k]++; a[k]++; }
    const real = Number(r.real_monitor_count) || 0;
    realSum += real; if (real >= 1) withReal++;
  }
  const total = rows.length;
  const by_site = [...acc.keys()].sort().map(s => acc.get(s));
  const monitors = { with_real: withReal, avg_real: total ? Math.round(100 * realSum / total) / 100 : 0 };
  return { total, by_kind, by_site, monitors };
}

// Every row through the shared _HARDWARE_EXC_COLS SELECT + whitelisted filters.
function getHardwareHealthSummary(filters) {
  if (ASSETS_BACKEND === 'postgres') return _getHardwareHealthSummaryPg(filters);
  const db = getDB();
  const { where, params } = _assetWhere(filters);
  const rows = db.prepare(
    `SELECT ${_HARDWARE_EXC_COLS} FROM assets a WHERE 1=1${where} ORDER BY a.site, a.asset_name`
  ).all(...params).map(_coerceHardwareRow);
  return _aggregateHardware(rows);
}
async function _getHardwareHealthSummaryPg(filters) {
  const h = pgHandle();
  const { where, params } = _assetWhere(filters);
  const rows = (await h.prepare(
    `SELECT ${_HARDWARE_EXC_COLS} FROM assets a WHERE 1=1${where} ORDER BY a.site, a.asset_name`
  ).all(...params)).map(_coerceHardwareRow);
  return _aggregateHardware(rows);
}

function getHardwareHealthExceptions(kind, filters) {
  if (ASSETS_BACKEND === 'postgres') return _getHardwareHealthExceptionsPg(kind, filters);
  if (!HARDWARE_KINDS[kind]) throw new Error(`getHardwareHealthExceptions: unknown hardware kind "${kind}"`);
  const db = getDB();
  const { where, params } = _assetWhere(filters);
  const rows = db.prepare(
    `SELECT ${_HARDWARE_EXC_COLS} FROM assets a WHERE 1=1${where} ORDER BY a.site, a.asset_name`
  ).all(...params).map(_coerceHardwareRow);
  return rows.filter(r => _hardwareFlags(r)[kind]);
}
async function _getHardwareHealthExceptionsPg(kind, filters) {
  if (!HARDWARE_KINDS[kind]) throw new Error(`getHardwareHealthExceptions: unknown hardware kind "${kind}"`);
  const h = pgHandle();
  const { where, params } = _assetWhere(filters);
  const rows = (await h.prepare(
    `SELECT ${_HARDWARE_EXC_COLS} FROM assets a WHERE 1=1${where} ORDER BY a.site, a.asset_name`
  ).all(...params)).map(_coerceHardwareRow);
  return rows.filter(r => _hardwareFlags(r)[kind]);
}

// ─── Finance summary (Task 2) ──────────────────────────────────────────────
// Per-site asset value / book value / TCO / opex in USD (assets are XOF raw
// TEXT, multiplied by `rate`), % depreciated (rate-independent), and a
// refresh-due count (product-type replacement cycle). ALL money is summed in JS
// via money.parseAmount — the ONE parser — never a SQL SUM/CAST/REPLACE.
const _FINANCE_SELECT =
  'SELECT a.site, a.purchase_cost, a.current_book_value, a.total_cost_of_ownership, ' +
  'a.operational_cost, a.months_since_acquisition, a.product_type FROM assets a WHERE 1=1';

// Replacement cycle (months) by product type — refresh is due at/after cycle.
function _refreshCycleMonths(pt) {
  const s = String(pt || '').toLowerCase();
  if (/laptop|desktop|computer/.test(s)) return 36;
  if (/server|network|switch|firewall/.test(s)) return 60;
  if (/smartphone|phone|mobile/.test(s)) return 24;
  return 48;
}

// SHARED pure aggregator — both backends hand it the same rows, so parity is by
// construction. Groups by site, sums money via money.parseAmount (nulls skipped),
// applies `rate` ONCE to each asset-money total, derives rate-independent
// pct_depreciated (Σpurchase=0 → null) and a refresh-due count.
function _aggregateFinance(rows, rate) {
  const r = Number(rate);
  const R = Number.isFinite(r) ? r : 1;
  const acc = new Map();   // site -> {purchase,book,tco,opex,count,refresh_due}
  const fleet = { purchase: 0, book: 0, tco: 0, opex: 0, count: 0, refresh_due: 0 };
  const add = (a, row) => {
    a.count++;
    const p = money.parseAmount(row.purchase_cost); if (p != null) a.purchase += p;
    const b = money.parseAmount(row.current_book_value); if (b != null) a.book += b;
    const t = money.parseAmount(row.total_cost_of_ownership); if (t != null) a.tco += t;
    const o = money.parseAmount(row.operational_cost); if (o != null) a.opex += o;
    const mo = parseInt(row.months_since_acquisition, 10);
    if (Number.isFinite(mo) && mo >= _refreshCycleMonths(row.product_type)) a.refresh_due++;
  };
  for (const row of rows) {
    const site = row.site == null ? '' : String(row.site);
    if (!acc.has(site)) acc.set(site, { purchase: 0, book: 0, tco: 0, opex: 0, count: 0, refresh_due: 0 });
    add(acc.get(site), row);
    add(fleet, row);
  }
  const shape = (a, site) => ({
    site,
    asset_count: a.count,
    purchase_cost_usd: a.purchase * R,
    book_value_usd: a.book * R,
    tco_usd: a.tco * R,
    operational_cost_usd: a.opex * R,
    pct_depreciated: a.purchase > 0 ? 1 - a.book / a.purchase : null,
    refresh_due: a.refresh_due,
  });
  const by_site = [...acc.keys()].sort().map(site => shape(acc.get(site), site));
  return { by_site, fleet: shape(fleet, null) };
}

function getFinanceSummary(filters, rate = 1) {
  if (ASSETS_BACKEND === 'postgres') return _getFinanceSummaryPg(filters, rate);
  const db = getDB();
  const { where, params } = _assetWhere(filters);
  const rows = db.prepare(`${_FINANCE_SELECT}${where} ORDER BY a.site, a.asset_name`).all(...params);
  return _aggregateFinance(rows, rate);
}
async function _getFinanceSummaryPg(filters, rate = 1) {
  const h = pgHandle();
  const { where, params } = _assetWhere(filters);
  const rows = await h.prepare(`${_FINANCE_SELECT}${where} ORDER BY a.site, a.asset_name`).all(...params);
  return _aggregateFinance(rows, rate);
}

// ─── Depreciation reader (Task 1, Asset Depreciation) ──────────────────────
// Per-site COMPUTED book value (USD): each asset's current book value is derived
// by services/depreciation.js (method / useful-life / salvage resolved per
// product_type from the config), summed per site and ×rate. SDP's own Current
// Book Value rides alongside as a cross-check. Money is XOF raw TEXT parsed by
// the ONE money.parseAmount; `rate` applied ONCE to each money total. pct is
// rate-independent = 1 - Σcomputed/Σpurchase (M-5). A no-cost asset yields a
// null computed book (→ 0 contribution) but still counts in asset_count.
const _DEPREC_SELECT =
  'SELECT a.site, a.product_type, a.purchase_cost, a.acquisition_date, a.current_book_value ' +
  'FROM assets a WHERE 1=1';

const depreciation = require('./services/depreciation');

// Compute one asset's depreciation result from a resolved-per-type config.
function _computeAssetBook(row, config, asOf) {
  const eff = depreciation.resolveForType(config, row.product_type);
  const cost = money.parseAmount(row.purchase_cost);
  const salvage = cost != null ? cost * (eff.salvage_pct || 0) : 0;
  return depreciation.computeDepreciation({
    cost, salvage, method: eff.method, usefulLifeMonths: eff.useful_life_months,
    declinePercent: eff.declinePercent, acquisitionDate: row.acquisition_date, asOf,
  });
}

// SHARED pure aggregator — both backends hand it the same rows → parity by
// construction. Groups by site: Σ computed currentBookValue (null → 0), Σ SDP
// current_book_value (cross-check), Σ purchase (for pct), asset_count.
function _aggregateDepreciation(rows, { config, rate, asOf } = {}) {
  const r = Number(rate);
  const R = Number.isFinite(r) ? r : 1;
  const acc = new Map();   // site -> {computed,sdp,purchase,count}
  const fleet = { computed: 0, sdp: 0, purchase: 0, count: 0 };
  const add = (a, row) => {
    a.count++;
    const d = _computeAssetBook(row, config, asOf);
    if (d.currentBookValue != null && Number.isFinite(d.currentBookValue)) a.computed += d.currentBookValue;
    const b = money.parseAmount(row.current_book_value); if (b != null) a.sdp += b;
    const p = money.parseAmount(row.purchase_cost); if (p != null) a.purchase += p;
  };
  for (const row of rows) {
    const site = row.site == null ? '' : String(row.site);
    if (!acc.has(site)) acc.set(site, { computed: 0, sdp: 0, purchase: 0, count: 0 });
    add(acc.get(site), row);
    add(fleet, row);
  }
  const shape = (a, site) => ({
    site,
    asset_count: a.count,
    computed_book_value_usd: a.computed * R,
    sdp_book_value_usd: a.sdp * R,
    purchase_cost_usd: a.purchase * R,
    pct_depreciated: a.purchase > 0 ? 1 - a.computed / a.purchase : null,
  });
  const by_site = [...acc.keys()].sort().map(site => shape(acc.get(site), site));
  return { by_site, fleet: shape(fleet, null) };
}

function getAssetDepreciation(filters, opts = {}) {
  if (ASSETS_BACKEND === 'postgres') return _getAssetDepreciationPg(filters, opts);
  const db = getDB();
  const { where, params } = _assetWhere(filters);
  const rows = db.prepare(`${_DEPREC_SELECT}${where} ORDER BY a.site, a.asset_name`).all(...params);
  return _aggregateDepreciation(rows, opts);
}
async function _getAssetDepreciationPg(filters, opts = {}) {
  const h = pgHandle();
  const { where, params } = _assetWhere(filters);
  const rows = await h.prepare(`${_DEPREC_SELECT}${where} ORDER BY a.site, a.asset_name`).all(...params);
  return _aggregateDepreciation(rows, opts);
}

// SHARED — bucket each asset's schedule[].bookValue by calendar year across the
// whole fleet, sum, ×rate. Returns aligned {years, book_value_usd} (years sorted).
function _aggregateSchedule(rows, { config, rate, asOf } = {}) {
  const r = Number(rate);
  const R = Number.isFinite(r) ? r : 1;
  const byYear = new Map();   // year -> Σ bookValue (raw)
  for (const row of rows) {
    const d = _computeAssetBook(row, config, asOf);
    for (const s of (d.schedule || [])) {
      if (!Number.isFinite(s.bookValue)) continue;
      // Skip assets whose acquisition_date didn't parse into a real calendar year —
      // undated rows (all zero-cost in the AP data) otherwise emit spurious leading
      // year buckets 1..4 at $0 before the first real year on the fleet chart (review M2).
      if (!Number.isFinite(s.year) || s.year < 1990) continue;
      byYear.set(s.year, (byYear.get(s.year) || 0) + s.bookValue);
    }
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  return { years, book_value_usd: years.map(y => byYear.get(y) * R) };
}

function getDepreciationSchedule(filters, opts = {}) {
  if (ASSETS_BACKEND === 'postgres') return _getDepreciationSchedulePg(filters, opts);
  const db = getDB();
  const { where, params } = _assetWhere(filters);
  const rows = db.prepare(`${_DEPREC_SELECT}${where} ORDER BY a.site, a.asset_name`).all(...params);
  return _aggregateSchedule(rows, opts);
}
async function _getDepreciationSchedulePg(filters, opts = {}) {
  const h = pgHandle();
  const { where, params } = _assetWhere(filters);
  const rows = await h.prepare(`${_DEPREC_SELECT}${where} ORDER BY a.site, a.asset_name`).all(...params);
  return _aggregateSchedule(rows, opts);
}

// ─── Investment history + forecast readers (Investment tab) ────────────────
// Thin dual-backend readers that SELECT the columns and delegate to the PURE
// services/assetForecast.js builders (no math here). Assets are XOF raw TEXT (the
// builders convert via `rate`); licence cost is native USD. `_assetWhere` emits
// `a.`-qualified fragments so the assets FROM is aliased + seeded (WHERE 1=1);
// `_licenceWhere` emits its own ` WHERE …` and whitelists site/state/q only.
const AF = require('./services/assetForecast');

const _INVEST_HIST_ASSET_SELECT =
  'SELECT acquisition_date, purchase_cost FROM assets a WHERE 1=1';
const _INVEST_HIST_LIC_SELECT =
  'SELECT acquisition_date, cost FROM software_licenses';

function getInvestmentSummary(filters, { rate } = {}) {
  if (ASSETS_BACKEND === 'postgres') return _getInvestmentSummaryPg(filters, { rate });
  const db = getDB();
  const aw = _assetWhere(filters);
  const lw = _licenceWhere(filters);
  const aRows = db.prepare(`${_INVEST_HIST_ASSET_SELECT}${aw.where}`).all(...aw.params);
  const lRows = db.prepare(`${_INVEST_HIST_LIC_SELECT}${lw.where}`).all(...lw.params);
  return AF.buildInvestmentHistory(aRows, lRows, rate);
}
async function _getInvestmentSummaryPg(filters, { rate } = {}) {
  const h = pgHandle();
  const aw = _assetWhere(filters);
  const lw = _licenceWhere(filters);
  const aRows = await h.prepare(`${_INVEST_HIST_ASSET_SELECT}${aw.where}`).all(...aw.params);
  const lRows = await h.prepare(`${_INVEST_HIST_LIC_SELECT}${lw.where}`).all(...lw.params);
  return AF.buildInvestmentHistory(aRows, lRows, rate);
}

const _INVEST_FCST_ASSET_SELECT =
  'SELECT acquisition_date, purchase_cost, product_type FROM assets a WHERE 1=1';
const _INVEST_FCST_LIC_SELECT =
  'SELECT expiry_date, cost, license_option FROM software_licenses';

function getInvestmentForecast(filters, { config, rate, upliftPct, horizonYears, asOf } = {}) {
  if (ASSETS_BACKEND === 'postgres') return _getInvestmentForecastPg(filters, { config, rate, upliftPct, horizonYears, asOf });
  const db = getDB();
  const aw = _assetWhere(filters);
  const lw = _licenceWhere(filters);
  const aRows = db.prepare(`${_INVEST_FCST_ASSET_SELECT}${aw.where}`).all(...aw.params);
  const lRows = db.prepare(`${_INVEST_FCST_LIC_SELECT}${lw.where}`).all(...lw.params);
  return {
    hardware: AF.buildHardwareForecast(aRows, { config, rate, upliftPct, horizonYears, asOf }),
    software: AF.buildSoftwareForecast(lRows, { horizonYears, asOf }),
  };
}
async function _getInvestmentForecastPg(filters, { config, rate, upliftPct, horizonYears, asOf } = {}) {
  const h = pgHandle();
  const aw = _assetWhere(filters);
  const lw = _licenceWhere(filters);
  const aRows = await h.prepare(`${_INVEST_FCST_ASSET_SELECT}${aw.where}`).all(...aw.params);
  const lRows = await h.prepare(`${_INVEST_FCST_LIC_SELECT}${lw.where}`).all(...lw.params);
  return {
    hardware: AF.buildHardwareForecast(aRows, { config, rate, upliftPct, horizonYears, asOf }),
    software: AF.buildSoftwareForecast(lRows, { horizonYears, asOf }),
  };
}

// ─── Licence-compliance readers (Task 3) ───────────────────────────────────
// Type-family classification + summary + expiry exceptions over software_licenses.
// `cost` is USD native — never rate-multiplied, never SQL-summed (it isn't summed
// at all here; the exception rows carry it RAW for reference). The taxonomy is the
// Endeavour ITAM training-guide licence families, mapped by case-insensitive
// substring on the raw `license_type`, most-specific-first.
//
// CRITICAL: the real `Expiry Date` is DD Mon YYYY ('30 Jun 2025'), NOT ISO. The
// bucketing is done in JS via `new Date(raw)` (V8 parses that form correctly) —
// NEVER substr()/lexical/SQL date() on this column (they mis-bucket the format).
// A `now` is injectable via filters.now (a Date) so tests are deterministic.

// Pure classifier — exported. Most-specific-first so overlapping substrings resolve
// deterministically ('enterprise' beats a bare 'subscription'; 'cal' matched as a
// whole word so 'physical'/'individual' never leak into Server).
function classifyLicenceType(raw) {
  const s = String(raw == null ? '' : raw).toLowerCase();
  if (s.includes('trial') || s.includes('free')) return 'Special';
  if (s.includes('client access') || /\bcal\b/.test(s)) return 'Server';
  if (s.includes('volume') || s.includes('enterprise')) return 'Enterprise';
  if (s.includes('named user') || s.includes('concurrent')) return 'User';
  if (s.includes('individual') || s.includes('node locked') || s.includes('node-locked') || s.includes('oem')) return 'Machine';
  return 'Other';
}

const _EXPIRY_HORIZON_MS = 90 * 24 * 60 * 60 * 1000;   // 90 days

// Bucket one raw expiry against `now`. Empty / unparseable → 'no_expiry'. Parsed in
// JS via new Date so DD Mon YYYY works. expired = valid date < now; expiring_90 =
// now ≤ date ≤ now+90d; ok = date > now+90d.
function _licenceExpiryBucket(raw, now) {
  const s = String(raw == null ? '' : raw).trim();
  if (s === '') return 'no_expiry';
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) return 'no_expiry';
  const n = now.getTime();
  if (t < n) return 'expired';
  if (t <= n + _EXPIRY_HORIZON_MS) return 'expiring_90';
  return 'ok';
}

// The four exception kinds — the single source of truth for routes + Excel + digest.
// Each `test(row, now)` is a pure JS predicate over a fetched row. `no_expiry` covers
// any empty/unparseable expiry (matches what the summary counts as no_expiry); the
// bucket already restricts to that population regardless of family.
const LICENCE_KINDS = {
  expired:       { label: 'Expired',              test: (r, now) => _licenceExpiryBucket(r.expiry_date, now) === 'expired' },
  expiring_soon: { label: 'Expiring within 90d',  test: (r, now) => _licenceExpiryBucket(r.expiry_date, now) === 'expiring_90' },
  no_expiry:     { label: 'No / unparseable expiry', test: (r, now) => _licenceExpiryBucket(r.expiry_date, now) === 'no_expiry' },
  no_site:       { label: 'No site',              test: (r) => r.site == null || String(r.site).trim() === '' },
};

// Whitelisted licence filters — value NEVER interpolated, always parameter-bound.
// `family` is derived JS-side (not a column), so it is applied in the shared JS pass,
// not in SQL. `now` is not a filter — it rides through to the JS bucketing.
const _LICENCE_TEXT_COLS = { site: 'site', state: 'license_state' };
function _licenceWhere(filters) {
  const clauses = [], params = [];
  const f = filters || {};
  for (const [key, col] of Object.entries(_LICENCE_TEXT_COLS)) {
    if (f[key] != null && f[key] !== '') { clauses.push(`${col} = ?`); params.push(f[key]); }
  }
  if (f.q != null && f.q !== '') {
    clauses.push('(license_name LIKE ? OR vendor LIKE ?)');
    const like = `%${f.q}%`; params.push(like, like);
  }
  return { where: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '', params };
}

const _LICENCE_SUMMARY_COLS = 'license_type, license_state, expiry_date, site';
const _LICENCE_EXC_COLS = 'license_id, license_name, license_type, license_state, expiry_date, cost, site, vendor';
function _licenceNow(filters) {
  return (filters && filters.now instanceof Date) ? filters.now : new Date();
}
// Add the derived `family` and apply an optional family filter. SHARED by both
// backends, so classification + family filtering are identical regardless of engine.
function _withFamily(rows, filters) {
  const fam = (filters && filters.family != null && filters.family !== '') ? String(filters.family) : null;
  const out = [];
  for (const r of rows) {
    const family = classifyLicenceType(r.license_type);
    if (fam && family !== fam) continue;
    out.push(Object.assign({ family }, r));
  }
  return out;
}
// SHARED pure aggregator — both backends hand it the same rows → parity by construction.
function _aggregateLicence(rows, filters) {
  const now = _licenceNow(filters);
  const famRows = _withFamily(rows, filters);
  const by_family = {}, by_state = {}, by_site = {};
  const expiry = { expired: 0, expiring_90: 0, ok: 0, no_expiry: 0 };
  for (const r of famRows) {
    by_family[r.family] = (by_family[r.family] || 0) + 1;
    const st = r.license_state == null ? '' : String(r.license_state);
    by_state[st] = (by_state[st] || 0) + 1;
    const si = r.site == null ? '' : String(r.site);
    by_site[si] = (by_site[si] || 0) + 1;
    expiry[_licenceExpiryBucket(r.expiry_date, now)]++;
  }
  return { total: famRows.length, by_family, by_state, by_site, expiry };
}

function getLicenceSummary(filters = {}) {
  if (ASSETS_BACKEND === 'postgres') return _getLicenceSummaryPg(filters);
  const db = getDB();
  const { where, params } = _licenceWhere(filters);
  const rows = db.prepare(`SELECT ${_LICENCE_SUMMARY_COLS} FROM software_licenses${where}`).all(...params);
  return _aggregateLicence(rows, filters);
}
async function _getLicenceSummaryPg(filters = {}) {
  const h = pgHandle();
  const { where, params } = _licenceWhere(filters);
  const rows = await h.prepare(`SELECT ${_LICENCE_SUMMARY_COLS} FROM software_licenses${where}`).all(...params);
  return _aggregateLicence(rows, filters);
}

// Filter fetched exception rows by kind (throws on unknown) + family. SHARED.
function _licenceExceptions(rows, kind, filters) {
  const k = LICENCE_KINDS[kind];
  if (!k) throw new Error(`getLicenceExceptions: unknown licence kind "${kind}"`);
  const now = _licenceNow(filters);
  return _withFamily(rows, filters).filter(r => k.test(r, now));
}

function getLicenceExceptions(kind, filters = {}) {
  if (ASSETS_BACKEND === 'postgres') return _getLicenceExceptionsPg(kind, filters);
  const db = getDB();
  if (!LICENCE_KINDS[kind]) throw new Error(`getLicenceExceptions: unknown licence kind "${kind}"`);
  const { where, params } = _licenceWhere(filters);
  const rows = db.prepare(`SELECT ${_LICENCE_EXC_COLS} FROM software_licenses${where} ORDER BY site, license_name`).all(...params);
  return _licenceExceptions(rows, kind, filters);
}
async function _getLicenceExceptionsPg(kind, filters = {}) {
  const h = pgHandle();
  if (!LICENCE_KINDS[kind]) throw new Error(`getLicenceExceptions: unknown licence kind "${kind}"`);
  const { where, params } = _licenceWhere(filters);
  const rows = await h.prepare(`SELECT ${_LICENCE_EXC_COLS} FROM software_licenses${where} ORDER BY site, license_name`).all(...params);
  return _licenceExceptions(rows, kind, filters);
}

// ─── Software licence compliance (Assets C-2 Task 1) ────────────────────────
// COUNT-BASED, NO money. The `software` view's count columns (installations,
// installations_allowed, …) hold the literal string 'N/A' on 9780 of 9830 real
// rows — so `CAST(... AS INTEGER)` THROWS on postgres (500) and silently returns
// 0 on sqlite (→ mass false positives). ALL classification / comparison is done
// in a shared JS pass via toInt() — NEVER a SQL CAST. Same recipe as the licence
// readers above: SELECT the text rows, classify + tally in JS.

// Coerce a raw count cell to an int or null. 'N/A' → null, '540' → 540,
// '1,234' → 1234, '' → null. The single guard against the 'N/A' trap.
function toInt(v) {
  const n = Number(String(v == null ? '' : v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Pure classifier — exported. Compliance is declared by the `compliance_type`
// column (Under Licensed / Over Licensed / Compliant / N/A). Anything that is
// not one of the three metered verdicts (N/A, empty, unknown) → 'not_metered'.
function classifySoftwareCompliance(row) {
  const t = String((row && row.compliance_type) || '').toLowerCase();
  if (t.includes('under')) return 'under_licensed';
  if (t.includes('over')) return 'over_licensed';
  if (t.includes('compliant')) return 'compliant';
  return 'not_metered';
}

// The three software exception kinds — the single source of truth. `under/over`
// are BY COMPLIANCE TYPE ONLY (do NOT OR a raw installs>allowed comparison —
// the 'N/A' rows would false-positive). `managed` is the metered universe.
const SOFTWARE_KINDS = {
  under_licensed: { label: 'Under-licensed', test: (r) => classifySoftwareCompliance(r) === 'under_licensed' },
  over_licensed:  { label: 'Over-licensed',  test: (r) => classifySoftwareCompliance(r) === 'over_licensed' },
  managed:        { label: 'Managed (metered)', test: (r) => String(r.software_type || '').toLowerCase() === 'managed' },
};

// Whitelisted software filters — value NEVER interpolated, always parameter-bound.
function _softwareWhere(filters) {
  const clauses = [], params = [];
  const f = filters || {};
  if (f.manufacturer != null && f.manufacturer !== '') { clauses.push('manufacturer = ?'); params.push(f.manufacturer); }
  if (f.software_type != null && f.software_type !== '') { clauses.push('software_type = ?'); params.push(f.software_type); }
  if (f.q != null && f.q !== '') {
    clauses.push('(software_name LIKE ? OR manufacturer LIKE ?)');
    const like = `%${f.q}%`; params.push(like, like);
  }
  return { where: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '', params };
}

const _SOFTWARE_SUMMARY_COLS = 'manufacturer, installations, installations_allowed, compliance_type, software_type';
const _SOFTWARE_EXC_COLS = 'software_name, manufacturer, installations, installations_allowed, licensed_installations, compliance_type, software_category, software_type';

// SHARED pure aggregator — both backends hand it the same rows → parity by
// construction. ALL classification / comparison happens here in JS.
function _aggregateSoftware(rows) {
  const by_compliance = { under_licensed: 0, over_licensed: 0, compliant: 0, not_metered: 0 };
  const installs_vs_allowed = { under: 0, over: 0, ok: 0 };
  const mfr = new Map();   // manufacturer → { manufacturer, managed, under, over }
  let managed = 0;
  for (const r of rows) {
    const bucket = classifySoftwareCompliance(r);
    by_compliance[bucket]++;
    const isManaged = String(r.software_type || '').toLowerCase() === 'managed';
    if (isManaged) managed++;
    // installs vs allowed — toInt guards the 'N/A' trap; unmetered rows (either
    // side null) fall into NONE of under/over/ok.
    const ins = toInt(r.installations), allw = toInt(r.installations_allowed);
    if (ins != null && allw != null) {
      if (ins > allw) installs_vs_allowed.under++;
      else if (ins < allw) installs_vs_allowed.over++;
      else installs_vs_allowed.ok++;
    }
    const name = r.manufacturer == null ? '' : String(r.manufacturer);
    let m = mfr.get(name);
    if (!m) { m = { manufacturer: name, managed: 0, under: 0, over: 0 }; mfr.set(name, m); }
    if (isManaged) m.managed++;
    if (bucket === 'under_licensed') m.under++;
    if (bucket === 'over_licensed') m.over++;
  }
  const by_manufacturer = [...mfr.values()].sort((a, b) => a.manufacturer.localeCompare(b.manufacturer));
  return { total: rows.length, managed, by_compliance, by_manufacturer, installs_vs_allowed };
}

function getSoftwareComplianceSummary(filters = {}) {
  if (ASSETS_BACKEND === 'postgres') return _getSoftwareComplianceSummaryPg(filters);
  const db = getDB();
  const { where, params } = _softwareWhere(filters);
  const rows = db.prepare(`SELECT ${_SOFTWARE_SUMMARY_COLS} FROM software${where}`).all(...params);
  return _aggregateSoftware(rows);
}
async function _getSoftwareComplianceSummaryPg(filters = {}) {
  const h = pgHandle();
  const { where, params } = _softwareWhere(filters);
  const rows = await h.prepare(`SELECT ${_SOFTWARE_SUMMARY_COLS} FROM software${where}`).all(...params);
  return _aggregateSoftware(rows);
}

// Filter fetched rows by kind (throws on unknown). SHARED by both backends.
function _softwareExceptions(rows, kind) {
  const k = SOFTWARE_KINDS[kind];
  if (!k) throw new Error(`getSoftwareComplianceExceptions: unknown software kind "${kind}"`);
  return rows.filter(r => k.test(r));
}

function getSoftwareComplianceExceptions(kind, filters = {}) {
  if (ASSETS_BACKEND === 'postgres') return _getSoftwareComplianceExceptionsPg(kind, filters);
  const db = getDB();
  if (!SOFTWARE_KINDS[kind]) throw new Error(`getSoftwareComplianceExceptions: unknown software kind "${kind}"`);
  const { where, params } = _softwareWhere(filters);
  const rows = db.prepare(`SELECT ${_SOFTWARE_EXC_COLS} FROM software${where} ORDER BY software_name`).all(...params);
  return _softwareExceptions(rows, kind);
}
async function _getSoftwareComplianceExceptionsPg(kind, filters = {}) {
  const h = pgHandle();
  if (!SOFTWARE_KINDS[kind]) throw new Error(`getSoftwareComplianceExceptions: unknown software kind "${kind}"`);
  const { where, params } = _softwareWhere(filters);
  const rows = await h.prepare(`SELECT ${_SOFTWARE_EXC_COLS} FROM software${where} ORDER BY software_name`).all(...params);
  return _softwareExceptions(rows, kind);
}

// ─── Effort snapshot (asset-manager effort trend, Task 0) ───────────────────
// The nightly job that snapshots each site's data-hygiene state into the
// append-only asset_effort_history table. The source tables are full-replaced
// each night → no history to backfill; this snapshot is the ONLY source of the
// trend. Per site (total>0): six good-state percentages (1 - worklist/total,
// inherently [0,1]) and effort_score = round(100 × mean of the six). `ghost` is
// STORED as a detail column but is NOT part of the score (avoids double-counting
// scan freshness — scan_pct uses never_scanned). The worklist COUNTs reuse the
// EXACT HYGIENE_KINDS predicate strings (unqualified names resolve against the
// single `assets` table), so the pg fork is byte-identical.
//
// C1: GROUP BY COALESCE(site,'') is MANDATORY — a bare GROUP BY site inserts a
// NULL into the NOT NULL PK and throws. Null-site assets bucket into ''.
const _EFFORT_AGG_SELECT = `SELECT COALESCE(site,'') AS site, COUNT(*) AS total,
  SUM(CASE WHEN (${HYGIENE_KINDS.no_cost.where})       THEN 1 ELSE 0 END) AS no_cost,
  SUM(CASE WHEN (${HYGIENE_KINDS.no_age.where})        THEN 1 ELSE 0 END) AS no_age,
  SUM(CASE WHEN (${HYGIENE_KINDS.no_owner.where})      THEN 1 ELSE 0 END) AS no_owner,
  SUM(CASE WHEN (${HYGIENE_KINDS.never_scanned.where}) THEN 1 ELSE 0 END) AS never_scanned,
  SUM(CASE WHEN (${HYGIENE_KINDS.no_asset_tag.where})  THEN 1 ELSE 0 END) AS no_asset_tag,
  SUM(CASE WHEN (${HYGIENE_KINDS.discovered.where})    THEN 1 ELSE 0 END) AS discovered,
  SUM(CASE WHEN (${HYGIENE_KINDS.ghost.where})         THEN 1 ELSE 0 END) AS ghost
FROM assets GROUP BY COALESCE(site,'')`;

const _EFFORT_COLS = ['snapshot_date', 'site', 'total', 'no_cost', 'no_age', 'no_owner',
  'never_scanned', 'no_asset_tag', 'discovered', 'ghost', 'cost_pct', 'age_pct', 'owner_pct',
  'scan_pct', 'tag_pct', 'enrolled_pct', 'effort_score'];

// Turn one aggregation row into a full history record. Skips total===0 (defensive
// — a GROUP BY never yields it). Each pct = 1 - worklist/total, clamped to [0,1].
// effort_score = round(100 × mean of the SIX pcts) — ghost is NOT in the mean.
function _effortRecord(date, r) {
  const total = Number(r.total);
  if (!(total > 0)) return null;
  const g = {
    no_cost: Number(r.no_cost), no_age: Number(r.no_age), no_owner: Number(r.no_owner),
    never_scanned: Number(r.never_scanned), no_asset_tag: Number(r.no_asset_tag),
    discovered: Number(r.discovered), ghost: Number(r.ghost),
  };
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const cost_pct = clamp(1 - g.no_cost / total);
  const age_pct = clamp(1 - g.no_age / total);
  const owner_pct = clamp(1 - g.no_owner / total);
  const scan_pct = clamp(1 - g.never_scanned / total);   // never_scanned, NEVER ghost
  const tag_pct = clamp(1 - g.no_asset_tag / total);
  const enrolled_pct = clamp(1 - g.discovered / total);
  const effort_score = Math.round(100 * (cost_pct + age_pct + owner_pct + scan_pct + tag_pct + enrolled_pct) / 6);
  return {
    snapshot_date: date, site: String(r.site), total, ...g,
    cost_pct, age_pct, owner_pct, scan_pct, tag_pct, enrolled_pct, effort_score,
  };
}

// Snapshot every site's effort state for `asOf` (default today). Upsert per site
// so re-running the same day is idempotent. Returns {date, sites}.
function snapshotEffort(opts = {}) {
  if (ASSETS_BACKEND === 'postgres') return _snapshotEffortPg(opts);
  const date = (opts && opts.asOf) || new Date().toISOString().slice(0, 10);
  const db = getDB();
  const records = db.prepare(_EFFORT_AGG_SELECT).all().map(r => _effortRecord(date, r)).filter(Boolean);
  const ph = _EFFORT_COLS.map(() => '?').join(', ');
  const insert = db.prepare(`INSERT OR REPLACE INTO asset_effort_history (${_EFFORT_COLS.join(', ')}) VALUES (${ph})`);
  const tx = db.transaction((recs) => { for (const m of recs) insert.run(..._EFFORT_COLS.map(c => m[c])); });
  tx(records);
  return { date, sites: records.length };
}
async function _snapshotEffortPg(opts = {}) {
  const date = (opts && opts.asOf) || new Date().toISOString().slice(0, 10);
  const h = pgHandle();
  const records = (await h.prepare(_EFFORT_AGG_SELECT).all()).map(r => _effortRecord(date, r)).filter(Boolean);
  const ph = _EFFORT_COLS.map(() => '?').join(', ');   // pgDb translates ? -> $N
  const setCols = _EFFORT_COLS.filter(c => c !== 'snapshot_date' && c !== 'site')
    .map(c => `${c} = EXCLUDED.${c}`).join(', ');
  const insertSql = `INSERT INTO asset_effort_history (${_EFFORT_COLS.join(', ')}) VALUES (${ph})
    ON CONFLICT (snapshot_date, site) DO UPDATE SET ${setCols}`;
  return h.runTransaction(async () => {
    const ins = h.prepare(insertSql);
    for (const m of records) await ins.run(..._EFFORT_COLS.map(c => m[c]));
    return { date, sites: records.length };
  });
}

// ─── Asset engagement — first sightings (2026-09-18) ─────────────────────────
// Records every asset id not seen before. First run on a non-empty register =
// baseline (baseline=1, never reported as new). Existing rows are never updated
// (INSERT OR IGNORE / ON CONFLICT DO NOTHING) → idempotent per day. Dates are UTC,
// like snapshotEffort. Dual-backend: the pg fork is async — callers MUST await.
// The two bound parameters sit in the SELECT list, where Postgres cannot infer
// their type from a column ("could not determine data type of parameter $1") —
// cast them explicitly. The casts are on PARAMETERS, never on stored text
// columns, and are valid on both backends.
const _SIGHT_SELECT = `SELECT asset_id, COALESCE(site, ''), CAST(? AS TEXT), CAST(? AS INTEGER) FROM assets WHERE asset_id IS NOT NULL AND asset_id <> ''`;

function recordAssetSightings(opts = {}) {
  if (ASSETS_BACKEND === 'postgres') return _recordAssetSightingsPg(opts);
  const date = (opts && opts.asOf) || new Date().toISOString().slice(0, 10);
  const db = getDB();
  const tx = db.transaction(() => {
    const assets = countRows('assets');
    if (!assets) return { date, baseline: false, inserted: 0, skipped: 'no assets' };
    const baseline = countRows('asset_first_seen') === 0;
    const r = db.prepare(`INSERT OR IGNORE INTO asset_first_seen (asset_id, site, first_seen_date, baseline) ${_SIGHT_SELECT}`)
      .run(date, baseline ? 1 : 0);
    return { date, baseline, inserted: r.changes };
  });
  return tx();
}
async function _recordAssetSightingsPg(opts = {}) {
  const date = (opts && opts.asOf) || new Date().toISOString().slice(0, 10);
  const h = pgHandle();
  return h.runTransaction(async () => {
    const assets = await countRows('assets');
    if (!assets) return { date, baseline: false, inserted: 0, skipped: 'no assets' };
    const baseline = (await countRows('asset_first_seen')) === 0;
    // Explicit RETURNING keeps pgDb from appending RETURNING * (thousands of rows).
    const r = await h.prepare(`INSERT INTO asset_first_seen (asset_id, site, first_seen_date, baseline) ${_SIGHT_SELECT}
      ON CONFLICT (asset_id) DO NOTHING RETURNING asset_id`).run(date, baseline ? 1 : 0);
    return { date, baseline, inserted: Number(r.changes) || 0 };
  });
}

// Identity columns only — `has_cost` is a 0/1 flag, never the amount. Qualified
// with `a.` because the "new" query joins asset_first_seen (which also has `site`).
const _FOLLOWUP_COLS = `a.asset_id, a.asset_name, a.product_type, a.manufacturer, a.serial_number,
  a.state, a.site, a.user_name, a.department, a.acquisition_date,
  CASE WHEN (a.purchase_cost IS NULL OR TRIM(a.purchase_cost) IN ('','0','0.00')) THEN 0 ELSE 1 END AS has_cost`;

function _followupQueries(labels, opts) {
  const L = (labels || []).map(v => String(v == null ? '' : v)).filter(Boolean);
  const ph = L.map(() => '?').join(', ');
  const q = {
    unassigned: { sql: `SELECT ${_FOLLOWUP_COLS} FROM assets a WHERE (${FOLLOWUP_UNASSIGNED}) AND a.site IN (${ph}) ORDER BY COALESCE(a.asset_name,''), a.asset_id`, params: L },
    no_cost:    { sql: `SELECT ${_FOLLOWUP_COLS} FROM assets a WHERE (${FOLLOWUP_NO_COST}) AND a.site IN (${ph}) ORDER BY COALESCE(a.asset_name,''), a.asset_id`, params: L },
    no_date:    { sql: `SELECT ${_FOLLOWUP_COLS} FROM assets a WHERE (${FOLLOWUP_NO_DATE}) AND a.site IN (${ph}) ORDER BY COALESCE(a.asset_name,''), a.asset_id`, params: L },
  };
  const { newFrom, newTo } = opts || {};
  if (newFrom && newTo) {
    q.new = {
      sql: `SELECT ${_FOLLOWUP_COLS}, f.first_seen_date FROM asset_first_seen f
            JOIN assets a ON a.asset_id = f.asset_id
            WHERE f.baseline = 0 AND f.first_seen_date BETWEEN ? AND ? AND a.site IN (${ph})
              AND (a.asset_tag IS NULL OR TRIM(a.asset_tag) = '')   -- QR label = Asset Tag; barcode is mostly the auto-filled serial
            ORDER BY f.first_seen_date, COALESCE(a.asset_name,''), a.asset_id`,
      params: [newFrom, newTo, ...L],
    };
  }
  return { L, q };
}
function _shapeFollowups(lists) {
  const shape = (rows) => (rows || []).map(r => ({ ...r, has_cost: Number(r.has_cost) === 1 }));
  const out = { new: shape(lists.new), unassigned: shape(lists.unassigned), no_cost: shape(lists.no_cost), no_date: shape(lists.no_date) };
  out.counts = { new: out.new.length, unassigned: out.unassigned.length, no_cost: out.no_cost.length, no_date: out.no_date.length };
  out.generated_at = new Date().toISOString();
  return out;
}

// getSiteAssetFollowups(labels, {newFrom, newTo}) — the four asset-engagement
// worklists for ONE site (its real asset labels). The "new" list uses the CURRENT
// assets.site. Empty labels → zeros. Dual-backend: the pg fork is async.
function getSiteAssetFollowups(labels, opts = {}) {
  if (ASSETS_BACKEND === 'postgres') return _getSiteAssetFollowupsPg(labels, opts);
  const { L, q } = _followupQueries(labels, opts);
  if (!L.length) return _shapeFollowups({});
  const db = getDB();
  const lists = {};
  for (const [k, { sql, params }] of Object.entries(q)) lists[k] = db.prepare(sql).all(...params);
  return _shapeFollowups(lists);
}
async function _getSiteAssetFollowupsPg(labels, opts = {}) {
  const { L, q } = _followupQueries(labels, opts);
  if (!L.length) return _shapeFollowups({});
  const h = pgHandle();
  const lists = {};
  for (const [k, { sql, params }] of Object.entries(q)) lists[k] = await h.prepare(sql).all(...params);
  return _shapeFollowups(lists);
}

// ─── Effort trend readers (Task 2) ─────────────────────────────────────────
// Consumed by the Progress dashboard (+ later reports). Both dual-backend; the
// history table is tiny (one row per site per day), so we SELECT the window and
// aggregate in JS rather than in SQL. Pure builders (_buildLeaderboard/_buildTrend)
// are shared by both backends → the pg forks stay byte-identical.

function _addDaysStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function _monthsAgoStr(months) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

// Leaderboard = one entry per site with a snapshot on/before asOf: latest effort_score,
// a 30-day-lookback baseline, delta, and a score-desc rank. Baseline = the snapshot
// ON or NEAREST-BEFORE (asOf−30d); if none that old, the EARLIEST in window. When the
// baseline resolves to the SAME snapshot as latest (a single-snapshot site, or a site
// whose only ≥30d-old snapshot IS the latest) there is nothing to compare against, so
// baseline_score/delta are null. most_improved = the max POSITIVE delta (null if none);
// needs_attention = the lowest score<50 with delta<=0 (tie → lowest delta; null if none).
function _buildLeaderboard(histRows, asOf) {
  if (!histRows || histRows.length === 0) return { rows: [], most_improved: null, needs_attention: null };
  const cutoff = _addDaysStr(asOf, -30);
  const bySite = new Map();   // site -> snaps[] ascending by date (SQL ORDER BY guarantees it)
  for (const r of histRows) {
    if (!bySite.has(r.site)) bySite.set(r.site, []);
    bySite.get(r.site).push({ date: r.snapshot_date, score: Number(r.effort_score) });
  }
  const rows = [];
  for (const [site, snaps] of bySite) {
    const latest = snaps[snaps.length - 1];
    const old = snaps.filter(x => x.date <= cutoff);
    const baselineSnap = old.length ? old[old.length - 1] : snaps[0];
    let baseline_score = null, delta = null;
    if (baselineSnap !== latest) {          // reference-equal ⇒ nothing to compare against
      baseline_score = baselineSnap.score;
      delta = Math.round(latest.score - baseline_score);
    }
    rows.push({ site, effort_score: latest.score, baseline_score, delta, rank: 0 });
  }
  rows.sort((a, b) => (b.effort_score - a.effort_score) || (a.site < b.site ? -1 : a.site > b.site ? 1 : 0));
  rows.forEach((r, i) => { r.rank = i + 1; });
  let most_improved = null;
  for (const r of rows) {
    if (r.delta != null && r.delta > 0 && (most_improved == null || r.delta > most_improved.delta)) most_improved = r;
  }
  let needs_attention = null;
  for (const r of rows) {
    if (r.effort_score < 50 && r.delta != null && r.delta <= 0) {
      if (needs_attention == null || r.effort_score < needs_attention.effort_score ||
          (r.effort_score === needs_attention.effort_score && r.delta < needs_attention.delta)) {
        needs_attention = r;
      }
    }
  }
  return { rows, most_improved, needs_attention };
}
function getEffortLeaderboard(opts = {}) {
  if (ASSETS_BACKEND === 'postgres') return _getEffortLeaderboardPg(opts);
  const asOf = (opts && opts.asOf) || new Date().toISOString().slice(0, 10);
  const rows = getDB().prepare(
    `SELECT snapshot_date, site, effort_score FROM asset_effort_history
     WHERE snapshot_date <= ? ORDER BY site, snapshot_date`).all(asOf);
  return _buildLeaderboard(rows, asOf);
}
async function _getEffortLeaderboardPg(opts = {}) {
  const asOf = (opts && opts.asOf) || new Date().toISOString().slice(0, 10);
  const h = pgHandle();
  const rows = await h.prepare(
    `SELECT snapshot_date, site, effort_score FROM asset_effort_history
     WHERE snapshot_date <= ? ORDER BY site, snapshot_date`).all(asOf);
  return _buildLeaderboard(rows, asOf);
}

// Trend = {dates, sites}. `dates` are the distinct snapshot_date values in the last
// `months` months (ascending). Each site's `scores` are ALIGNED to `dates` — a date the
// site has no snapshot on is `null` (a gap = "no snapshot", NEVER a false 0). The history
// table has NO product_type/state/manufacturer columns → only `filters.site` can narrow.
// A single-site filter also attaches `components` = that site's LATEST-in-window six pcts
// (for the detail-on-click panel).
function _buildTrend(rows, singleSite) {
  if (!rows || rows.length === 0) return { dates: [], sites: [] };
  const dateSet = new Set();
  const bySite = new Map();   // site -> Map<date, row>
  for (const r of rows) {
    dateSet.add(r.snapshot_date);
    if (!bySite.has(r.site)) bySite.set(r.site, new Map());
    bySite.get(r.site).set(r.snapshot_date, r);
  }
  const dates = [...dateSet].sort();
  const sites = [];
  for (const site of [...bySite.keys()].sort()) {
    const dayMap = bySite.get(site);
    const scores = dates.map(d => dayMap.has(d) ? Number(dayMap.get(d).effort_score) : null);
    const entry = { site, scores };
    if (singleSite) {
      const latestDate = dates.filter(d => dayMap.has(d)).pop();
      const lr = dayMap.get(latestDate);
      entry.components = {
        cost_pct: Number(lr.cost_pct), age_pct: Number(lr.age_pct), owner_pct: Number(lr.owner_pct),
        scan_pct: Number(lr.scan_pct), tag_pct: Number(lr.tag_pct), enrolled_pct: Number(lr.enrolled_pct),
      };
    }
    sites.push(entry);
  }
  return { dates, sites };
}
const _EFFORT_TREND_SELECT = `SELECT snapshot_date, site, effort_score,
  cost_pct, age_pct, owner_pct, scan_pct, tag_pct, enrolled_pct
  FROM asset_effort_history WHERE snapshot_date >= ?`;
function getEffortTrend(filters, opts = {}) {
  if (ASSETS_BACKEND === 'postgres') return _getEffortTrendPg(filters, opts);
  const months = (opts && opts.months) || 6;
  const site = (filters && filters.site != null && filters.site !== '') ? filters.site : null;
  const cutoff = _monthsAgoStr(months);
  const clause = site ? ' AND site = ?' : '';
  const params = site ? [cutoff, site] : [cutoff];
  const rows = getDB().prepare(`${_EFFORT_TREND_SELECT}${clause} ORDER BY site, snapshot_date`).all(...params);
  return _buildTrend(rows, !!site);
}
async function _getEffortTrendPg(filters, opts = {}) {
  const months = (opts && opts.months) || 6;
  const site = (filters && filters.site != null && filters.site !== '') ? filters.site : null;
  const cutoff = _monthsAgoStr(months);
  const clause = site ? ' AND site = ?' : '';
  const params = site ? [cutoff, site] : [cutoff];
  const h = pgHandle();
  const rows = await h.prepare(`${_EFFORT_TREND_SELECT}${clause} ORDER BY site, snapshot_date`).all(...params);
  return _buildTrend(rows, !!site);
}

if (ASSETS_BACKEND !== 'postgres') getDB();   // eager sqlite init at require, like tracker-db
// ── Réconciliation SDP × AD × Entra ─────────────────────────────────────────

/** Les seules décisions acceptées. Une valeur libre rendrait le compteur ininterprétable. */
const DECISIONS = ['handled', 'out_of_scope'];

const _AED_COLS = ['source', 'device_key', 'device_name', 'dns_name', 'os', 'os_version',
  'last_seen', 'enabled', 'join_type', 'ou_dn', 'model', 'raw_json', 'import_id', 'imported_at'];

/**
 * Remplace la photo d'UNE source. La suppression est portée par `source` :
 * réimporter AD ne doit jamais toucher Entra, et l'inverse.
 *
 * Tout se fait dans UNE transaction — un import interrompu laisserait sinon la
 * source vidée, donc zéro écart, donc un rapport rassurant et faux.
 */
function replaceExternalDevices(source, rows, importId) {
  if (ASSETS_BACKEND === 'postgres') return _replaceExternalDevicesPg(source, rows, importId);
  const db = getDB();
  const at = new Date().toISOString();
  const ins = db.prepare(
    `INSERT OR REPLACE INTO asset_external_devices (${_AED_COLS.join(',')})
     VALUES (${_AED_COLS.map(() => '?').join(',')})`);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM asset_external_devices WHERE source = ?').run(source);
    for (const r of rows || []) ins.run(..._aedValues(source, r, importId, at));
  });
  tx();
  return (rows || []).length;
}
async function _replaceExternalDevicesPg(source, rows, importId) {
  const h = pgHandle();
  const at = new Date().toISOString();
  await h.runTransaction(async () => {
    await h.prepare('DELETE FROM asset_external_devices WHERE source = ?').run(source);
    for (const r of rows || []) {
      await h.prepare(
        `INSERT INTO asset_external_devices (${_AED_COLS.join(',')})
         VALUES (${_AED_COLS.map(() => '?').join(',')})
         ON CONFLICT (source, device_key) DO NOTHING`).run(..._aedValues(source, r, importId, at));
    }
  });
  return (rows || []).length;
}
function _aedValues(source, r, importId, at) {
  return [
    source,
    String(r.device_key || r.device_name || '').toUpperCase(),
    r.device_name || '',
    r.dns_name || null, r.os || null, r.os_version || null, r.last_seen || null,
    r.enabled === false || r.enabled === 0 ? 0 : 1,
    r.join_type || null, r.ou_dn || null, r.model || null,
    r.raw_json || null, importId || null, at,
  ];
}

function listExternalDevices(source) {
  if (ASSETS_BACKEND === 'postgres') return _listExternalDevicesPg(source);
  const db = getDB();
  return source
    ? db.prepare('SELECT * FROM asset_external_devices WHERE source = ?').all(source)
    : db.prepare('SELECT * FROM asset_external_devices').all();
}
async function _listExternalDevicesPg(source) {
  const h = pgHandle();
  return source
    ? h.prepare('SELECT * FROM asset_external_devices WHERE source = ?').all(source)
    : h.prepare('SELECT * FROM asset_external_devices').all();
}

/** La fraîcheur par source — sans elle personne ne sait sur quoi il regarde. */
function listImportRuns() {
  if (ASSETS_BACKEND === 'postgres') return _listImportRunsPg();
  return getDB().prepare(
    `SELECT source, MAX(imported_at) AS imported_at, MAX(import_id) AS import_id, COUNT(*) AS n
     FROM asset_external_devices GROUP BY source`).all();
}
async function _listImportRunsPg() {
  return pgHandle().prepare(
    `SELECT source, MAX(imported_at) AS imported_at, MAX(import_id) AS import_id, COUNT(*) AS n
     FROM asset_external_devices GROUP BY source`).all();
}

/**
 * Pose une décision sur un écart.
 *
 * `out_of_scope` EXIGE un motif : sortir une machine du compteur sans dire
 * pourquoi est exactement ce qui vide un indicateur de son sens.
 */
function setDecision(deviceKey, decision, reason, who) {
  if (!DECISIONS.includes(decision)) throw new Error(`decision inconnue: ${decision}`);
  if (decision === 'out_of_scope' && !String(reason || '').trim()) {
    throw new Error('un motif est obligatoire pour sortir une machine du périmètre');
  }
  const key = String(deviceKey || '').toUpperCase();
  if (!key) throw new Error('device_key manquant');
  if (ASSETS_BACKEND === 'postgres') return _setDecisionPg(key, decision, reason, who);
  getDB().prepare(
    `INSERT OR REPLACE INTO asset_reconcile_decisions (device_key, decision, reason, decided_by, decided_at)
     VALUES (?,?,?,?,?)`).run(key, decision, reason || null, who || null, new Date().toISOString());
  return true;
}
async function _setDecisionPg(key, decision, reason, who) {
  await pgHandle().prepare(
    `INSERT INTO asset_reconcile_decisions (device_key, decision, reason, decided_by, decided_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT (device_key) DO UPDATE SET
       decision = EXCLUDED.decision, reason = EXCLUDED.reason,
       decided_by = EXCLUDED.decided_by, decided_at = EXCLUDED.decided_at`
  ).run(key, decision, reason || null, who || null, new Date().toISOString());
  return true;
}

function clearDecision(deviceKey) {
  const key = String(deviceKey || '').toUpperCase();
  if (ASSETS_BACKEND === 'postgres') return _clearDecisionPg(key);
  getDB().prepare('DELETE FROM asset_reconcile_decisions WHERE device_key = ?').run(key);
  return true;
}
async function _clearDecisionPg(key) {
  await pgHandle().prepare('DELETE FROM asset_reconcile_decisions WHERE device_key = ?').run(key);
  return true;
}

function listDecisions() {
  if (ASSETS_BACKEND === 'postgres') return _listDecisionsPg();
  return getDB().prepare('SELECT * FROM asset_reconcile_decisions').all();
}
async function _listDecisionsPg() {
  return pgHandle().prepare('SELECT * FROM asset_reconcile_decisions').all();
}

// ─── Historique de la réconciliation + journal des imports ──────────────────
// On ne peut pas reconstituer l'historique après coup (fenêtre ancrée à
// aujourd'hui, sources remplacées), donc on capture au fil de l'eau — même
// patron qu'asset_effort_history.

const _RECHIST_COLS = ['snapshot_date', 'gaps_open', 'gaps_decided', 'sites_touched',
  'ous_touched', 'retirement_candidates', 'retirement_applicable', 'sources_present',
  'by_site_json', 'captured_by'];

/** La ligne à écrire, dérivée d'une vue buildReconcileView. Pur, testable. */
function _recHistRecord(view, who, date) {
  const c = (view && view.counts) || {};
  const applicable = c.retirement_applicable !== false;
  const bySite = {};
  for (const r of (view && view.by_site) || []) { if (r && r.site) bySite[r.site] = r.n; }
  return {
    snapshot_date: date,
    gaps_open: c.gaps_open || 0,
    gaps_decided: c.gaps_decided || 0,
    sites_touched: c.sites_touched || 0,
    ous_touched: c.ous_touched || 0,
    // NULL quand non applicable — un 0 dessinerait une fausse chute sur la courbe.
    retirement_candidates: applicable ? (c.retirement_candidates || 0) : null,
    retirement_applicable: applicable ? 1 : 0,
    sources_present: JSON.stringify(c.sources_present || []),
    by_site_json: JSON.stringify(bySite),
    captured_by: who || null,
  };
}

/** Capture UN point pour la journée (idempotent : le dernier du jour gagne). */
function snapshotReconcile(view, who, opts = {}) {
  const date = (opts && opts.asOf) || new Date().toISOString().slice(0, 10);
  const rec = _recHistRecord(view, who, date);
  if (ASSETS_BACKEND === 'postgres') return _snapshotReconcilePg(rec);
  const db = getDB();
  const ph = _RECHIST_COLS.map(() => '?').join(', ');
  db.prepare(`INSERT OR REPLACE INTO asset_reconcile_history (${_RECHIST_COLS.join(', ')}) VALUES (${ph})`)
    .run(..._RECHIST_COLS.map((k) => rec[k]));
  return { date };
}
async function _snapshotReconcilePg(rec) {
  const h = pgHandle();
  const ph = _RECHIST_COLS.map(() => '?').join(', ');
  const setCols = _RECHIST_COLS.filter((c) => c !== 'snapshot_date').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  await h.prepare(`INSERT INTO asset_reconcile_history (${_RECHIST_COLS.join(', ')}) VALUES (${ph})
    ON CONFLICT (snapshot_date) DO UPDATE SET ${setCols}`).run(..._RECHIST_COLS.map((k) => rec[k]));
  return { date: rec.snapshot_date };
}

/** Reconstitue une ligne d'historique en objet lisible (JSON reparsé, null préservé). */
function _recHistPoint(r) {
  const bySite = (() => { try { return JSON.parse(r.by_site_json || '{}'); } catch (_) { return {}; } })();
  return {
    date: r.snapshot_date,
    gaps_open: r.gaps_open,
    gaps_decided: r.gaps_decided,
    sites_touched: r.sites_touched,
    ous_touched: r.ous_touched,
    // Vient de la base NULL quand non applicable — surtout ne pas coalescer en 0.
    retirement_candidates: r.retirement_candidates == null ? null : Number(r.retirement_candidates),
    retirement_applicable: Number(r.retirement_applicable) === 1,
    sources_present: (() => { try { return JSON.parse(r.sources_present || '[]'); } catch (_) { return []; } })(),
    by_site: bySite,
  };
}

const _RECHIST_SELECT = (fromDate) =>
  `SELECT * FROM asset_reconcile_history WHERE snapshot_date >= '${fromDate}' ORDER BY snapshot_date ASC`;

function _buildReconcileHistory(rows) {
  const points = rows.map(_recHistPoint);
  // Une série par site, alignée sur les points présents — chaque équipe trace SA courbe.
  const seriesBySite = {};
  for (const p of points) {
    for (const [site, n] of Object.entries(p.by_site)) {
      if (!seriesBySite[site]) seriesBySite[site] = [];
      seriesBySite[site].push({ date: p.date, n });
    }
  }
  return { points, series_by_site: seriesBySite };
}

function getReconcileHistory(opts = {}) {
  const months = Number.isFinite(+opts.months) && +opts.months > 0 ? Math.min(+opts.months, 60) : 12;
  const from = _monthsAgoStr(months);
  if (ASSETS_BACKEND === 'postgres') return _getReconcileHistoryPg(from);
  return _buildReconcileHistory(getDB().prepare(_RECHIST_SELECT(from)).all());
}
async function _getReconcileHistoryPg(from) {
  return _buildReconcileHistory(await pgHandle().prepare(_RECHIST_SELECT(from)).all());
}

/** Journal des imports — append-only, une ligne par dépôt. */
function logImport(o) {
  const at = (o && o.at) || new Date().toISOString();
  const args = [o.source, at, o.row_count == null ? null : o.row_count,
    o.dated_count == null ? null : o.dated_count, o.imported_by || null];
  if (ASSETS_BACKEND === 'postgres') return _logImportPg(args);
  getDB().prepare(`INSERT INTO asset_import_log (source, imported_at, row_count, dated_count, imported_by)
    VALUES (?,?,?,?,?)`).run(...args);
  return true;
}
async function _logImportPg(args) {
  await pgHandle().prepare(`INSERT INTO asset_import_log (source, imported_at, row_count, dated_count, imported_by)
    VALUES (?,?,?,?,?)`).run(...args);
  return true;
}

function listImportLog(limit = 50) {
  const n = Number.isFinite(+limit) && +limit > 0 ? Math.min(+limit, 500) : 50;
  const sql = `SELECT * FROM asset_import_log ORDER BY imported_at DESC LIMIT ${n}`;
  if (ASSETS_BACKEND === 'postgres') return pgHandle().prepare(sql).all();
  return getDB().prepare(sql).all();
}

module.exports = {
  getDB, initPgAssets, pgHandle, ASSETS_BACKEND, replaceTable, countRows,
  getEnrichedAssets, getAssetLookups, getAssetSummary, getAssetCountsByType,
  HYGIENE_KINDS, getHygieneSummary, getHygieneExceptions,
  HARDWARE_KINDS, getHardwareHealthSummary, getHardwareHealthExceptions,
  getFinanceSummary,
  getAssetDepreciation, getDepreciationSchedule,
  getInvestmentSummary, getInvestmentForecast,
  classifyLicenceType, getLicenceSummary, getLicenceExceptions, LICENCE_KINDS,
  classifySoftwareCompliance, getSoftwareComplianceSummary, getSoftwareComplianceExceptions, SOFTWARE_KINDS,
  snapshotEffort,
  getEffortLeaderboard, getEffortTrend,
  FOLLOWUP_ACTIVE_STATES, FOLLOWUP_UNASSIGNED, FOLLOWUP_NO_COST, FOLLOWUP_NO_DATE,
  recordAssetSightings, getSiteAssetFollowups,
  DECISIONS, replaceExternalDevices, listExternalDevices, listImportRuns,
  setDecision, clearDecision, listDecisions,
  snapshotReconcile, getReconcileHistory, logImport, listImportLog,
};
