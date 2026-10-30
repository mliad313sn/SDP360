'use strict';
// Top-level async setup, run IN ORDER before the first test (PostgreSQL-only conversion, PO-08).
const __bootChain = (() => { let p = Promise.resolve(), hooked = false;
  return (fn) => { p = p.then(fn); if (!hooked) { hooked = true; require('node:test').beforeEach(() => p); } }; })();
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-sync-'));
const adb = require('../assets-db');
const { syncAssetView, syncAllAssets, ASSET_VIEWS } = require('../assets-sync');

let db;
__bootChain(async () => { db = adb.getDB(); });
const assetsDef = ASSET_VIEWS.find(v => v.name === 'assets');
const deps = (fetchView, markError = async () => {}) =>
  ({ fetchView, replaceTable: adb.replaceTable, countRows: adb.countRows, markSuccess: async () => {}, markError });

const rowsV1 = [{ 'Asset ID':'A1', 'State':'In Store', 'Purchase Cost($)':'0.00', 'Site':'MANA' },
                { 'Asset ID':'A2', 'State':'Discovered', 'Purchase Cost($)':'1,250,000.00', 'Site':'ITY' }];

test('full-replace inserts the mapped rows', async () => {
  await syncAssetView(assetsDef, deps(async () => ({ rows: rowsV1 })));
  const got = (await db.prepare('SELECT asset_id, state, purchase_cost, site FROM assets ORDER BY asset_id').all());
  assert.deepStrictEqual(got, [
    { asset_id:'A1', state:'In Store',   purchase_cost:'0.00',        site:'MANA' },
    { asset_id:'A2', state:'Discovered', purchase_cost:'1,250,000.00', site:'ITY' },
  ]);
});

test('full-replace REPLACES (a smaller second sync drops the vanished row)', async () => {
  await syncAssetView(assetsDef, deps(async () => ({ rows: [rowsV1[0]] })));
  assert.strictEqual((await db.prepare('SELECT COUNT(*) c FROM assets').get()).c, 1);
});

test('a failed fetch leaves the existing table UNTOUCHED and calls markError', async () => {
  let errored = false;
  await assert.rejects(async () => syncAssetView(assetsDef,
    deps(async () => { throw new Error('zoho down'); }, async () => { errored = true; })));
  assert.strictEqual((await db.prepare('SELECT COUNT(*) c FROM assets').get()).c, 1, 'table survives a failed fetch');
  assert.ok(errored, 'markError must be called');
});

test('C1: refuses to wipe a POPULATED table when the fetch returns 0 rows without throwing', async () => {
  // seed the table with real rows (an empty header-only CSV / transient AP glitch returns [] no-throw)
  await syncAssetView(assetsDef, deps(async () => ({ rows: rowsV1 })));
  assert.strictEqual((await db.prepare('SELECT COUNT(*) c FROM assets').get()).c, 2, 'seeded');
  let errored = false;
  await assert.rejects(
    () => syncAssetView(assetsDef, deps(async () => ({ rows: [] }), async () => { errored = true; })),
    /refusing to wipe/,
    'an empty fetch into a populated table must THROW, not silently empty it',
  );
  assert.strictEqual((await db.prepare('SELECT COUNT(*) c FROM assets').get()).c, 2,
    'the populated table SURVIVES the empty fetch — no silent data loss');
  assert.ok(errored, 'markError must be called (routed through the per-view isolation)');
});

test('C1: an empty fetch into an EMPTY table is ALLOWED (first-ever sync, writes nothing, no throw)', async () => {
  const memDef = ASSET_VIEWS.find(v => v.name === 'asset_memory');
  (await adb.replaceTable(memDef.table, Object.values(memDef.columns), []));   // ensure empty
  assert.strictEqual((await db.prepare('SELECT COUNT(*) c FROM asset_memory').get()).c, 0, 'starts empty');
  const n = await syncAssetView(memDef, deps(async () => ({ rows: [] })));
  assert.strictEqual(n, 0, 'wrote nothing');
  assert.strictEqual((await db.prepare('SELECT COUNT(*) c FROM asset_memory').get()).c, 0, 'still empty, no throw');
});

test('the licence transform keeps the cost as a RAW string', async () => {
  const licDef = ASSET_VIEWS.find(v => v.name === 'software_licenses');
  assert.strictEqual(typeof licDef.transform, 'function');
  const out = licDef.transform({ 'License ID':'L1', 'License State':'Expired',
    'Cost($)':'55,920.00', 'Expiry Date':'30 Jan 2025' }, {});
  assert.strictEqual(out.cost, '55,920.00');   // no numeric coercion
});

test('ASSET_VIEWS has exactly 6 entries', () => {
  assert.strictEqual(ASSET_VIEWS.length, 6);   // 5 Foundation views + software (C-2 Task 0)
});

test('syncAllAssets isolates a per-view failure — the other views still sync', async () => {
  const fetchView = async (viewId) => {
    // the assets view is the one that fails; every other view returns one valid row
    if (viewId === assetsDef.viewId) throw new Error('assets view down');
    return { rows: [_stubRowFor(viewId)] };
  };
  const summary = await syncAllAssets(deps(fetchView));
  assert.strictEqual(summary.length, 6, 'a summary entry per view');
  const failed = summary.find(s => s.name === 'assets');
  assert.ok(failed && failed.error, 'the assets view reports an error');
  const ok = summary.filter(s => typeof s.rows === 'number');
  assert.strictEqual(ok.length, 5, 'the other 5 views synced');
});

// build a stub Zoho row carrying EVERY header — asset_monitors' monitor_id is TEXT NOT NULL
// (composite PK), so a PK-only stub would violate the constraint and fail that view's insert.
function _stubRowFor(viewId) {
  const def = ASSET_VIEWS.find(v => v.viewId === viewId);
  const row = {};
  for (const zoho of Object.keys(def.columns)) row[zoho] = 'X';
  return row;
}
