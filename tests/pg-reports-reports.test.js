'use strict';
// Chunk 4C — reports.db report-editor layer → PostgreSQL. TDD suite. Runs the
// postgres backend against a throwaway DB; skips cleanly when Postgres is down.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'rrep-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const { makePgDb } = require('../services/pgDb');
const SCHEMA3 = _fs.readFileSync(_path.join(__dirname, '../db/postgres/reports/003_reports.sql'), 'utf8');

async function boot() {
  const ctx = await provisionTestDb();
  if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  // Every report needs a site_id — create one via the forked 4B createSite.
  const site = await rdb.createSite({ name: 'TestSite', zoho_group: 'TestSite IT' });
  return { ctx, rdb, siteId: site.id };
}

test('reports pg: schema idempotent + catalog tables present', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    await rdb.pgHandle().exec(SCHEMA3);   // re-apply → idempotent
    const h = rdb.pgHandle();
    assert.equal(Number((await h.prepare('SELECT COUNT(*) AS n FROM infra_kpi_catalog').get()).n), 0);
    assert.ok((await h.prepare("SELECT to_regclass('public.weekly_reports') AS t").get()).t, 'weekly_reports exists');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
