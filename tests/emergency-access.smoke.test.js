'use strict';
// C-22 (G49 · R7) — through the real server on PostgreSQL: emergency access is off by default (404); when on, a
// super_admin grants another person a role for ≤ 24 h with a reason (self refused, > 24 h refused), through the
// C-18 grant path (hash-chained history, risk=1 log); the review is by another super_admin (granter refused); an
// overdue review is flagged and listed; the hour ends the grant; a qualification prerequisite is never waived; the
// C-18 break-glass direct edit creates the same emergency record.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'emerg-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.SDP_QUAL_CFG_TTL_MS = '0';
process.env.DASH_USER = process.env.DASH_USER || 'em-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'em-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'em-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');

let server, base, rdb, cfg, siteA; const tok = {}, ID = {};
before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  siteA = ((await rdb.listSites()) || [])[0].id;
  const mk = async (u, roles) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pw-0000', roles, site_id: siteA });
    tok[u] = (await rdb.login(u, u + '-pw-0000')).token;
    ID[u] = Number((await rdb.pgHandle().prepare('SELECT id FROM users WHERE username=?').get(u)).id);
  };
  await mk('em-s1', ['super_admin']); await mk('em-s2', ['super_admin']); await mk('em-user', ['viewer']); await mk('em-user2', ['viewer']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const grant = (t, o = {}) => send('POST', '/api/access/emergencies', t, { subject_user_id: ID['em-user'], roles: ['field-tech'], hours: 4, reason: 'plant network outage, night shift', ...o });
const rolesOf = async (u) => ((await rdb.listUsers()).find((x) => x.username === u) || {}).roles || [];

test('off by default: every emergency route answers 404, a break-glass stays a plain direct edit', async () => {
  assert.equal((await send('GET', '/api/access/emergencies', tok['em-s1'])).status, 404);
  assert.equal((await grant(tok['em-s1'])).status, 404);
  assert.equal(String((await cfg.getConfig(rdb.db)).emergency_access_enabled), '0');
});

test('on: >24 h refused, self-grant refused, non-super refused; a valid grant goes through the C-18 grant path, logged risk=1', async () => {
  await cfg.setConfig(rdb.db, { emergency_access_enabled: '1' }, 'test');
  assert.match((await grant(tok['em-s1'], { hours: 25 })).body.error, /at most 24 h/);
  assert.match((await grant(tok['em-s1'], { subject_user_id: ID['em-s1'] })).body.error, /themselves/);
  assert.equal((await grant(tok['em-user'])).status, 403, 'a plain session never grants');
  const g = await grant(tok['em-s1']);
  assert.equal(g.status, 201, JSON.stringify(g.body)); ID.e = g.body.id; ID.req = g.body.request_id;
  assert.ok((await rolesOf('em-user')).includes('field-tech'), 'role written through rdb.updateUser');
  const req = await rdb.pgHandle().prepare('SELECT kind, status FROM access_requests WHERE id = ?').get(ID.req);
  assert.deepEqual([req.kind, req.status], ['emergency', 'ACTIVE']);
  const ev = await rdb.pgHandle().prepare('SELECT action, row_hash FROM access_request_events WHERE request_id = ? ORDER BY id').all(ID.req);
  assert.deepEqual(ev.map((e) => e.action), ['emergency_granted', 'activated']);
  assert.ok(ev.every((e) => e.row_hash), 'hash-chained');
  const logs = await rdb.pgHandle().prepare("SELECT risk FROM system_log WHERE action = 'access_emergency_granted'").all();
  assert.ok(logs.length && logs.every((l) => Number(l.risk) === 1));
  await assert.rejects(rdb.pgHandle().prepare(`INSERT INTO access_emergencies (request_id, subject_user_id, granted_by, reason, starts_at, expires_at, review_due, created_at)
    VALUES (999999, 1, 2, 'db cap check', '2026-11-05T00:00:00Z', '2026-11-06T00:00:01Z', '2026-11-07', '2026-11-05')`).run(), /max_24h/, 'the database refuses > 24 h too');
});

test('review: the granter is refused, another super_admin records it; the history carries it', async () => {
  const body = { outcome: 'justified', notes: 'outage confirmed by the site IT lead' };
  assert.match((await send('POST', `/api/access/emergencies/${ID.e}/review`, tok['em-s1'], body)).body.error, /granted the emergency access/);
  assert.equal((await send('POST', `/api/access/emergencies/${ID.e}/review`, tok['em-user'], body)).status, 403);
  const r = await send('POST', `/api/access/emergencies/${ID.e}/review`, tok['em-s2'], body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await send('POST', `/api/access/emergencies/${ID.e}/review`, tok['em-s2'], body)).status, 409);
  const ev = await rdb.pgHandle().prepare('SELECT action FROM access_request_events WHERE request_id = ? ORDER BY id').all(ID.req);
  assert.equal(ev[ev.length - 1].action, 'emergency_reviewed');
});

test('overdue review is flagged and listed; the hour ends the grant (expiry job)', async () => {
  const g = await grant(tok['em-s1'], { subject_user_id: ID['em-user2'], roles: ['editor'], hours: 2 });
  assert.equal(g.status, 201);
  const later = new Date(Date.now() + 6 * 864e5).toISOString();
  const { makeEmergencyStore } = require('../services/emergencyAccessStore');
  const { makeAccessStore } = require('../services/accessStore');
  const h = { prepare: (sql) => rdb.pgHandle().prepare(sql), runTransaction: (fn) => rdb.pgHandle().runTransaction(fn) };
  const store = makeEmergencyStore(h, rdb, makeAccessStore(h, rdb, { now: () => later }), { now: () => later });
  assert.ok((await store.list({ overdueOnly: true })).some((e) => e.id === g.body.id), 'overdue after 6 days without review');
  const ex = await store.expireDue({});
  assert.ok(ex.ended >= 1);
  assert.ok(!(await rolesOf('em-user2')).includes('editor'), 'role taken away at the hour');
  const row = (await store.list()).find((e) => e.id === g.body.id);
  assert.equal(row.live, false);
  const jobs = require('../services/sync/jobs');
  assert.deepEqual(await jobs.accessEmergencyExpiryRun({ rdb, cfg: { emergency_access_enabled: '0' } }), { skipped: true, reason: 'emergency_access_enabled is 0' });
  // through the route: not yet overdue (due in 2 working days)
  const ov = await send('GET', '/api/access/emergencies/overdue', tok['em-s1']);
  assert.equal(ov.status, 200);
  assert.ok(!ov.body.emergencies.some((e) => e.id === g.body.id));
});

test('a qualification prerequisite is never waived by an emergency grant', async () => {
  await cfg.setConfig(rdb.db, { qualification_check_enabled: '1', qualification_requirements: JSON.stringify({ 'field.capture': ['site-induction'] }) }, 'test');
  try {
    const g = await grant(tok['em-s2'], { roles: ['field-tech'], reason: 'field capture needed during the outage' });
    assert.equal(g.status, 201, JSON.stringify(g.body));
    assert.ok(g.body.qualification_unmet.some((u) => u.capability === 'field.capture'), 'the grant says what stays refused');
    const up = await send('POST', '/api/field/uploads', tok['em-user'], {});
    assert.equal(up.status, 403);
    assert.match(up.body.error, /site-induction.*records evidence only/, 'field-tech held by emergency, evidence still required');
  } finally { await cfg.setConfig(rdb.db, { qualification_check_enabled: '0', qualification_requirements: '{}' }, 'test'); }
  const { forRdb } = require('../services/emergencyAccessStore');
  const subject = (await rdb.listUsers()).find((u) => u.username === 'em-user2');
  await cfg.setConfig(rdb.db, { qualification_check_enabled: '1', qualification_requirements: JSON.stringify({ 'field.capture': ['site-induction'] }) }, 'test');
  try {
    const unmet = await forRdb(rdb).qualificationUnmet(subject, ['field-tech']);
    assert.ok(unmet.some((u) => u.capability === 'field.capture'), 'the grant reports what stays refused');
  } finally { await cfg.setConfig(rdb.db, { qualification_check_enabled: '0', qualification_requirements: '{}' }, 'test'); }
});

test('C-18 break-glass direct edit now creates the same emergency record (never to oneself)', async () => {
  await cfg.setConfig(rdb.db, { access_require_approval: '1' }, 'test');
  try {
    const self = await send('PUT', `/api/reports/users/${ID['em-s1']}`, tok['em-s1'], { full_name: 'em-s1', roles: ['super_admin', 'admin'], site_id: siteA, break_glass: true, break_glass_reason: 'urgent fix of my own account' });
    assert.equal(self.status, 403); assert.match(self.body.error, /themselves/);
    const r = await send('PUT', `/api/reports/users/${ID['em-user2']}`, tok['em-s1'], { full_name: 'em-user2', roles: ['viewer', 'admin'], site_id: siteA, break_glass: true, break_glass_reason: 'site coordinator absent, payroll incident' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.emergency && r.body.emergency.id, 'emergency record created');
    const list = await send('GET', '/api/access/emergencies', tok['em-s2']);
    const e = list.body.emergencies.find((x) => x.id === r.body.emergency.id);
    assert.deepEqual([e.source, e.roles], ['break_glass', ['admin']]);
    assert.ok(Date.parse(e.expires_at) - Date.parse(e.starts_at) <= 24 * 3600e3);
  } finally { await cfg.setConfig(rdb.db, { access_require_approval: '0', emergency_access_enabled: '0' }, 'test'); }
});
