'use strict';
// Top-level async setup, run IN ORDER before the first test (PostgreSQL-only conversion, PO-08).
const __bootChain = (() => { let p = Promise.resolve(), hooked = false;
  return (fn) => { p = p.then(fn); if (!hooked) { hooked = true; require('node:test').beforeEach(() => p); } }; })();
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(), 'rar-'));
process.env.DASH_USER = process.env.DASH_USER || 'rar-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'rar-pass-0000';
const test = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

let site;
__bootChain(async () => { site = (await rdb.listSites()).find(s => s.name === 'Hounde'); });
let rep;
__bootChain(async () => { rep = (await rdb.ensureReport(site.id, 2026, 30)); });

test('no row → getReportAssetReview null, getReport.asset_review null', async () => {
  assert.strictEqual((await rdb.getReportAssetReview(rep.id)), null);
  assert.strictEqual((await rdb.getReport(rep.id)).asset_review, null);
});

test('empty patch on a report with no row leaves null', async () => {
  const fresh = (await rdb.ensureReport(site.id, 2026, 32));
  (await rdb.saveReportAssetReview(fresh.id, {}, 'system'));
  assert.strictEqual((await rdb.getReportAssetReview(fresh.id)), null);
});

test('upsert notes then freeze counts — neither clobbers the other', async () => {
  (await rdb.saveReportAssetReview(rep.id, { handled_note: 'Tagged 3 PCs', plan_note: 'Order labels' }, 'coord'));
  (await rdb.saveReportAssetReview(rep.id, { applicable: true, counts: { new: 2, unassigned: 1, no_cost: 0, no_date: 4 } }, 'system'));
  const r = (await rdb.getReportAssetReview(rep.id));
  assert.deepStrictEqual(
    { applicable: r.applicable, counts: r.counts, handled_note: r.handled_note, plan_note: r.plan_note, updated_by: r.updated_by },
    { applicable: true, counts: { new: 2, unassigned: 1, no_cost: 0, no_date: 4 }, handled_note: 'Tagged 3 PCs', plan_note: 'Order labels', updated_by: 'system' });
  assert.match(r.updated_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('a patch with only `applicable` leaves counts and notes untouched', async () => {
  (await rdb.saveReportAssetReview(rep.id, { applicable: false }, 'coord'));
  const r = (await rdb.getReportAssetReview(rep.id));
  assert.strictEqual(r.applicable, false);
  assert.deepStrictEqual(r.counts, { new: 2, unassigned: 1, no_cost: 0, no_date: 4 });
  assert.strictEqual(r.handled_note, 'Tagged 3 PCs');
  assert.strictEqual(r.plan_note, 'Order labels');
});

test('counts:null is stored as null; applicable:false round-trips', async () => {
  (await rdb.saveReportAssetReview(rep.id, { applicable: false, counts: null }, 'system'));
  const r = (await rdb.getReportAssetReview(rep.id));
  assert.strictEqual(r.applicable, false);
  assert.strictEqual(r.counts, null);
  assert.strictEqual(r.handled_note, 'Tagged 3 PCs');
});

test('getReport carries asset_review', async () => {
  assert.strictEqual((await rdb.getReport(rep.id)).asset_review.plan_note, 'Order labels');
});

test('deleteReport removes the review row', async () => {
  const other = (await rdb.ensureReport(site.id, 2026, 31));
  (await rdb.saveReportAssetReview(other.id, { handled_note: 'x' }, 'u'));
  (await rdb.deleteReport(other.id));
  assert.strictEqual((await rdb.getReportAssetReview(other.id)), null);
});
