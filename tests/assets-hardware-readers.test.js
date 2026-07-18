// tests/assets-hardware-readers.test.js — seeds sqlite directly, then reads the
// four hardware-health worklist kinds + the summary (Task 0, sub-project D).
// Count-based, NO money. Real-monitor count uses a camera/virtual denylist.
'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-'));
const adb = require('../assets-db');

// ── assets ─────────────────────────────────────────────────────────────────
const aCols = ['asset_id', 'asset_name', 'product', 'product_type', 'manufacturer', 'state',
  'serial_number', 'site', 'site_id', 'purchase_cost', 'current_book_value',
  'months_since_acquisition', 'acquisition_date'];
const abase = {
  product: 'Machine', manufacturer: 'Dell', serial_number: 'SN', site_id: 'S',
  purchase_cost: '1,250,000.00', current_book_value: '900,000.00', acquisition_date: '2022-01-01',
  state: 'In Use',
};
const assets = [
  // M1 — Laptop, 4 GB RAM, C: 5% free, 40 months old; real monitor present (Dell) + a webcam.
  { ...abase, asset_id: 'M1', asset_name: 'Asset M1', site: 'MANA', product_type: 'Laptop', months_since_acquisition: '40' },
  // M2 — Desktop, 16 GB, C: 60% free, 10 months; only a HyperVMonitor → 0 real.
  { ...abase, asset_id: 'M2', asset_name: 'Asset M2', site: 'MANA', product_type: 'Desktop', months_since_acquisition: '10' },
  // M3 — Server, 8 GB, C: 45% free, 70 months; NO monitors (headless by design).
  { ...abase, asset_id: 'M3', asset_name: 'Asset M3', site: 'HGO', product_type: 'Server', months_since_acquisition: '70' },
  // M4 — Laptop, 16 GB, C: 50% free, 5 months; only a webcam → 0 real (clean workstation positive).
  { ...abase, asset_id: 'M4', asset_name: 'Asset M4', site: 'MANA', product_type: 'Laptop', months_since_acquisition: '5' },
];
adb.replaceTable('assets', aCols, assets);

// ── asset_memory (SUM(capacity_gb) → ram_total_gb) ──────────────────────────
adb.replaceTable('asset_memory', ['memory_module_id', 'workstation_id', 'capacity_gb'], [
  { memory_module_id: 'm1a', workstation_id: 'M1', capacity_gb: '2' },   // M1 = 2 + 2 = 4 GB (exercises SUM)
  { memory_module_id: 'm1b', workstation_id: 'M1', capacity_gb: '2' },
  { memory_module_id: 'm2a', workstation_id: 'M2', capacity_gb: '16' },
  { memory_module_id: 'm3a', workstation_id: 'M3', capacity_gb: '8' },
  { memory_module_id: 'm4a', workstation_id: 'M4', capacity_gb: '16' },
]);

// ── asset_logical_drives (C: free_pct → system_disk_free_pct) ───────────────
adb.replaceTable('asset_logical_drives',
  ['drive_id', 'workstation_id', 'drive_letter', 'capacity_gb', 'free_gb', 'free_pct'], [
    { drive_id: 'd1', workstation_id: 'M1', drive_letter: 'C:', capacity_gb: '256', free_gb: '12', free_pct: '5%' }, // '%' coercion
    { drive_id: 'd2', workstation_id: 'M2', drive_letter: 'C:', capacity_gb: '512', free_gb: '300', free_pct: '60' },
    { drive_id: 'd3', workstation_id: 'M3', drive_letter: 'C:', capacity_gb: '512', free_gb: '230', free_pct: '45' },
    { drive_id: 'd4', workstation_id: 'M4', drive_letter: 'C:', capacity_gb: '512', free_gb: '256', free_pct: '50' },
  ]);

// ── asset_monitors (denylist chain → real_monitor_count) ────────────────────
adb.replaceTable('asset_monitors', ['workstation_id', 'monitor_id', 'monitor_type'], [
  { workstation_id: 'M1', monitor_id: 'mon1', monitor_type: 'Dell U2419H' },        // REAL
  { workstation_id: 'M1', monitor_id: 'mon2', monitor_type: 'Integrated Webcam' },  // denylisted
  { workstation_id: 'M1', monitor_id: 'mon3', monitor_type: '' },                   // empty → NOT real (`<> ''` guard)
  { workstation_id: 'M2', monitor_id: 'mon1', monitor_type: 'HyperVMonitor' },      // denylisted → 0 real
  { workstation_id: 'M4', monitor_id: 'mon1', monitor_type: 'Integrated Webcam' },  // denylisted → 0 real
]);

test('by_kind counts match the hand-computed seed', () => {
  const bk = adb.getHardwareHealthSummary({}).by_kind;
  assert.strictEqual(bk.low_ram, 1, 'M1 (4<8); M3 is exactly 8 (excluded), ram==0 excluded');
  assert.strictEqual(bk.full_disk, 1, 'M1 (5<10); null free is NOT flagged');
  assert.strictEqual(bk.refresh_due, 2, 'M1 (Laptop 40>=36) + M3 (Server 70>=60)');
  assert.strictEqual(bk.no_real_monitor, 2, 'M2 + M4 (workstation type + 0 real); M3 Server NOT counted; M1 has a real Dell');
  assert.strictEqual(adb.getHardwareHealthSummary({}).total, 4);
});

test('real-monitor denylist — Dell counts, camera/webcam/HyperV/empty do not', () => {
  const exc = adb.getHardwareHealthExceptions('no_real_monitor', {});
  // M2 + M4 both have 0 real monitors.
  assert.deepStrictEqual(exc.map(r => r.asset_id).sort(), ['M2', 'M4']);
  for (const r of exc) assert.strictEqual(Number(r.real_monitor_count), 0);
  // M1: Dell real=1 even though a webcam AND an empty-type row sit alongside it.
  const lr = adb.getHardwareHealthExceptions('low_ram', {});
  const m1 = lr.find(r => r.asset_id === 'M1');
  assert.strictEqual(Number(m1.real_monitor_count), 1, 'Dell only; webcam + empty-type excluded');
});

test('summary monitors block — with_real + avg_real (over ALL machines)', () => {
  const m = adb.getHardwareHealthSummary({}).monitors;
  assert.strictEqual(m.with_real, 1, 'M1 only has >=1 real monitor');
  // avg_real = mean real_monitor_count across ALL machines = (1+0+0+0)/4 = 0.25.
  assert.strictEqual(m.avg_real, 0.25);
});

test('per-site rollup present with per-kind counts', () => {
  const bySite = adb.getHardwareHealthSummary({}).by_site;
  const bs = Object.fromEntries(bySite.map(s => [s.site, s]));
  assert.strictEqual(bs.MANA.total, 3);
  assert.strictEqual(bs.MANA.low_ram, 1);
  assert.strictEqual(bs.MANA.full_disk, 1);
  assert.strictEqual(bs.MANA.refresh_due, 1);
  assert.strictEqual(bs.MANA.no_real_monitor, 2);
  assert.strictEqual(bs.HGO.total, 1);
  assert.strictEqual(bs.HGO.refresh_due, 1);
  assert.strictEqual(bs.HGO.no_real_monitor, 0, 'the HGO Server is headless-by-design, never flagged');
});

test('exceptions per kind return the right machines', () => {
  const ids = (kind) => adb.getHardwareHealthExceptions(kind, {}).map(r => r.asset_id).sort();
  assert.deepStrictEqual(ids('low_ram'), ['M1']);
  assert.deepStrictEqual(ids('full_disk'), ['M1']);
  assert.deepStrictEqual(ids('refresh_due'), ['M1', 'M3']);
  assert.deepStrictEqual(ids('no_real_monitor'), ['M2', 'M4']);
});

test('an unknown kind throws — never a silent empty', () => {
  assert.throws(() => adb.getHardwareHealthExceptions('bad', {}), /unknown/i);
});

test('exception rows carry identity + health fields but NO money', () => {
  for (const kind of ['low_ram', 'full_disk', 'refresh_due', 'no_real_monitor']) {
    for (const r of adb.getHardwareHealthExceptions(kind, {})) {
      assert.ok(!('purchase_cost' in r), `no purchase_cost in ${kind} worklist`);
      assert.ok(!('current_book_value' in r), `no current_book_value in ${kind} worklist`);
      assert.ok('asset_name' in r && 'site' in r);
      assert.ok('ram_total_gb' in r && 'system_disk_free_pct' in r);
      assert.ok('real_monitor_count' in r && 'months_since_acquisition' in r);
    }
  }
});

test('the % free-pct is coerced (M1 C: = "5%" → 5, flagged full_disk)', () => {
  const m1 = adb.getHardwareHealthExceptions('full_disk', {}).find(r => r.asset_id === 'M1');
  assert.strictEqual(Number(m1.system_disk_free_pct), 5);
});

test('a site filter narrows the whole summary', () => {
  const s = adb.getHardwareHealthSummary({ site: 'MANA' });
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.by_site.length, 1);
  assert.strictEqual(s.by_site[0].site, 'MANA');
  assert.strictEqual(s.by_kind.refresh_due, 1, 'only M1 under MANA (M3 Server is HGO)');
  assert.strictEqual(s.by_kind.no_real_monitor, 2);
  const exc = adb.getHardwareHealthExceptions('refresh_due', { site: 'MANA' }).map(r => r.asset_id);
  assert.deepStrictEqual(exc, ['M1']);
});
