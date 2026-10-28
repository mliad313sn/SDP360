'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// RBAC audit 2026-10-02, lot 4c — decision "open everything to coordinators, locked to
// their site", Meetings:
//   - the PV / incubation imports called saveMeeting(state, null) — NO site guard at all —
//     and were admin-only: now open to an editor, rows of another site refused;
//   - editing a CLOSED PV and its issues was admin-only: now an editor of that site;
//   - DELETE was executive-only, the Excel export admin-only and all sites: now an
//     editor on their own site.
// Throwaway sqlite; boots the app in-process.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'mtg-scope-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'mtg-scope-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'mtg-scope-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'mtg-scope-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const XLSX = require('xlsx');

let server, base, rdb, mdb, codeA, codeB, dept, pvA, pvB, pvA2;
const tok = {};
const H = (t, ct = 'application/json') => ({ 'Content-Type': ct, 'x-report-token': t });
const post = (p, t, b) => fetch(base + p, { method: 'POST', headers: H(t), body: JSON.stringify(b) });
// One PV per (site, department, MONTH): two PVs of the same month share a reference and the
// second save would UPDATE the first (see CLAUDE.md, meetings pitfalls) — so distinct months.
const pv = (code, date, status = 'draft') => ({ state: { header: { site_code: code, department: dept, meeting_date: date, status } } });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  mdb = require('../meetings-db');
  const L = await mdb.loadLookups();
  dept = L.departments[0].code;
  const coded = (await rdb.listSites()).map(s => ({ s, code: require('../inspection-db').siteNameToCode(s.name) }))
    .filter(x => x.code && L.sites.some(ls => ls.code === x.code));
  assert.ok(coded.length >= 2, 'two seeded sites with a meetings code');
  const [A, B] = coded; codeA = A.code; codeB = B.code;
  const mk = async (username, roles, site_id) => {
    await rdb.createUser({ username, full_name: username, password: username + '-0000', roles, site_id });
    return (await rdb.login(username, username + '-0000')).token;
  };
  tok.admin   = await mk('ms-admin',   ['admin'], null);
  tok.editorA = await mk('ms-editor-a', ['editor'], A.s.id);
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  pvA  = (await (await post('/api/meetings/save', tok.admin, pv(codeA, '2026-08-10', 'closed'))).json()).id;
  pvB  = (await (await post('/api/meetings/save', tok.admin, pv(codeB, '2026-08-11', 'closed'))).json()).id;
  pvA2 = (await (await post('/api/meetings/save', tok.admin, pv(codeA, '2026-06-12'))).json()).id;
  assert.ok(pvA && pvB && pvA2, 'fixtures saved');
  assert.equal((await mdb.getMeeting(pvA)).header.status, 'closed', 'fixture PV is closed');
});
after(() => { try { server && server.close(); } catch {} });

test('an editor can edit a CLOSED PV of their own site (200)', async () => {
  const r = await post('/api/meetings/save', tok.editorA, { state: { id: pvA, header: { id: pvA, site_code: codeA, department: dept, meeting_date: '2026-08-10', status: 'closed', priority_1: 'edited' } } });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.id, pvA, 'the closed PV itself was updated (not a new one created)');
  assert.equal((await mdb.getMeeting(pvA)).header.priority_1, 'edited');
});
test('an editor can update an issue under a CLOSED PV of their own site (not 403)', async () => {
  await post('/api/meetings/save', tok.admin, { state: { id: pvA, header: { id: pvA, site_code: codeA, department: dept, meeting_date: '2026-08-10', status: 'closed' }, issues: [{ ord: 1, title: 'x', category: 'CN', severity: 'LOW', status: 'open' }] } });
  const rec = await mdb.getMeeting(pvA);
  const issueId = rec.issues[0].id;
  const r = await post(`/api/meetings/issues/${issueId}/update`, tok.editorA, { body: 'comment' });
  assert.notEqual(r.status, 403);
});
test('delete: own site allowed, another site refused', async () => {
  assert.equal((await fetch(`${base}/api/meetings/${pvB}`, { method: 'DELETE', headers: H(tok.editorA) })).status, 403);
  assert.equal((await fetch(`${base}/api/meetings/${pvA2}`, { method: 'DELETE', headers: H(tok.editorA) })).status, 200);
});
test('Excel export: open to an editor and limited to their site', async () => {
  const r = await fetch(base + '/api/meetings/export.xlsx', { headers: H(tok.editorA) });
  assert.equal(r.status, 200);
  const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  assert.ok(rows.length > 0);
  assert.ok(rows.every(x => x.site_code === codeA), 'only own-site PVs');
});
test('import: open to an editor; a row of another site is refused, their own saved', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { reference: '', site_code: codeA, department: dept, meeting_date: '2026-07-01' },
    { reference: '', site_code: codeB, department: dept, meeting_date: '2026-07-02' },
  ]), 'Meetings');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ meeting_reference: '', ord: '', title: '' }]), 'Issues');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ meeting_reference: '', ord: '', description: '' }]), 'Actions');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const r = await fetch(base + '/api/meetings/import/commit?force=1', { method: 'POST', headers: H(tok.editorA, 'application/octet-stream'), body: buf });
  assert.equal(r.status, 200, 'import open to an editor');
  const out = await r.json();
  assert.equal(out.created, 1, 'own-site row saved: ' + JSON.stringify(out.errors));
  assert.ok(out.errors.some(e => /Cross-site|scoped/.test(e.msg)), 'other-site row refused');
  const all = await mdb.listMeetings({ limit: 500 });
  assert.ok(!all.some(m => m.site_code === codeB && String(m.meeting_date).startsWith('2026-07-02')), 'nothing written for the other site');
});
