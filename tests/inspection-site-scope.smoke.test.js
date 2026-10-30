'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// RBAC audit 2026-10-02, lot 4b — decision "open everything to coordinators, locked to
// their site", Inspections:
//   - an editor could OVERWRITE another site's inspection: the save checked only the
//     incoming site, never the stored row's (and an empty site passed);
//   - reopening/modifying a submitted inspection, deleting, the single and roll-up PPTX
//     and the Excel export were admin/executive-only — now open to an editor on their
//     own site (the Excel and roll-up are forced to that site).
// Throwaway sqlite; boots the app in-process.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'insp-scope-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'insp-scope-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'insp-scope-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'insp-scope-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const XLSX = require('xlsx');

let server, base, rdb, inspDb, codeA, codeB;
const tok = {};
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const post = (p, t, b) => fetch(base + p, { method: 'POST', headers: H(t), body: JSON.stringify(b) });
const del = (p, t) => fetch(base + p, { method: 'DELETE', headers: H(t) });
const state = (id, code, status = 'draft') => ({ state: { meta: { f_id: id, f_site: `Site (${code})`, f_date: '2026-09-15', f_area: 'Server room', f_lead: 'Tester' }, status, items: {}, actions: [] } });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  inspDb = require('../inspection-db');
  const sites = (await rdb.listSites());
  const coded = sites.map(s => ({ s, code: inspDb.siteNameToCode(s.name) })).filter(x => x.code);
  assert.ok(coded.length >= 2, 'two seeded sites with an inspection code');
  const [A, B] = coded; codeA = A.code; codeB = B.code;
  const mk = async (username, roles, site_id) => {
    await rdb.createUser({ username, full_name: username, password: username + '-0000', roles, site_id });
    return (await rdb.login(username, username + '-0000')).token;
  };
  tok.admin   = await mk('is-admin',   ['admin'], null);
  tok.editorA = await mk('is-editor-a', ['editor'], A.s.id);
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  // Fixtures written by an admin: one inspection per site, both SUBMITTED.
  for (const [id, code] of [['EM-IT-A-1', codeA], ['EM-IT-B-1', codeB], ['EM-IT-A-DEL', codeA], ['EM-IT-B-DEL', codeB]]) {
    const r = await post('/api/inspection/save', tok.admin, state(id, code, 'submitted'));
    assert.equal(r.status, 200, 'fixture ' + id);
  }
});
after(() => { try { server && server.close(); } catch {} });

test('an editor cannot overwrite another site\'s inspection by reusing its id (403)', async () => {
  const r = await post('/api/inspection/save', tok.editorA, state('EM-IT-B-1', codeA));
  assert.equal(r.status, 403);
  assert.ok(String((await inspDb.getInspection('EM-IT-B-1')).header.site_code).includes(codeB), 'the row still belongs to B');
});
test('an editor cannot save an inspection without a site (403)', async () => {
  const r = await post('/api/inspection/save', tok.editorA, { state: { meta: { f_id: 'EM-IT-NOSITE', f_site: '' }, items: {}, actions: [] } });
  assert.equal(r.status, 403);
});
test('an editor CAN modify / reopen a submitted inspection of their own site (200)', async () => {
  const r = await post('/api/inspection/save', tok.editorA, state('EM-IT-A-1', codeA, 'draft'));
  assert.equal(r.status, 200);
});
test('delete: an editor may delete their own site\'s inspection, not another site\'s', async () => {
  assert.equal((await del('/api/inspection/EM-IT-B-DEL', tok.editorA)).status, 403);
  assert.equal((await del('/api/inspection/EM-IT-A-DEL', tok.editorA)).status, 200);
});
test('single PPTX: own site allowed, other site refused', async () => {
  assert.equal((await post('/api/inspection/EM-IT-B-1/export', tok.editorA, {})).status, 403);
  assert.notEqual((await post('/api/inspection/EM-IT-A-1/export', tok.editorA, {})).status, 403);
});
test('Excel export: open to an editor and limited to their site', async () => {
  const r = await fetch(base + '/api/inspection/export.xlsx', { headers: H(tok.editorA) });
  assert.equal(r.status, 200);
  const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const sites = new Set(rows.map(x => String(x.site_code || x['Site'] || x.site || '')));
  assert.ok(rows.length > 0, 'own rows exported');
  assert.ok(![...sites].some(s => s.includes(codeB)), 'no other-site row: ' + [...sites].join(','));
});
test('roll-up PPTX: open to an editor (forced to their site)', async () => {
  const r = await post('/api/inspection/aggregate/export', tok.editorA, { filters: { site: codeB } });
  assert.notEqual(r.status, 403);
});
