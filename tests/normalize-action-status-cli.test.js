'use strict';
// A-05 — tools/pg/normalize-action-status.js: dry run by default, --apply rewrites md_actions /
// md_issues status 'closed' (any case) → 'resolved' in one transaction with a backup + one audit
// row per changed row, --restore puts the original codes back, a second --apply is a no-op.
process.env.MEETINGS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'nas-'));
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const cli = require('../tools/pg/normalize-action-status');

test('normalize-action-status: dry run, apply, idempotent re-apply, restore', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) return t.skip('Postgres not reachable');
  process.env.PG_URL = ctx.url;
  const mdb = require('../meetings-db');
  await mdb.initPgMeetings();
  const h = mdb.pgHandle();
  const backupDir = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'nas-bk-'));
  const quiet = { log() {} };
  try {
    const m = await h.prepare(`INSERT INTO md_meetings (reference, site_code, department, meeting_date, status) VALUES ('HGO_IT_PV_2026-09','HGO','IT','2026-09-10','submitted')`).run();
    const mid = m.lastID;
    const a1 = (await h.prepare(`INSERT INTO md_actions (meeting_id, description, status, closed_at) VALUES (?,?,?,?)`).run(mid, 'A closed', 'closed', '2026-09-11 10:00:00')).lastID;
    const a2 = (await h.prepare(`INSERT INTO md_actions (meeting_id, description, status, closed_at) VALUES (?,?,?,?)`).run(mid, 'A Closed no stamp', ' Closed', null)).lastID;
    const a3 = (await h.prepare(`INSERT INTO md_actions (meeting_id, description, status) VALUES (?,?,?)`).run(mid, 'A open', 'open')).lastID;
    const i1 = (await h.prepare(`INSERT INTO md_issues (meeting_id, title, category, status, closed_at) VALUES (?,?,?,?,?)`).run(mid, 'I closed', 'CN', 'CLOSED', '2026-09-12 09:00:00')).lastID;
    const st = async (tbl, id) => h.prepare(`SELECT status, closed_at FROM ${tbl} WHERE id = ?`).get(id);
    const audits = async (tbl, col, id) => (await h.prepare(`SELECT count(*)::int n FROM ${tbl} WHERE ${col} = ?`).get(id)).n;

    // dry run
    const dry = await cli.run({ url: ctx.url, backupDir, ...quiet });
    assert.deepEqual(dry.counts, { md_actions: 2, md_issues: 1 });
    assert.equal(dry.applied, false);
    assert.equal((await st('md_actions', a1)).status, 'closed', 'dry run changes nothing');
    assert.equal(_fs.readdirSync(backupDir).length, 0, 'dry run writes no backup');

    // apply
    const ap = await cli.run({ url: ctx.url, apply: true, backupDir, ...quiet });
    assert.equal(ap.applied, true); assert.equal(ap.changed, 3);
    assert.ok(ap.backupFile && _fs.existsSync(ap.backupFile), 'backup written');
    const bk = JSON.parse(_fs.readFileSync(ap.backupFile, 'utf8'));
    assert.equal(bk.rows.length, 3);
    assert.deepEqual(await st('md_actions', a1), { status: 'resolved', closed_at: '2026-09-11 10:00:00' }, 'closed_at kept');
    const s2 = await st('md_actions', a2); assert.equal(s2.status, 'resolved'); assert.ok(s2.closed_at, 'missing closed_at filled from updated_at');
    assert.equal((await st('md_actions', a3)).status, 'open', 'non-closed rows untouched');
    assert.deepEqual(await st('md_issues', i1), { status: 'resolved', closed_at: '2026-09-12 09:00:00' });
    assert.equal(await audits('md_action_updates', 'action_id', a1), 1);
    assert.equal(await audits('md_action_updates', 'action_id', a2), 1);
    assert.equal(await audits('md_action_updates', 'action_id', a3), 0);
    assert.equal(await audits('md_issue_updates', 'issue_id', i1), 1);
    const body = (await h.prepare('SELECT body, status_change FROM md_action_updates WHERE action_id = ?').get(a1));
    assert.match(body.body, /normalised closed→resolved/);

    // idempotent
    const again = await cli.run({ url: ctx.url, apply: true, backupDir, ...quiet });
    assert.equal(again.changed, 0); assert.deepEqual(again.counts, { md_actions: 0, md_issues: 0 });
    assert.equal(await audits('md_action_updates', 'action_id', a1), 1, 'no second audit row');

    // restore
    const rs = await cli.run({ url: ctx.url, restore: ap.backupFile, backupDir, ...quiet });
    assert.equal(rs.restored, 3);
    assert.deepEqual(await st('md_actions', a1), { status: 'closed', closed_at: '2026-09-11 10:00:00' });
    assert.deepEqual(await st('md_actions', a2), { status: ' Closed', closed_at: null });
    assert.deepEqual(await st('md_issues', i1), { status: 'CLOSED', closed_at: '2026-09-12 09:00:00' });
  } finally { try { await h.close(); } catch {} await dropTestDb(ctx); }
});
