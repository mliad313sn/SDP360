'use strict';
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(), 'rar-'));
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'rar-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'rar-pass-0000';
const test = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

const site = rdb.listSites().find(s => s.name === 'Hounde');
const rep = rdb.ensureReport(site.id, 2026, 30);

test('no row → getReportAssetReview null, getReport.asset_review null', () => {
  assert.strictEqual(rdb.getReportAssetReview(rep.id), null);
  assert.strictEqual(rdb.getReport(rep.id).asset_review, null);
});

test('upsert notes then freeze counts — neither clobbers the other', () => {
  rdb.saveReportAssetReview(rep.id, { handled_note: 'Tagged 3 PCs', plan_note: 'Order labels' }, 'coord');
  rdb.saveReportAssetReview(rep.id, { applicable: true, counts: { new: 2, unassigned: 1, no_cost: 0, no_date: 4 } }, 'system');
  const r = rdb.getReportAssetReview(rep.id);
  assert.deepStrictEqual(
    { applicable: r.applicable, counts: r.counts, handled_note: r.handled_note, plan_note: r.plan_note, updated_by: r.updated_by },
    { applicable: true, counts: { new: 2, unassigned: 1, no_cost: 0, no_date: 4 }, handled_note: 'Tagged 3 PCs', plan_note: 'Order labels', updated_by: 'system' });
  assert.match(r.updated_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('counts:null is stored as null; applicable:false round-trips', () => {
  rdb.saveReportAssetReview(rep.id, { applicable: false, counts: null }, 'system');
  const r = rdb.getReportAssetReview(rep.id);
  assert.strictEqual(r.applicable, false);
  assert.strictEqual(r.counts, null);
  assert.strictEqual(r.handled_note, 'Tagged 3 PCs');
});

test('getReport carries asset_review', () => {
  assert.strictEqual(rdb.getReport(rep.id).asset_review.plan_note, 'Order labels');
});

test('deleteReport removes the review row', () => {
  const other = rdb.ensureReport(site.id, 2026, 31);
  rdb.saveReportAssetReview(other.id, { handled_note: 'x' }, 'u');
  rdb.deleteReport(other.id);
  assert.strictEqual(rdb.getReportAssetReview(other.id), null);
});
