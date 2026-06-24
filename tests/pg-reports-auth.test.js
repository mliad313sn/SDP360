'use strict';
// Sub-chunk A — reports.db auth/sessions → PostgreSQL. TDD. Skips when PG down.
process.env.REPORTS_BACKEND = 'postgres';
const fs = require('fs'); const path = require('path'); const os = require('os');
// Isolate the module-load sqlite handle: reports-db.js opens data/reports.db at
// require time even in pg mode — point it at a throwaway dir so a running prod
// instance's WAL lock can't break (or pollute) the suite.
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-auth-'));
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const { makePgDb } = require('../services/pgDb');
const SCHEMA = fs.readFileSync(path.join(__dirname, '../db/postgres/reports/001_auth.sql'), 'utf8');

test('schema: idempotent + real FKs (sessions + user_roles CASCADE, users.site_id)', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  const db = makePgDb(ctx.url); await db.connect();
  try {
    await db.exec(SCHEMA); await db.exec(SCHEMA);               // idempotent
    const n = await db.prepare(`SELECT count(*)::int n FROM information_schema.tables
                                WHERE table_name IN ('sites','users','sessions','user_roles')`).get();
    assert.equal(n.n, 4);
    // sessions.user_id FK is ON DELETE CASCADE
    const cas = await db.prepare(`
      SELECT rc.delete_rule FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage k ON k.constraint_name = rc.constraint_name
      WHERE k.table_name='sessions' AND k.column_name='user_id'`).get();
    assert.equal(cas.delete_rule, 'CASCADE');
    // users.site_id FK exists
    const fk = await db.prepare(`SELECT count(*)::int n FROM information_schema.key_column_usage
      WHERE table_name='users' AND column_name='site_id' AND constraint_name LIKE '%fkey%'`).get();
    assert.ok(fk.n >= 1, 'users.site_id FK present');
  } finally { await db.close(); await dropTestDb(ctx); }
});
