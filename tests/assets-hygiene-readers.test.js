// tests/assets-hygiene-readers.test.js  — seeds sqlite directly, then reads the
// six hygiene exception kinds + the completeness summary (Task 0, sub-project B).
'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hyg-'));
const adb = require('../assets-db');

const cols = ['asset_id', 'asset_name', 'product', 'product_type', 'manufacturer', 'state',
  'serial_number', 'barcode', 'asset_tag', 'site', 'site_id', 'purchase_cost', 'acquisition_date',
  'warranty_expiry', 'user_name', 'department', 'last_successful_audit_time',
  'last_audit_status', 'days_since_scan', 'last_scan_source', 'created_time'];

// A "clean" row (present-on-everything, in NO exception kind).
const base = {
  product: 'Laptop', product_type: 'Notebook', manufacturer: 'Dell', serial_number: 'SN',
  barcode: 'BC', site_id: 'S', purchase_cost: '1,250,000.00', acquisition_date: '2024-01-01',
  warranty_expiry: '2027-01-01', user_name: 'x', department: 'IT',
  last_successful_audit_time: '2026-07-15', last_audit_status: 'Success',
  days_since_scan: '2', last_scan_source: 'Agent', created_time: '2024-01-01', state: 'In Use',
};
const rows = [
  { ...base, asset_id: 'R1', asset_name: 'Asset R1', site: 'MANA' },                                   // clean
  { ...base, asset_id: 'R2', asset_name: 'Asset R2', site: 'HGO', state: 'Discovered' },               // discovered
  { ...base, asset_id: 'R3', asset_name: 'Asset R3', site: 'HGO', last_audit_status: 'Failed', last_successful_audit_time: '', days_since_scan: '5' },   // never_scanned (blank audit time)
  { ...base, asset_id: 'R4', asset_name: 'Asset R4', site: 'MANA', last_audit_status: 'Failed', last_successful_audit_time: '2026-01-01', days_since_scan: '120' }, // DISJOINTNESS: never_scanned ONLY (failing + stale, but never a success)
  { ...base, asset_id: 'R5', asset_name: 'Asset R5', site: 'SGO', last_audit_status: 'Success', last_successful_audit_time: '2026-01-01', days_since_scan: '120' }, // ghost (was healthy, now >90d)
  { ...base, asset_id: 'R6', asset_name: 'Asset R6', site: 'SGO', purchase_cost: '0.00' },             // no_cost (present-as-0.00, not NULL)
  { ...base, asset_id: 'R7', asset_name: 'Asset R7', site: 'MANA', acquisition_date: '', user_name: '', department: '' }, // no_age AND no_owner (genuinely empty)
  { ...base, asset_id: 'R8', asset_name: 'Asset R8', site: 'KGO', last_audit_status: 'Success', last_successful_audit_time: '', days_since_scan: '120' }, // CONTRADICTORY: status='Success' but no success-time. Under the OLD ghost predicate this double-fired (never_scanned via blank time + ghost via Success+>90d). Now ghost=NOT(never_scanned) → this is never_scanned ONLY.
  // Task 4 enrichment rows (ITAM training deck) — all on a NEW site (ABJ) and OTHERWISE clean,
  // so the pre-existing kinds' counts + MANA/HGO/SGO completeness are undisturbed.
  { ...base, asset_id: 'R9',  asset_name: 'Asset R9',  site: 'ABJ', barcode: '', asset_tag: '' },              // no_asset_tag (no QR AND no tag)
  { ...base, asset_id: 'R10', asset_name: 'Asset R10', site: 'ABJ', barcode: '', asset_tag: 'EDV-123' },       // TAGGED → EXCLUDED from no_asset_tag (asset_tag present)
  { ...base, asset_id: 'R11', asset_name: 'Asset R11', site: 'ABJ', state: 'In Repair' },                      // lifecycle_exception
];
adb.replaceTable('assets', cols, rows);

test('by_kind counts match the hand-computed seed', () => {
  const bk = adb.getHygieneSummary({}).by_kind;
  assert.strictEqual(bk.discovered, 1, 'R2');
  assert.strictEqual(bk.never_scanned, 3, 'R3 + R4 + R8');
  assert.strictEqual(bk.ghost, 1, 'R5');
  assert.strictEqual(bk.no_owner, 1, 'R7');
  assert.strictEqual(bk.no_age, 1, 'R7');
  assert.strictEqual(bk.no_cost, 1, 'R6');
  assert.strictEqual(adb.getHygieneSummary({}).total, 11);
});

test('Task 4 — no_asset_tag counts the untagged row and NOT the tagged one', () => {
  const bk = adb.getHygieneSummary({}).by_kind;
  assert.strictEqual(bk.no_asset_tag, 1, 'R9 only (R10 is tagged, existing rows carry a barcode)');
  const ids = adb.getHygieneExceptions('no_asset_tag', {}).map(r => r.asset_id);
  assert.deepStrictEqual(ids, ['R9'], 'exception rows = R9 only');
  assert.ok(!ids.includes('R10'), 'the tagged EDV-123 row is excluded');
});

test('Task 4 — lifecycle_exception counts the In-Repair row', () => {
  const bk = adb.getHygieneSummary({}).by_kind;
  assert.strictEqual(bk.lifecycle_exception, 1, 'R11');
  const rows = adb.getHygieneExceptions('lifecycle_exception', {});
  assert.deepStrictEqual(rows.map(r => r.asset_id), ['R11'], 'exception row = R11 (In Repair)');
});

test('Task 4 — completeness (by_site) is UNCHANGED by the two new kinds', () => {
  // The new kinds are NOT in _PRESENT_SELECT, and the ABJ rows are present-on-everything,
  // so the pinned MANA/HGO/SGO completeness numbers below stay exactly as sub-project B shipped.
  const bySite = adb.getHygieneSummary({}).by_site;
  const bs = Object.fromEntries(bySite.map(s => [s.site, s]));
  assert.strictEqual(bs.MANA.completeness, 75);
  assert.strictEqual(bs.HGO.completeness, 87.5);
  assert.strictEqual(bs.SGO.completeness, 87.5);
  assert.strictEqual(bs.ABJ.completeness, 100);   // the 3 new rows are all clean
});

test('ghost === over90 on ALL data — single-sourced NOT(never_scanned) AND >90d', () => {
  const s = adb.getHygieneSummary({});
  // by_kind.ghost (a COUNT over ghost.where) and scan_freshness.over90 (a SUM in the
  // freshness SELECT) are now the SAME expression, so they reconcile on every dataset —
  // including the contradictory R8, which lands in never_scanned and in NEITHER of these.
  assert.strictEqual(s.by_kind.ghost, s.scan_freshness.over90);
  assert.strictEqual(s.by_kind.ghost, 1, 'R5 only');
});

test('contradictory row (Success + blank success-time + >90d) is never_scanned ONLY', () => {
  const never = adb.getHygieneExceptions('never_scanned', {}).map(r => r.asset_id);
  const ghost = adb.getHygieneExceptions('ghost', {}).map(r => r.asset_id);
  assert.ok(never.includes('R8'), 'R8 lands in never_scanned (blank success-time wins)');
  assert.ok(!ghost.includes('R8'), 'R8 is NOT double-listed in ghost');
});

test('ghost and never_scanned are DISJOINT by construction (R4 proves it)', () => {
  const ghost = adb.getHygieneExceptions('ghost', {});
  assert.deepStrictEqual(ghost.map(r => r.asset_id), ['R5'], 'ghost is R5 only — NOT R3/R4');

  const never = adb.getHygieneExceptions('never_scanned', {}).map(r => r.asset_id);
  assert.ok(never.includes('R3') && never.includes('R4'), 'never_scanned holds R3 AND the stale-failing R4');
  assert.ok(!never.includes('R5'), 'the healthy-but-stale R5 is ghost, never never_scanned');
  // R4 is failing AND >90d — it lands in never_scanned, NEVER in ghost.
  assert.ok(!ghost.map(r => r.asset_id).includes('R4'));
});

test('no_cost fires on 0.00 via IN (…), not IS NULL', () => {
  const nc = adb.getHygieneExceptions('no_cost', {});
  assert.deepStrictEqual(nc.map(r => r.asset_id), ['R6']);
});

test('an unknown kind throws — never a silent empty', () => {
  assert.throws(() => adb.getHygieneExceptions('nonsense', {}), /unknown/i);
});

test('exception rows never carry a cost amount', () => {
  for (const r of adb.getHygieneExceptions('never_scanned', {})) {
    assert.ok(!('purchase_cost' in r), 'no money in the hygiene worklist');
  }
});

test('by_site completeness — mixed site is the computed mean, present attribute reads 100', () => {
  const bySite = adb.getHygieneSummary({}).by_site;
  const bs = Object.fromEntries(bySite.map(s => [s.site, s]));

  assert.strictEqual(bs.MANA.total, 3);
  assert.strictEqual(bs.MANA.completeness, 75);     // (100 + 66.7 + 66.7 + 66.7)/4
  assert.strictEqual(bs.MANA.cost_pct, 100);        // all 3 MANA rows have cost

  assert.strictEqual(bs.HGO.total, 2);
  assert.strictEqual(bs.HGO.completeness, 87.5);    // scan 50, rest 100
  assert.strictEqual(bs.HGO.scan_pct, 50);          // R3 never scanned
  assert.strictEqual(bs.HGO.owner_pct, 100);        // present attribute → 100

  assert.strictEqual(bs.SGO.total, 2);
  assert.strictEqual(bs.SGO.completeness, 87.5);    // cost 50, rest 100
  assert.strictEqual(bs.SGO.cost_pct, 50);          // R6 is 0.00
});

test('M-4 reconciliation — Σ_site(present) + by_kind[gap] === total, per gap kind', () => {
  const s = adb.getHygieneSummary({});
  const sum = (k) => s.by_site.reduce((a, r) => a + r[k], 0);
  // present-count per attribute is derived independently from the by_kind COUNT,
  // so equality here proves the two SQL paths agree (not a tautology).
  assert.strictEqual(s.by_kind.no_cost, s.total - sum('cost_present'));
  assert.strictEqual(s.by_kind.no_age, s.total - sum('age_present'));
  assert.strictEqual(s.by_kind.no_owner, s.total - sum('owner_present'));
  assert.strictEqual(s.by_kind.never_scanned, s.total - sum('scan_present'));
});

test('a site filter narrows the whole summary', () => {
  const s = adb.getHygieneSummary({ site: 'MANA' });
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.by_site.length, 1);
  assert.strictEqual(s.by_site[0].site, 'MANA');
  assert.strictEqual(s.by_kind.never_scanned, 1);   // only R4 under MANA
  assert.strictEqual(s.by_kind.discovered, 0);
});
