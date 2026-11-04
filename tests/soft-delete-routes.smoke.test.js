'use strict';
// A-19 — soft-delete routes: delete honours soft_delete_enabled, restore + trash are the admin tier,
// and delete / restore each write a system_log event.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'sd-routes-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'sd-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'sd-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'sd-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, reportConfig, superTok, edTok;
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const get = (p, t) => fetch(base + p, { headers: H(t) });
const post = (p, t, b) => fetch(base + p, { method: 'POST', headers: H(t), body: JSON.stringify(b || {}) });
const del = (p, t) => fetch(base + p, { method: 'DELETE', headers: H(t) });
const setSoft = (on) => reportConfig.setConfig(rdb.db, { soft_delete_enabled: on ? '1' : '0' }, 'smoke');
async function events(action, target) {
  return (await rdb.pgHandle().prepare('SELECT * FROM system_log WHERE action = ? AND target = ?').all(action, String(target)));
}
async function waitEvent(action, target) {
  for (let i = 0; i < 40; i++) { const r = await events(action, target); if (r.length) return r; await new Promise((ok) => setTimeout(ok, 25)); }
  return [];
}
async function newInspection(id) {
  const r = await post('/api/inspection/save', superTok, { state: { meta: { f_id: id, f_site: 'Hounde (HGO)', f_date: '2026-09-10', f_area: 'Server room' }, items: {}, actions: [] } });
  assert.equal(r.status, 200, await r.text());
}

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  reportConfig = require('../services/reportConfig');
  const A = ((await rdb.listSites()) || []).find((s) => s.name === 'Hounde');
  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['super_admin']);
  superTok = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'sd-editor', full_name: 'HGO editor', password: 'sd-editor-0000', roles: ['editor'], site_id: A.id });
  edTok = (await rdb.login('sd-editor', 'sd-editor-0000')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { try { server && server.close(); } catch {} await setSoft(false); });

test('inspection: switch off → DELETE is a hard delete and logs inspection_deleted', async () => {
  await setSoft(false);
  await newInspection('SDR-HARD');
  const r = await del('/api/inspection/SDR-HARD', edTok);
  const body = await r.text();
  assert.equal(r.status, 200, body);
  assert.equal(JSON.parse(body).soft, false);
  assert.equal(await require('../inspection-db').getInspectionTrashRow('SDR-HARD'), null);
  assert.equal((await waitEvent('inspection_deleted', 'SDR-HARD')).length, 1);
});

test('inspection: switch on → soft delete (editor own site), 404 on read, trash lists it with who/when, admin restores', async () => {
  await setSoft(true);
  await newInspection('SDR-SOFT');
  const d = await del('/api/inspection/SDR-SOFT?reason=typo', edTok);
  assert.equal(d.status, 200, await d.text());
  assert.equal((await waitEvent('inspection_soft_deleted', 'SDR-SOFT')).length, 1);
  assert.equal((await get('/api/inspection/SDR-SOFT', superTok)).status, 404);
  // a replayed save cannot resurrect it
  const replay = await post('/api/inspection/save', superTok, { state: { meta: { f_id: 'SDR-SOFT', f_site: 'Hounde (HGO)', f_date: '2026-09-10' }, items: {}, actions: [] } });
  assert.equal(replay.status, 409);
  // trash: admin tier only
  assert.equal((await get('/api/admin/trash', edTok)).status, 403);
  const t = await (await get('/api/admin/trash?module=inspection', superTok)).json();
  const row = t.rows.find((x) => x.id === 'SDR-SOFT');
  assert.ok(row, 'listed in the trash');
  assert.equal(row.deleted_by_name, 'sd-editor');
  assert.equal(row.delete_reason, 'typo');
  assert.equal(row.restorable, true);
  assert.equal(t.enabled, true);
  assert.equal((await get('/api/admin/trash?module=nope', superTok)).status, 400);
  // restore: editor refused, admin tier allowed
  assert.equal((await post('/api/inspection/SDR-SOFT/restore', edTok)).status, 403);
  const rs = await post(row.restore_url, superTok);
  assert.equal(rs.status, 200, await rs.text());
  assert.equal((await waitEvent('inspection_restored', 'SDR-SOFT')).length, 1);
  assert.equal((await get('/api/inspection/SDR-SOFT', superTok)).status, 200);
  assert.equal((await post('/api/inspection/SDR-SOFT/restore', superTok)).status, 409, 'not deleted any more');
  assert.equal((await post('/api/inspection/NOPE/restore', superTok)).status, 404);
});

test('meetings: switch on → soft delete logs meeting_soft_deleted, trash lists the PV, editor restore 403, admin restore 200', async () => {
  await setSoft(true);
  const s = await post('/api/meetings/save', superTok, { state: { header: { site_code: 'HGO', department: 'Mining', meeting_date: '2026-08-10', status: 'draft' },
    issues: [], actions: [{ ord: 1, description: 'A', owner_it: 'x', status: 'open' }] } });
  assert.equal(s.status, 200, await s.text());
  const id = (await s.json()).id;
  const d = await del(`/api/meetings/${id}?reason=dup`, edTok);
  assert.equal(d.status, 200, await d.text());
  assert.equal((await waitEvent('meeting_soft_deleted', id)).length, 1);
  assert.equal((await get(`/api/meetings/${id}`, superTok)).status, 404);
  const t = await (await get('/api/admin/trash?module=meetings', superTok)).json();
  const row = t.rows.find((x) => Number(x.id) === Number(id));
  assert.ok(row && row.restorable && row.deleted_by_name === 'sd-editor' && row.delete_reason === 'dup');
  assert.equal((await post(`/api/meetings/${id}/restore`, edTok)).status, 403);
  const r = await post(row.restore_url, superTok);
  assert.equal(r.status, 200, await r.text());
  assert.equal((await waitEvent('meeting_restored', id)).length, 1);
  assert.equal((await get(`/api/meetings/${id}`, superTok)).status, 200);
});

test('meetings: switch off → DELETE stays a hard delete and logs meeting_deleted', async () => {
  await setSoft(false);
  const s = await post('/api/meetings/save', superTok, { state: { header: { site_code: 'HGO', department: 'HR', meeting_date: '2026-08-11', status: 'draft' }, issues: [], actions: [] } });
  const id = (await s.json()).id;
  assert.equal((await del(`/api/meetings/${id}`, superTok)).status, 200);
  assert.equal(await require('../meetings-db').getMeetingTrashRow(id), null);
  assert.equal((await waitEvent('meeting_deleted', id)).length, 1);
});
