'use strict';
// Chunk 2 — meetings.db → PostgreSQL. TDD suite. Runs the postgres backend
// against a throwaway DB; skips cleanly when Postgres is unreachable.
process.env.MEETINGS_BACKEND = 'postgres';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const SCHEMA = require('fs').readFileSync(
  require('path').join(__dirname, '../db/postgres/meetings/001_init.sql'), 'utf8');

// Boot a meetings pg handle against a fresh test DB (schema + seed applied).
async function boot() {
  const ctx = await provisionTestDb();
  if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const mdb = require('../meetings-db');
  await mdb.initPgMeetings();
  return { ctx, mdb };
}

test('meetings pg: schema idempotent + lookups seeded + survey relabel', async (t) => {
  const b = await boot();
  if (!b) return t.skip('Postgres not reachable');
  const { ctx, mdb } = b;
  const h = mdb.pgHandle();
  try {
    await h.exec(SCHEMA);   // re-apply schema through the same handle — must be idempotent
    const tbls = await h.prepare(
      `SELECT count(*)::int n FROM information_schema.tables WHERE table_name LIKE 'md_%'`).get();
    assert.ok(tbls.n >= 18, `expected >=18 md_ tables, got ${tbls.n}`);
    const cats = await h.prepare('SELECT count(*)::int n FROM md_categories').get();
    assert.ok(cats.n > 0, 'lookups seeded');
    const sv = await h.prepare(`SELECT name_en FROM md_intake_sources WHERE code='survey'`).get();
    if (sv) assert.equal(sv.name_en, 'IT Survey', 'survey relabel applied');
  } finally { try { await h.close(); } catch {} await dropTestDb(ctx); }
});
