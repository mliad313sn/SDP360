// tests/asset-followups-share.test.js — G-05 (audit 2026-09-24).
//
// The production baseline, taken the day this shipped:
//
//     MANA      474 actifs   465 sans utilisateur (98%)
//     Sabodala  414 actifs   414 sans utilisateur (100%)
//     TOTAL    2279 actifs  2139 sans utilisateur (94%)
//
// A counter that equals the whole fleet cannot tell a coordinator what to do next, and
// the weekly change it is supposed to show (−5 out of 465) is invisible. Two additions,
// both PURELY ADDITIVE — the four frozen counts keep their exact meaning, so every
// comparison against a report submitted before today still holds:
//
//   - `active_total`, the denominator, so a count can be read as a share;
//   - the unassigned list split by state: "In Use" with nobody on it is an ANOMALY to
//     chase, "In Store" with nobody on it is the normal condition of a stockroom
//     (at Mana most of the fleet is In Store — the audit's own note).
'use strict';
// Top-level async setup, run IN ORDER before the first test (PostgreSQL-only conversion, PO-08).
const __bootChain = (() => { let p = Promise.resolve(), hooked = false;
  return (fn) => { p = p.then(fn); if (!hooked) { hooked = true; require('node:test').beforeEach(() => p); } }; })();
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'folshare-'));
const adb = require('../assets-db');

const COLS = ['asset_id', 'asset_name', 'site', 'state', 'user_name', 'department',
  'acquisition_date', 'purchase_cost', 'barcode', 'product_type', 'manufacturer', 'serial_number'];
const a = (id, state, over = {}) => ({
  asset_id: id, asset_name: 'PC-' + id, site: 'MANA', state,
  user_name: '', department: '', acquisition_date: '', purchase_cost: '0.00',
  barcode: '', product_type: 'Workstation', manufacturer: 'Dell', serial_number: 'SN' + id,
  ...over,
});

__bootChain(async () => { (await adb.replaceTable('assets', COLS, [
  a('1', 'In Use'),                                   // no user: an anomaly
  a('2', 'In Use', { user_name: 'someone' }),         // fine
  a('3', 'In Store'),                                 // no user: normal for a stockroom
  a('4', 'In Store'),
  a('5', 'In Repair'),
  a('6', 'Expired', { user_name: 'x' }),              // not an active state at all
])); });

let f;
__bootChain(async () => { f = (await adb.getSiteAssetFollowups(['MANA'])); });

test('the denominator travels with the counters', () => {
  assert.strictEqual(f.counts.active_total, 5, 'In Use + In Store + In Repair, not Expired');
});

test('the four frozen counters keep their exact meaning', () => {
  assert.strictEqual(f.counts.unassigned, 4, 'every active asset with no user_name');
  assert.strictEqual(f.counts.no_date, 5);
  assert.strictEqual(f.counts.no_cost, 5);
  assert.strictEqual(f.counts.no_tag, 5);
});

test('unassigned splits into the anomaly and the normal backlog', () => {
  assert.strictEqual(f.counts.unassigned_in_use, 1, 'In Use with nobody on it — chase this');
  assert.strictEqual(f.counts.unassigned_other, 3, 'In Store / In Repair — normal, still counted');
  assert.strictEqual(f.counts.unassigned_in_use + f.counts.unassigned_other, f.counts.unassigned,
    'the split adds back up to the number that gets frozen');
});

test('a site with no labels reads zeros, not nulls, and still carries the shape', async () => {
  const empty = (await adb.getSiteAssetFollowups([]));
  assert.strictEqual(empty.counts.active_total, 0);
  assert.strictEqual(empty.counts.unassigned_in_use, 0);
  assert.strictEqual(empty.counts.unassigned_other, 0);
});
