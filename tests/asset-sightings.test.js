// tests/asset-sightings.test.js — first-sightings table: empty assets → no-op,
// first run = baseline, later runs add only unseen ids, same-day re-run idempotent,
// existing rows never updated.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-'));
const adb = require('../assets-db');

const COLS = ['asset_id', 'asset_name', 'site', 'state'];
const seen = async () => (await adb.getDB().prepare('SELECT * FROM asset_first_seen ORDER BY asset_id').all());

test('empty assets table → no-op (no baseline taken)', async () => {
  (await adb.replaceTable('assets', COLS, []));
  const r = (await adb.recordAssetSightings({ asOf: '2026-07-20' }));
  assert.strictEqual(r.inserted, 0);
  assert.strictEqual((await seen()).length, 0, 'a baseline on an empty register would mark every later asset "new"');
});

test('first run with assets = baseline (baseline=1 for every asset)', async () => {
  (await adb.replaceTable('assets', COLS, [
    { asset_id: 'A1', asset_name: 'PC-1', site: 'Hounde', state: 'In Use' },
    { asset_id: 'A2', asset_name: 'PC-2', site: 'MANA', state: 'In Store' },
  ]));
  const r = (await adb.recordAssetSightings({ asOf: '2026-07-20' }));
  assert.strictEqual(r.baseline, true);
  assert.strictEqual(r.inserted, 2);
  assert.deepStrictEqual((await seen()).map(x => [x.asset_id, x.site, x.first_seen_date, x.baseline]),
    [['A1', 'Hounde', '2026-07-20', 1], ['A2', 'MANA', '2026-07-20', 1]]);
});

test('second run adds only the new id with baseline=0; existing rows untouched', async () => {
  (await adb.replaceTable('assets', COLS, [
    { asset_id: 'A1', asset_name: 'PC-1', site: 'Sabodala', state: 'In Use' },   // moved site
    { asset_id: 'A2', asset_name: 'PC-2', site: 'MANA', state: 'In Store' },
    { asset_id: 'A3', asset_name: 'PC-3', site: 'Hounde', state: 'In Use' },
  ]));
  const r = (await adb.recordAssetSightings({ asOf: '2026-07-28' }));
  assert.strictEqual(r.baseline, false);
  assert.strictEqual(r.inserted, 1);
  const rows = (await seen());
  assert.deepStrictEqual(rows.find(x => x.asset_id === 'A3'),
    { asset_id: 'A3', site: 'Hounde', first_seen_date: '2026-07-28', baseline: 0 });
  assert.strictEqual(rows.find(x => x.asset_id === 'A1').site, 'Hounde', 'first-sighting site is never rewritten');
  assert.strictEqual(rows.find(x => x.asset_id === 'A1').first_seen_date, '2026-07-20');
});

test('same-day re-run is idempotent', async () => {
  const r = (await adb.recordAssetSightings({ asOf: '2026-07-28' }));
  assert.strictEqual(r.inserted, 0);
  assert.strictEqual((await seen()).length, 3);
});

test('default asOf is the UTC date', async () => {
  (await adb.replaceTable('assets', COLS, [{ asset_id: 'A4', asset_name: 'PC-4', site: 'Hounde', state: 'In Use' }]));
  const r = (await adb.recordAssetSightings({}));
  assert.strictEqual(r.date, new Date().toISOString().slice(0, 10));
});
