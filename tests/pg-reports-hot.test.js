'use strict';
// Chunk 4D-1 — reports.db hot-path load layer → PostgreSQL. TDD suite. Runs the
// postgres backend against a throwaway DB; skips cleanly when Postgres is down.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'rhot-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const { makePgDb } = require('../services/pgDb');
const SCHEMA4 = _fs.readFileSync(_path.join(__dirname, '../db/postgres/reports/004_hot.sql'), 'utf8');

async function boot() {
  const ctx = await provisionTestDb();
  if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  return { ctx, rdb };
}

test('hot pg: schema idempotent + sync_metadata seeded', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    await rdb.pgHandle().exec(SCHEMA4);   // re-apply → idempotent
    // Raw count (getSyncStatus isn't forked until Task 2; reading it now would
    // hit the sqlite path = false green).
    const n = Number((await rdb.pgHandle().prepare('SELECT COUNT(*) AS n FROM sync_metadata').get()).n);
    assert.equal(n, 4, '4 sync jobs seeded in pg');
    assert.ok((await rdb.pgHandle().prepare("SELECT to_regclass('public.request_records') AS t").get()).t, 'request_records exists');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
