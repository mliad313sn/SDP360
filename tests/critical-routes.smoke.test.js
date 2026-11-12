'use strict';
// E-Q03 (audit Q-03) — behaviour of critical routes that had no test reference, through the real server on a
// throwaway PostgreSQL schema, logged in with the role each route REALLY requires. The backup schedule module is
// stubbed on its exported object (the server calls it at request time) — no Task Scheduler / pg_dump is run.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'crit-routes-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'cr-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'cr-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'cr-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const backupSchedule = require('../services/backupSchedule');
const backupCalls = [];
backupSchedule.getStatus = async () => ({ daily: { enabled: true, time: '02:00' } });
backupSchedule.listRestorePoints = async () => Array.from({ length: 25 }, (_, i) => ({ name: 'rp' + i }));
backupSchedule.setSchedule = async (b) => { backupCalls.push(['set', b]); if (b && b.daily === 'bad') throw new Error('invalid time'); return { ok: true, applied: b }; };
backupSchedule.backupNow = async (o) => { backupCalls.push(['now', o]); return { ok: true, dbOnly: o.dbOnly }; };

let server, base, rdb, T = {};
before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  const sites = await rdb.listSites({ includeInactive: true });
  const hounde = sites.find((s) => /hounde/i.test(s.name)).id;
  const mk = async (u, role, roles, site) => { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', role, roles, site_id: site }); } catch { /* exists */ } return (await rdb.login(u, u + 'pass1234')).token; };
  T.super = await mk('cr_super', 'super_admin', ['super_admin']);
  T.admin = await mk('cr_admin', 'admin', ['admin']);
  T.editor = await mk('cr_editor', 'editor', ['editor'], hounde);
  T.siteless = await mk('cr_siteless', 'editor', ['editor']);
  T.viewer = await mk('cr_viewer', 'viewer', ['viewer'], hounde);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const H = (t, extra) => Object.assign(t ? { 'x-report-token': t } : {}, extra || {});
const get = (p, t) => fetch(base + p, { headers: H(t) });
const post = (p, t, body) => fetch(base + p, { method: 'POST', headers: H(t, { 'content-type': 'application/json' }), body: JSON.stringify(body || {}) });

test('POST /api/meetings/reset: anonymous 401, admin/editor 403, super_admin re-seeds and returns the lookups', async () => {
  assert.equal((await post('/api/meetings/reset')).status, 401);
  assert.equal((await post('/api/meetings/reset', T.admin)).status, 403);
  assert.equal((await post('/api/meetings/reset', T.editor)).status, 403);
  const r = await post('/api/meetings/reset', T.super);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.ok(j.lookups && Array.isArray(j.lookups.departments) && j.lookups.departments.length > 0, 'departments re-seeded');
});

test('POST /api/cache/clear: viewer/editor 403, admin 200; GET /api/cache/status reachable by any session', async () => {
  assert.equal((await post('/api/cache/clear')).status, 401);
  assert.equal((await post('/api/cache/clear', T.viewer)).status, 403);
  assert.equal((await post('/api/cache/clear', T.editor)).status, 403);
  const r = await post('/api/cache/clear', T.admin);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal((await get('/api/cache/status')).status, 401);
  assert.equal((await get('/api/cache/status', T.viewer)).status, 200);
});

test('GET/POST /api/admin/backup-schedule + POST /api/admin/backup-now: super_admin only; list capped at 20; bad schedule → 400', async () => {
  for (const t of [T.admin, T.editor, T.viewer]) {
    assert.equal((await get('/api/admin/backup-schedule', t)).status, 403);
    assert.equal((await post('/api/admin/backup-schedule', t, { daily: '01:00' })).status, 403);
    assert.equal((await post('/api/admin/backup-now', t, {})).status, 403);
  }
  assert.equal(backupCalls.length, 0, 'a refused call never reaches the backup module');
  const g = await (await get('/api/admin/backup-schedule', T.super)).json();
  assert.deepEqual(g.status, { daily: { enabled: true, time: '02:00' } });
  assert.equal(g.restorePoints.length, 20);
  const s = await post('/api/admin/backup-schedule', T.super, { daily: '01:30', enabled: true });
  assert.equal(s.status, 200);
  assert.equal((await s.json()).applied.daily, '01:30');
  assert.equal((await post('/api/admin/backup-schedule', T.super, { daily: 'bad' })).status, 400);
  const n = await (await post('/api/admin/backup-now', T.super, { dbOnly: 1 })).json();
  assert.deepEqual(n, { ok: true, dbOnly: true });
  const n2 = await (await post('/api/admin/backup-now', T.super, {})).json();
  assert.equal(n2.dbOnly, false);
});

test('POST /api/reports/auth/change-password: both fields required, old password checked, ≥ 8 chars, the session stays valid, new password logs in', async () => {
  const t = (await rdb.login('cr_viewer', 'cr_viewerpass1234')).token;
  assert.equal((await post('/api/reports/auth/change-password', null, { current_password: 'x', new_password: 'y' })).status, 401);
  assert.equal((await post('/api/reports/auth/change-password', t, { new_password: 'abcdefgh1' })).status, 400);
  const wrong = await post('/api/reports/auth/change-password', t, { current_password: 'nope', new_password: 'abcdefgh1' });
  assert.equal(wrong.status, 400);
  assert.match((await wrong.json()).error, /Current password is incorrect/);
  const short = await post('/api/reports/auth/change-password', t, { current_password: 'cr_viewerpass1234', new_password: 'short' });
  assert.equal(short.status, 400);
  assert.match((await short.json()).error, /at least 8/);
  const ok = await post('/api/reports/auth/change-password', t, { current_password: 'cr_viewerpass1234', new_password: 'cr_viewer-new-pass9' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
  // as coded today: the current session is NOT ended by a password change (recorded, not judged)
  assert.equal((await get('/api/reports/current-week', t)).status, 200);
  const old = await rdb.login('cr_viewer', 'cr_viewerpass1234');
  assert.ok(!old || !old.token, 'old password no longer logs in');
  assert.ok((await rdb.login('cr_viewer', 'cr_viewer-new-pass9')).token, 'new password logs in');
  // restore the fixture password for the other tests
  await post('/api/reports/auth/change-password', t, { current_password: 'cr_viewer-new-pass9', new_password: 'cr_viewerpass1234' });
});

test('POST /api/kpi-policies/validate: any session; a valid definition is valid, a broken one lists errors; nothing is stored', async () => {
  const E = require('../services/kpiPolicyEngine');
  const good = JSON.parse(JSON.stringify(E.IMPORTED_DEFINITIONS['helpdesk.resolution_sla_pct'][1].definition));
  assert.equal((await post('/api/kpi-policies/validate', null, { definition: good })).status, 401);
  const v = await (await post('/api/kpi-policies/validate', T.viewer, { definition: good })).json();
  assert.deepEqual([v.ok, v.valid, v.errors.length], [true, true, 0]);
  const b = await (await post('/api/kpi-policies/validate', T.viewer, { definition: { dataset: 'nope' } })).json();
  assert.equal(b.valid, false);
  assert.ok(b.errors.length > 0);
  const nb = await (await post('/api/kpi-policies/validate', T.viewer, {})).json();
  assert.equal(nb.valid, false);
  let n = 0; try { n = Number((await rdb.db.prepare('SELECT COUNT(*) AS n FROM kpi_policies').get()).n); } catch { n = 0; }
  assert.equal(n, 0, 'validate never writes a policy');
});

test('meetings import template + preview: viewer and site-less editor 403; editor gets the xlsx; preview of the template is a dry run (nothing written)', async () => {
  assert.equal((await get('/api/meetings/import/template', T.viewer)).status, 403);
  assert.equal((await get('/api/meetings/import/template', T.siteless)).status, 403);
  const tr = await get('/api/meetings/import/template', T.editor);
  assert.equal(tr.status, 200);
  assert.match(tr.headers.get('content-type'), /spreadsheetml/);
  const xlsx = Buffer.from(await tr.arrayBuffer());
  assert.equal(xlsx.slice(0, 2).toString(), 'PK', 'a zip (xlsx) file');
  const before = (await require('../meetings-db').exportRows({})).meetings.length;
  const empty = await fetch(base + '/api/meetings/import/preview', { method: 'POST', headers: H(T.editor, { 'content-type': 'application/octet-stream' }), body: Buffer.alloc(0) });
  assert.equal(empty.status, 400);
  const pv = await fetch(base + '/api/meetings/import/preview', { method: 'POST', headers: H(T.editor, { 'content-type': 'application/octet-stream' }), body: xlsx });
  assert.equal(pv.status, 200);
  const j = await pv.json();
  assert.equal(j.ok, true);
  assert.ok(j.summary && Array.isArray(j.errors) && Array.isArray(j.meetings));
  const after = (await require('../meetings-db').exportRows({})).meetings.length;
  assert.equal(after, before, 'preview writes nothing');
  assert.equal((await fetch(base + '/api/meetings/import/preview', { method: 'POST', headers: H(T.viewer, { 'content-type': 'application/octet-stream' }), body: xlsx })).status, 403);
});

test('GET /api/meetings/people + /api/risk-register-config/sites + /api/reports/current-week: session required, shapes stable', async () => {
  assert.equal((await get('/api/meetings/people')).status, 401);
  assert.ok(Array.isArray((await (await get('/api/meetings/people', T.viewer)).json()).people));
  const s = await (await get('/api/risk-register-config/sites', T.viewer)).json();
  assert.ok(Array.isArray(s.sites) && s.sites.includes('HGO'));
  const w = await (await get('/api/reports/current-week', T.viewer)).json();
  assert.ok(Number.isInteger(w.year) && Number.isInteger(w.week));
  assert.match(String(w.start), /^\d{4}-\d\d-\d\d$/);
  assert.match(String(w.label), /^W\d\d \d{4}$/);
});
