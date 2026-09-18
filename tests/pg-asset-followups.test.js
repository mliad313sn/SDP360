'use strict';
// Asset engagement — assets layer on PostgreSQL. Throwaway DB; skips cleanly when PG is down.
process.env.ASSETS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pgafu-'));
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

let ctx = null, adb = null;
async function boot() {
  if (adb) return adb;
  ctx = await provisionTestDb();
  if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  adb = require('../assets-db');
  await adb.initPgAssets();
  return adb;
}
const COLS = ['asset_id', 'asset_name', 'site', 'state', 'user_name', 'department', 'purchase_cost', 'acquisition_date'];

test('pg: sightings — empty no-op, baseline, new id, idempotent', async (t) => {
  const a = await boot();
  if (!a) return t.skip('Postgres unreachable');
  await a.replaceTable('assets', COLS, []);
  assert.strictEqual((await a.recordAssetSightings({ asOf: '2026-07-20' })).inserted, 0);
  await a.replaceTable('assets', COLS, [{ asset_id: 'A1', asset_name: 'PC-1', site: 'Hounde', state: 'In Use' }]);
  const b = await a.recordAssetSightings({ asOf: '2026-07-20' });
  assert.deepStrictEqual([b.baseline, b.inserted], [true, 1]);
  await a.replaceTable('assets', COLS, [
    { asset_id: 'A1', asset_name: 'PC-1', site: 'Hounde', state: 'In Use' },
    { asset_id: 'A2', asset_name: 'PC-2', site: 'Hounde', state: 'In Use' },
  ]);
  const n = await a.recordAssetSightings({ asOf: '2026-07-28' });
  assert.deepStrictEqual([n.baseline, n.inserted], [false, 1]);
  assert.strictEqual((await a.recordAssetSightings({ asOf: '2026-07-28' })).inserted, 0);
});

test('pg: teardown', async () => { if (ctx) await dropTestDb(ctx); });
