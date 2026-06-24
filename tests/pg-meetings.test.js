'use strict';
// Chunk 2 — meetings.db → PostgreSQL. TDD suite. Runs the postgres backend
// against a throwaway DB; skips cleanly when Postgres is unreachable.
process.env.MEETINGS_BACKEND = 'postgres';
// loadLookups requires reports-db.js, which opens its sqlite DB + seeds a default
// admin at module-load (FATAL without these). Isolate + supply throwaway creds.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'mtg-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
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

// ── Read-path forks: loadLookups + getMeeting/list/count/status/idByRef ─────
test('pg meetings read-path (seed via pgHandle)', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, mdb } = b; const h = mdb.pgHandle();
  try {
    const lk = await mdb.loadLookups();
    assert.ok(lk.categories.length > 0 && lk.statuses.length > 0, 'lookups seeded');
    const m = await h.prepare(`INSERT INTO md_meetings (reference, site_code, department, meeting_date, status, department_head)
                               VALUES ('HGO_Maintenance_PV_2026-05','HGO','Maintenance','2026-05-10','submitted','Chef')`).run();
    const mid = m.lastID;
    await h.prepare(`INSERT INTO md_issues (meeting_id, title, category, severity, escalate, status) VALUES (?,?,?,?,?,?)`)
      .run(mid, 'Net down', 'CN', 'HIGH', 1, 'open');
    await h.prepare(`INSERT INTO md_actions (meeting_id, description, status) VALUES (?,?,?)`).run(mid, 'Fix it', 'open');
    const full = await mdb.getMeeting(mid);
    assert.equal(full.header.reference, 'HGO_Maintenance_PV_2026-05');
    assert.equal(full.issues.length, 1); assert.equal(full.actions.length, 1);
    const list = await mdb.listMeetings({ site: 'HGO' });
    assert.equal(list.length, 1);
    assert.equal(list[0].issue_count, 1); assert.equal(typeof list[0].issue_count, 'number');
    assert.equal(list[0].high_issue_count, 1); assert.equal(list[0].escalated_count, 1);
    assert.equal(await mdb.countMeetings({ site: 'HGO' }), 1);
    assert.equal((await mdb.listMeetings({ q: 'maintenance' })).length, 1, 'ILIKE q is case-insensitive');
    assert.equal((await mdb.getMeetingStatus(mid)).status, 'submitted');
    assert.equal(await mdb.getMeetingIdByReference('HGO_Maintenance_PV_2026-05'), mid);
  } finally { try { await mdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── saveMeeting fork: round-trip + defensive children + dedup + cross-site ──
test('pg saveMeeting: create round-trip + header-only preserves children + dedup + cross-site', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, mdb } = b;
  try {
    const r = await mdb.saveMeeting({
      header: { site_code: 'HGO', department: 'Maintenance', meeting_date: '2026-05-10', status: 'submitted', department_head: 'Chef' },
      issues: [{ title: 'Net down', category: 'CN', severity: 'HIGH', escalate: 1, status: 'open' }],
      actions: [{ description: 'Fix it', status: 'open', linked_issue_ord: 1 }],
    }, null, 1);
    assert.ok(r.id && r.created, 'created');
    let full = await mdb.getMeeting(r.id);
    assert.equal(full.issues.length, 1); assert.equal(full.actions.length, 1);
    assert.equal(full.actions[0].linked_issue_id, full.issues[0].id, 'linked_issue_ord → id');
    assert.equal(full.updates.length, 1, 'issue-created audit row');
    // header-only PATCH (no issues/actions arrays) preserves children
    await mdb.saveMeeting({ id: r.id, header: { ...full.header, status: 'signed' } }, null, 1);
    full = await mdb.getMeeting(r.id);
    assert.equal(full.header.status, 'signed');
    assert.equal(full.issues.length, 1, 'children preserved on header-only save');
    assert.equal(full.actions.length, 1);
    // logical-identity dedup: same site/dept/month → UPDATE, not duplicate
    const r2 = await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'Maintenance', meeting_date: '2026-05-20', status: 'draft' }, issues: [] }, null, 1);
    assert.equal(r2.id, r.id, 'logical-identity dedup → same row');
    assert.equal(await mdb.countMeetings({ site: 'HGO' }), 1, 'no duplicate row');
    // cross-site guard (editor scoped to MGO cannot write HGO)
    await assert.rejects(mdb.saveMeeting({ id: r.id, header: { site_code: 'HGO', department: 'Maintenance', meeting_date: '2026-05-20' } }, 'MGO', 1), /Cross-site/);
  } finally { try { await mdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
