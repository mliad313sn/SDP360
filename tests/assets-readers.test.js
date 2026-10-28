// tests/assets-readers.test.js  — seeds PostgreSQL directly, then reads
'use strict';
// Top-level async setup, run IN ORDER before the first test (PostgreSQL-only conversion, PO-08).
const __bootChain = (() => { let p = Promise.resolve(), hooked = false;
  return (fn) => { p = p.then(fn); if (!hooked) { hooked = true; require('node:test').beforeEach(() => p); } }; })();
const test = require('node:test');
const assert = require('node:assert');
const os=require('node:os'), path=require('node:path'), fs=require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'assets-rd-'));
const adb = require('../assets-db');
const db = adb.getDB();
__bootChain(async () => {
await db.prepare("INSERT INTO assets (asset_id,asset_name,state,site,purchase_cost) VALUES ('A1','L1','In Store','MANA','0.00'),('A2','L2','In Store','ITY','1,250,000.00')").run();
await db.prepare("INSERT INTO asset_memory (memory_module_id,workstation_id,capacity_gb) VALUES ('m1','A1','8'),('m2','A1','8')").run();
await db.prepare("INSERT INTO asset_logical_drives (drive_id,workstation_id,drive_letter,capacity_gb,free_pct) VALUES ('d1','A1','C:','476','12'),('d2','A1','D:','200','90')").run();
await db.prepare("INSERT INTO asset_monitors (workstation_id,monitor_id,monitor_type) VALUES ('A1','1','Integrated Monitor'),('A1','2','Intel(R) AVStream Camera')").run();
await db.prepare("INSERT INTO asset_memory (memory_module_id,workstation_id,capacity_gb) VALUES ('mX','ORPHAN','16')").run();  // orphan component
});

test('getEnrichedAssets joins RAM (sum), the C: drive, and a RAW monitor count', async () => {
  const rows = (await adb.getEnrichedAssets({}));
  const a1 = rows.find(r => r.asset_id === 'A1');
  assert.strictEqual(a1.ram_total_gb, 16);
  assert.strictEqual(a1.system_disk_free_pct, 12);   // the C: drive, not D:
  assert.strictEqual(a1.monitor_count, 2);           // RAW — includes the camera; NOT split
});

test('an orphan component does not create a phantom asset', async () => {
  const rows = (await adb.getEnrichedAssets({}));
  assert.ok(!rows.some(r => r.asset_id === 'ORPHAN'));
  assert.strictEqual(rows.length, 2);
});

test('the no-cost predicate matches 0.00 rows (NOT via IS NULL)', async () => {
  const noCost = (await adb.getEnrichedAssets({})).filter(r => ['0.00','0',''].includes(r.purchase_cost));
  assert.strictEqual(noCost.length, 1);
  assert.strictEqual(noCost[0].asset_id, 'A1');
});

test('filters narrow by site/state', async () => {
  assert.strictEqual((await adb.getEnrichedAssets({ site: 'ITY' })).length, 1);
  assert.strictEqual((await adb.getEnrichedAssets({ site: 'NOPE' })).length, 0);
});
