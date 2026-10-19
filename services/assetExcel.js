'use strict';

// Assets Excel export — wraps the shared multi-sheet builder (services/tableExcel.js)
// into TWO sheets with a stable contract:
//
//   buildAssetWorkbook(assetRows, softwareRows) -> Buffer
//
//   • 'Assets'             — one row per enriched asset (a curated column set).
//   • 'Installed Software' — one row per software installation.
//
// The Foundation has NO software_installations table (it moved to sub-project C),
// so the route always passes `softwareRows = []` for now. The sheet is emitted
// anyway (empty → a single "(no rows)" cell, per tableExcel) so the workbook
// contract stays stable for sub-project C when software lands.
//
// Column choices: identity + config health (RAM, C: free %, monitors) + scan
// freshness. purchase_cost, if present, ships as the RAW string — NO currency
// formatting (this is a fleet inventory export, not a finance report).

const tableExcel = require('./tableExcel');

// Curated, ordered Assets columns. json_to_sheet keys off the FIRST row's key
// order, so we project every asset row through this fixed shape — a stable
// header row regardless of which enriched fields a given row happens to carry.
//
// Each entry is [headerKey, sourceField]. Identity/config columns keep their raw
// field name as the header (stable contract). The finance + owner columns carry
// a human-readable header mapping to the source field — money is the USD-CONVERTED
// number the route computed (purchase_cost_usd/…), NOT the raw XOF string. No `$`
// glyph is needed in a spreadsheet cell; the value is a plain USD number.
const ASSET_COLUMNS = [
  ['asset_id', 'asset_id'],
  ['asset_name', 'asset_name'],
  ['product', 'product'],
  ['product_type', 'product_type'],
  ['manufacturer', 'manufacturer'],
  ['site', 'site'],
  ['state', 'state'],
  ['serial_number', 'serial_number'],
  ['ram_total_gb', 'ram_total_gb'],
  ['system_disk_gb', 'system_disk_gb'],
  ['system_disk_free_pct', 'system_disk_free_pct'],
  ['monitor_count', 'monitor_count'],
  ['days_since_scan', 'days_since_scan'],
  ['last_scan_source', 'last_scan_source'],
  ['Acquisition Date', 'acquisition_date'],
  ['User', 'user_name'],
  ['Department', 'department'],
  ['Purchase (USD)', 'purchase_cost_usd'],   // USD-converted number (route computed)
  ['Book value (USD)', 'book_value_usd'],
  ['TCO (USD)', 'tco_usd'],
];

function _projectAsset(r) {
  const out = {};
  for (const [header, field] of ASSET_COLUMNS) out[header] = r == null ? null : (r[field] ?? null);
  return out;
}

function buildAssetWorkbook(assetRows, softwareRows) {
  const assets = (Array.isArray(assetRows) ? assetRows : []).map(_projectAsset);
  const software = Array.isArray(softwareRows) ? softwareRows : [];
  return tableExcel.buildWorkbook([
    { name: 'Assets',             rows: assets },
    { name: 'Installed Software', rows: software },
  ]);
}

module.exports = { buildAssetWorkbook, ASSET_COLUMNS };
