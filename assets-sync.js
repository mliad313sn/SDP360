'use strict';
// fetchView is the server.js primitive, injected by init(): fetchView(viewId, maxRows) → { rows }.
// RECON FACT (2026-07-17): the AP /data endpoint ignores maxRows and returns the WHOLE view,
// or times out on a huge one (software_installations = 121k took 13.6 min → past fetchView's
// 120s cap, which is why it moved to sub-project C). So for A's 5 small views this is a plain
// single fetch that returns everything, fast. No truncation guard — the API doesn't truncate.
// The hardCap is only a data-gone-wrong tripwire (a view should not suddenly be 10x its size);
// a slow/huge view fails via fetchView's timeout (throws), and the engine (Task 2) keeps the
// table intact on any throw.
async function fetchAll(viewId, fetchView, { maxRows = 20000, hardCap = 50000 } = {}) {
  const { rows } = await fetchView(viewId, maxRows);   // maxRows passed but the API ignores it
  if (rows.length > hardCap) {
    throw new Error(`fetchAll(${viewId}): ${rows.length} rows exceeds the hard cap ${hardCap} — ` +
      `unexpectedly large for a Foundation view. Refusing to store; investigate before raising the cap.`);
  }
  return rows;
}

// ── Config-driven full-replace sync engine ─────────────────────────────────────
// Each ASSET_VIEWS entry declares a Zoho Analytics view -> a local table:
//   { name, job, table, viewId, pkCol, columns:{ 'Zoho Header':'snake_col' }, transform? }
// columns keys are the Zoho column headers; values are the snake_case DB columns (order = the
// column list handed to replaceTable). pkCol is the snake_col that MUST be non-null for a row to
// survive (drops the header row / blank rows). Every string is stored RAW — no currency/date
// coercion (purchase_cost/cost stay strings like '1,250,000.00'); a transform hook exists for
// later date/currency handling but Foundation ships identity/no-op transforms.

// Map one raw Zoho row -> a { snake_col: value } object. Values are trimmed strings, '' -> null.
const DEFAULT_MAP = (row, def) => {
  const out = {};
  for (const [zoho, col] of Object.entries(def.columns)) out[col] = (row[zoho] ?? '').toString().trim() || null;
  return def.transform ? def.transform(row, out) : out;
};

// Sync ONE view: fetch (before the tx, so a throw never empties the table) -> map -> drop
// PK-less rows -> full-replace in one transaction -> markSuccess. Any throw -> markError + rethrow.
async function syncAssetView(def, { fetchView, replaceTable, countRows, markSuccess, markError }) {
  try {
    const raw = await fetchAll(def.viewId, fetchView, { maxRows: def.maxRows || 20000 });
    const mapped = raw.map(r => DEFAULT_MAP(r, def)).filter(m => m[def.pkCol]);   // drop rows missing PK
    // C1 guard: a fetch that returns [] WITHOUT throwing (header-only CSV body, transient AP glitch,
    // a view mid-rescan) would otherwise DELETE the live table and insert nothing — total silent data
    // loss recorded as a clean sync. Refuse to full-replace a currently-POPULATED table with zero rows.
    // A first-ever sync (existing count 0) with an empty fetch is fine — it writes nothing.
    if (mapped.length === 0 && (await countRows(def.table)) > 0) {
      throw new Error(`${def.job}: fetch returned 0 rows but table has rows — refusing to wipe`);
    }
    const n = await replaceTable(def.table, Object.values(def.columns), mapped);  // DELETE+INSERT, one tx
    await markSuccess(def.job, n);
    return n;
  } catch (e) {
    await markError(def.job, e.message);   // table untouched — fetch/replace never completed
    throw e;
  }
}

// ── Server wiring (Task 4) ─────────────────────────────────────────────────────
// server.js calls init(fetchView, VIEWS) at boot, mirroring zoho-sync's init. The
// fetchView primitive is stashed here; VIEWS is accepted for signature parity but
// the view ids are self-contained in ASSET_VIEWS, so it's unused. The cron + the
// manual trigger call the no-arg syncAllAssets(), which builds live deps from the
// stashed fetchView + assets-db's replaceTable + reports-db's markSync* helpers.
let _fetchView = null;
function init(fetchView /*, VIEWS */) { _fetchView = fetchView; }

// Live deps for the no-arg convenience form. markSyncSuccess upserts the 5 job
// rows in sync_metadata on first run — no pre-seeding needed.
function _defaultDeps() {
  if (!_fetchView) throw new Error('assets-sync: init(fetchView) not called — no fetchView available');
  const adb = require('./assets-db');
  const rdb = require('./reports-db');
  return {
    fetchView:    _fetchView,
    replaceTable: adb.replaceTable,
    countRows:    adb.countRows,
    markSuccess:  rdb.markSyncSuccess,
    markError:    rdb.markSyncError,
  };
}

// Sync every view, each in its OWN try/catch so one view's failure never aborts the others.
// Returns a per-view summary: [{name, rows} | {name, error}].
// Tests pass explicit deps; server.js calls it no-arg (deps built from the stashed fetchView).
async function syncAllAssets(deps = _defaultDeps()) {
  const summary = [];
  for (const def of ASSET_VIEWS) {
    try {
      const rows = await syncAssetView(def, deps);
      summary.push({ name: def.name, rows });
    } catch (e) {
      console.error(`[assets-sync] view "${def.name}" failed: ${e.message}`);
      summary.push({ name: def.name, error: e.message });
    }
  }
  return summary;
}

// The 5 Foundation views — live Zoho Analytics view IDs, verified 2026-07-17.
const ASSET_VIEWS = [
  {
    name: 'assets', job: 'assets_assets', table: 'assets',
    viewId: '106803000000002058', pkCol: 'asset_id',
    columns: {
      'Asset ID': 'asset_id', 'Asset Name': 'asset_name', 'Product': 'product',
      'Product Type': 'product_type', 'Product Manufacturer': 'manufacturer', 'State': 'state',
      'Serial Number': 'serial_number', 'Barcode': 'barcode', 'Site': 'site', 'Site ID': 'site_id',
      'Asset Tag': 'asset_tag',
      'Purchase Cost($)': 'purchase_cost', 'Total Cost of Ownership($)': 'total_cost_of_ownership',
      'Operational Cost($)': 'operational_cost', 'Current Book Value($)': 'current_book_value',
      'Months Since Acquisition': 'months_since_acquisition',
      'Acquisition Date': 'acquisition_date',
      'Warranty Expiry': 'warranty_expiry', 'User': 'user_name', 'Department': 'department',
      'Last Successful Audit Time': 'last_successful_audit_time', 'Last Audit Status': 'last_audit_status',
      'Days Since Successful Scan': 'days_since_scan', 'Last Scan Source': 'last_scan_source',
      'Created Time': 'created_time',
    },
  },
  {
    name: 'asset_memory', job: 'assets_memory', table: 'asset_memory',
    viewId: '106803000000002066', pkCol: 'memory_module_id',
    columns: {
      'Memory Module ID': 'memory_module_id', 'Workstation ID': 'workstation_id',
      'Capacity (GB)': 'capacity_gb', 'Socket Label': 'socket_label', 'Module Tag': 'module_tag',
    },
  },
  {
    name: 'asset_logical_drives', job: 'assets_logical_drives', table: 'asset_logical_drives',
    viewId: '106803000000002064', pkCol: 'drive_id',
    columns: {
      'Drive ID': 'drive_id', 'Workstation ID': 'workstation_id', 'Logical Drive': 'drive_letter',
      'Drive Capacity (GB)': 'capacity_gb', 'Free Space (GB)': 'free_gb', 'Free Space (%)': 'free_pct',
      'File Type': 'file_type',
    },
  },
  {
    name: 'asset_monitors', job: 'assets_monitors', table: 'asset_monitors',
    viewId: '106803000000002067', pkCol: 'workstation_id',   // composite PK (workstation_id, monitor_id)
    columns: {
      'Workstation ID': 'workstation_id', 'Monitor ID': 'monitor_id', 'Monitor Type': 'monitor_type',
      'Manufacturer': 'manufacturer', 'Serial Number': 'serial_number',
    },
  },
  {
    name: 'software_licenses', job: 'assets_software_licenses', table: 'software_licenses',
    viewId: '106803000000002074', pkCol: 'license_id',
    columns: {
      'License ID': 'license_id', 'License Name': 'license_name', 'License Type': 'license_type',
      'License State': 'license_state', 'Expiry Date': 'expiry_date', 'Cost($)': 'cost',
      'Site': 'site', 'Vendor': 'vendor', 'Software ID': 'software_id',
      'License Option': 'license_option', 'Installations Allowed': 'installations_allowed',
      'Acquisition Date': 'acquisition_date', 'Organization License': 'organization_license',
    },
    // Re-derives `cost` as the RAW trimmed string straight from the Zoho row (no currency
    // coercion). Deliberately reads `row['Cost($)']` rather than trusting `out` so the transform
    // is self-contained when called directly (not only through DEFAULT_MAP). Exists so future
    // date/currency handling has a home without touching the engine.
    transform: (row, out) => ({ ...out, cost: (row['Cost($)'] ?? '').toString().trim() || null }),
  },
];

module.exports = { init, fetchAll, syncAssetView, syncAllAssets, ASSET_VIEWS, DEFAULT_MAP };
