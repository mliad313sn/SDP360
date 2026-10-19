'use strict';
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pgrar-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

test('pg: report_asset_review upsert, getReport, delete', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) return t.skip('Postgres unreachable');
  try {
    process.env.PG_URL = ctx.url;
    const rdb = require('../reports-db');
    await rdb.initPgReports();
    await rdb.initPgReports();                       // 012 is idempotent
    const site = await rdb.createSite({ name: 'AssetSite', zoho_group: 'AssetSite IT' });
    const rep = await rdb.ensureReport(site.id, 2026, 30);
    assert.strictEqual(await rdb.getReportAssetReview(rep.id), null);
    await rdb.saveReportAssetReview(rep.id, { plan_note: 'p' }, 'u');
    await rdb.saveReportAssetReview(rep.id, { applicable: true, counts: { new: 1, unassigned: 0, no_cost: 2, no_date: 3 } }, 's');
    const r = (await rdb.getReport(rep.id)).asset_review;
    assert.deepStrictEqual([r.applicable, r.counts.no_date, r.plan_note], [true, 3, 'p']);
    await rdb.deleteReport(rep.id);
    assert.strictEqual(await rdb.getReportAssetReview(rep.id), null);
  } finally { await dropTestDb(ctx); }
});
