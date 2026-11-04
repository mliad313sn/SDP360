'use strict';
// B-02 — pilot measurement CLI against a real PostgreSQL (tests/_pg-boot.mjs provisions + migrates it).
// Proves: the collector reads the real schema, the session is READ ONLY, and no name / e-mail leaks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const cli = require('../tools/pilot/pilot-metrics');

const KEY = 'test-only-pseudonym-key-0123456789';

test('pg: pilot metrics on seeded data — medians, field outcomes, read-only session, no names', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL set by _pg-boot');
  const w = new Client({ connectionString: process.env.PG_URL }); await w.connect();
  const r = new Client({ connectionString: process.env.PG_URL }); await r.connect();
  try {
    // ── fixtures (written by the TEST, never by the tool) ──
    const site = (await w.query(`INSERT INTO sites (name) VALUES ('PilotSite') ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id`)).rows[0].id;
    await w.query(`INSERT INTO site_module_codes (site_id, module, code) VALUES ($1,'meetings','PLT') ON CONFLICT DO NOTHING`, [site]);
    const uid = (await w.query(`INSERT INTO users (username, full_name, password_hash, salt, site_id, role, email)
                                VALUES ('alice.secret','Alice Secretname','x','y',$1,'editor','alice.secret@example.com') RETURNING id`, [site])).rows[0].id;
    const wk = (await w.query(`INSERT INTO weeks (year, week_number, start_date, end_date, label) VALUES (2026, 45, '2026-11-02', '2026-11-08', 'W45 2026')
                               ON CONFLICT (year, week_number) DO UPDATE SET label=EXCLUDED.label RETURNING id`)).rows[0].id;
    const rep = (await w.query(`INSERT INTO weekly_reports (site_id, week_id, status, submitted_at, submitted_by, created_by, created_at)
                                VALUES ($1,$2,'submitted','2026-11-03 08:00:00',$3,$3,'2026-11-02T08:00:00Z') RETURNING id`, [site, wk, uid])).rows[0].id;
    await w.query(`INSERT INTO action_items (report_id, task, status, uid, status_changed_at) VALUES ($1,'t','closed','pilot-uid-1','2026-11-04 08:00:00')`, [rep]);
    const mt = (await w.query(`INSERT INTO md_meetings (reference, site_code, department, meeting_date, status, submitted_at, created_by)
                               VALUES ('PLT_IT_PV_2026-11','PLT','IT','2026-11-03','submitted','2026-11-03 09:00:00',$1) RETURNING id`, [uid])).rows[0].id;
    await w.query(`INSERT INTO md_actions (meeting_id, description, status, created_at, closed_at) VALUES ($1,'a','resolved','2026-11-03T15:00:00Z','2026-11-05 15:00:00')`, [mt]);
    await w.query(`INSERT INTO system_log (ts, category, action, actor, actor_id) VALUES ('2026-11-03T10:00:00Z','report','report_submitted','alice.secret',$1),
                                                                                    ('2026-11-03T10:00:00Z','auth','login_success','alice.secret',$1)`, [uid]);
    await w.query(`INSERT INTO field_outbox (uuid, user_id, kind, payload_hash, status, received_at) VALUES
                   ('11111111-1111-4111-8111-111111111111',$1,'action','h','applied','2026-11-03T10:00:00Z'),
                   ('22222222-2222-4222-8222-222222222222',$1,'action','h','rejected','2026-11-03T11:00:00Z')`, [uid]);

    let out = '';
    const res = await cli.run({ argv: ['--from=2026-11-02', '--to=2026-11-08', '--site=plt', '--format=both'], env: { PILOT_PSEUDONYM_KEY: KEY },
      client: r, now: new Date('2026-11-09T00:00:00Z'), write: (s) => { out += s; } });
    assert.equal(res.ok, true);
    const S = res.report.sections;
    assert.deepEqual(S.active_users.rows.map((x) => [x.site, x.persona, x.week, x.n]), [['PilotSite', 'editor', '2026-W45', 1]]);
    assert.equal(S.active_users.users.length, 1);
    assert.equal(S.active_users.users[0].events, 1, 'login is not a business event');
    assert.deepEqual(S.report_created_to_submitted.rows.map((x) => x.median_h), [24]);
    assert.deepEqual(S.pv_submitted_to_action.rows.map((x) => [x.site, x.median_h]), [['PLT', 6]]);
    const closed = Object.fromEntries(S.action_created_to_closed.rows.map((x) => [x.site, x.median_h]));
    assert.equal(closed['PLT · meetings'], 48);
    assert.equal(closed['PilotSite · report follow-up'], 48);
    assert.deepEqual(S.field_outcomes.rows.map((x) => [x.applied, x.refused, x.conflicted]), [[1, 1, null]]);
    assert.ok(S.metrics_unknown_or_stale.total > 0);

    // no name, user name or e-mail anywhere in the printed output, nor the raw user id
    for (const leak of ['alice', 'Secretname', '@example.com']) assert.ok(!out.includes(leak), leak);
    assert.match(out, /# SDP360 pilot measurement report/);
    assert.match(out, /measure,site,persona,week/);

    // the tool's session is READ ONLY: PostgreSQL itself refuses a write on it
    await assert.rejects(r.query(`DELETE FROM field_outbox`), /read-only transaction/);
    assert.equal((await w.query('SELECT COUNT(*)::int AS n FROM field_outbox')).rows[0].n, 2);

    // an empty window prints "no data", never a 0 median
    out = '';
    const empty = await cli.run({ argv: ['--from=2020-01-06', '--to=2020-01-12'], env: {}, client: r, now: new Date('2026-11-09T00:00:00Z'), write: (s) => { out += s; } });
    assert.equal(empty.ok, true);
    assert.equal(empty.report.sections.report_created_to_submitted.rows.length, 0);
    assert.match(out, /## Weekly report created → submitted \(proxy, not effort\)[\s\S]*?\nno data\n/);
  } finally { await r.end(); await w.end(); }
});
