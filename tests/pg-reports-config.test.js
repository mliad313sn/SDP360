'use strict';
// Chunk 4B — reports.db config/sites → PostgreSQL. TDD suite. Runs the postgres
// backend against a throwaway DB; skips cleanly when Postgres is unreachable.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'rcfg-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const SCHEMA2 = _fs.readFileSync(_path.join(__dirname, '../db/postgres/reports/002_config.sql'), 'utf8');

async function boot() {
  const ctx = await provisionTestDb();
  if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  return { ctx, rdb };
}

test('config pg: schema idempotent + depts + presets seeded', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    await rdb.pgHandle().exec(SCHEMA2);                 // re-apply → idempotent
    const h = rdb.pgHandle();
    // Assert on RAW pg counts — listDepartments isn't forked until Task 2, so calling
    // it now would run the sqlite body and pass off sqlite seeds (false green).
    const dn = Number((await h.prepare('SELECT COUNT(*) AS n FROM action_departments').get()).n);
    assert.equal(dn, 10, 'pg departments seeded');
    const gn = Number((await h.prepare('SELECT COUNT(*) AS n FROM dashboard_preset_groups').get()).n);
    assert.ok(gn > 0, 'pg preset groups seeded');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
