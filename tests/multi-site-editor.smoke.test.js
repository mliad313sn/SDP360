'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Multi-site editors (2026-10-05) — an editor holding sites A (primary) + B, but not C,
// reads and writes A and B everywhere the single-site rule used to apply, and still gets
// 403 on C. Throwaway sqlite; boots the app in-process.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'multi-site-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'ms-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'ms-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ms-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, A, B, C, repA, repB, repC, tok, superTok;
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const get = (path, t) => fetch(base + path, { headers: H(t) });
const put = (path, t, body) => fetch(base + path, { method: 'PUT', headers: H(t), body: JSON.stringify(body) });
const post = (path, t, body) => fetch(base + path, { method: 'POST', headers: H(t), body: JSON.stringify(body) });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const byName = async (n) => ((await rdb.listSites()) || []).find(s => s.name === n);
  A = (await byName('Hounde')); B = (await byName('MANA')); C = (await byName('Sabodala'));
  assert.ok(A && B && C, 'seeded sites Hounde / Mana / Sabodala');
  repA = (await rdb.ensureReport(A.id, 2026, 30)); repB = (await rdb.ensureReport(B.id, 2026, 30)); repC = (await rdb.ensureReport(C.id, 2026, 30));
  const me = ((await rdb.listUsers()) || []).find(u => u.username === process.env.DASH_USER);
  (await rdb.setUserRoles(me.id, ['super_admin']));
  superTok = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  (await rdb.createUser({ username: 'ms-editor', full_name: 'Multi Site', password: 'ms-editor-0000',
    roles: ['editor', 'tracker-editor'], site_id: A.id, extra_site_ids: [B.id] }));
  tok = (await rdb.login('ms-editor', 'ms-editor-0000')).token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('session: /auth/me carries both sites', async () => {
  const j = await (await get('/api/reports/auth/me', tok)).json();
  const u = j.user || j;
  assert.deepEqual(u.site_ids, [A.id, B.id]);
});

test('report list = sites A and B, never C', async () => {
  const rows = await (await get('/api/reports', tok)).json();
  const ids = new Set(rows.map(r => r.id));
  assert.ok(ids.has(repA.id) && ids.has(repB.id), 'A and B listed');
  assert.ok(!ids.has(repC.id), 'C hidden');
});

test('read guard + write rule: B allowed, C refused', async () => {
  assert.equal((await get(`/api/reports/${repB.id}`, tok)).status, 200);
  assert.equal((await get(`/api/reports/${repC.id}`, tok)).status, 403);
  assert.notEqual((await put(`/api/reports/${repB.id}/lights`, tok, [])).status, 403);
  assert.equal((await put(`/api/reports/${repC.id}/lights`, tok, [])).status, 403);
  assert.notEqual((await post('/api/reports/ensure', tok, { site_id: B.id, year: 2026, week: 31 })).status, 403);
  assert.equal((await post('/api/reports/ensure', tok, { site_id: C.id, year: 2026, week: 31 })).status, 403);
});

test('meetings: a PV can be saved on B (MGO), not on C (SGO)', async () => {
  const pv = (site) => ({ header: { site_code: site, department: 'Mining', meeting_date: '2026-09-10', status: 'draft' } });
  const okB = await post('/api/meetings/save', tok, { state: pv('MGO') });
  assert.equal(okB.status, 200, await okB.text());
  const noC = await post('/api/meetings/save', tok, { state: pv('SGO') });
  assert.equal(noC.status, 403);
});

test('inspection + tracker expose the list of the user\'s codes', async () => {
  const lk = await (await get('/api/inspection/lookups', tok)).json();
  assert.deepEqual(lk.scopes, ['HGO', 'MGO']);
  assert.equal(lk.scope, 'HGO', 'primary kept for older pages');
  const tr = await (await get('/api/tracker/load', tok)).json();
  assert.equal(tr.scopes.length, 2);
  assert.equal(tr.scope, tr.scopes[0]);
});

test('admin users API stores and returns the extra sites', async () => {
  const u = ((await rdb.listUsers()) || []).find(x => x.username === 'ms-editor');
  const r = await put(`/api/reports/users/${u.id}`, superTok, { full_name: 'Multi Site', site_id: A.id, roles: ['editor', 'tracker-editor'], extra_site_ids: [B.id, C.id] });
  assert.equal(r.status, 200);
  const list = await (await get('/api/reports/users', superTok)).json();
  assert.deepEqual(list.find(x => x.id === u.id).extra_site_ids, [B.id, C.id].sort((x, y) => x - y));
  await put(`/api/reports/users/${u.id}`, superTok, { full_name: 'Multi Site', site_id: A.id, roles: ['editor', 'tracker-editor'], extra_site_ids: [B.id] });
});

test('meetings Excel export works for a multi-site editor and stays within their sites (2026-10-16)', async () => {
  // Regression: the route handed the LIST of codes to exportRows, which bound it as one
  // value — the "Excel (full data)" button failed for every editor.
  const r = await get('/api/meetings/export.xlsx', tok);
  assert.equal(r.status, 200, await r.text().catch(() => ''));
  assert.match(r.headers.get('content-disposition') || '', /Meetings_HGO-MGO_/);
  const XLSX = require('xlsx');
  const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
  const sites = XLSX.utils.sheet_to_json(wb.Sheets.Meetings).map(m => m.site_code);
  assert.ok(sites.length >= 1, 'the MGO PV saved above is exported');
  assert.ok(sites.every(s => s === 'HGO' || s === 'MGO'), 'only the editor\'s sites: ' + sites.join(','));
  const adm = await get('/api/meetings/export.xlsx', superTok);
  assert.equal(adm.status, 200);
});
