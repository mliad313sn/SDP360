'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// RBAC audit 2026-10-02, lot 4a — decision "open everything to coordinators, locked to
// their site": report READS. Before, the list and GET /:id scoped with an EXACT
// `role !== 'admin'` (a site-less editor saw every site, an executive with a site was
// wrongly scoped), and ~20 report/site read routes had no site check at all.
// Rule: admin tier unscoped; anyone else reads only their own site; a site-less
// non-admin reads nothing per-site. audit-viewer stays a global read-only auditor.
// Throwaway sqlite; boots the app in-process.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'report-read-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'report-read-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'report-read-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'report-read-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, siteA, siteB, repA, repB;
const tok = {};
const get = (path, t) => fetch(base + path, { headers: { 'x-report-token': t } });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const sites = rdb.listSites();
  siteA = sites[0]; siteB = sites[1];
  repA = rdb.ensureReport(siteA.id, 2026, 30);
  repB = rdb.ensureReport(siteB.id, 2026, 30);
  const mk = async (username, roles, site_id) => {
    await rdb.createUser({ username, full_name: username, password: username + '-0000', roles, site_id });
    return (await rdb.login(username, username + '-0000')).token;
  };
  tok.editorA  = await mk('rr-editor-a',  ['editor'], siteA.id);
  tok.noSite   = await mk('rr-nosite',    ['editor'], null);
  tok.execA    = await mk('rr-exec-a',    ['executive'], siteA.id);
  tok.auditorA = await mk('rr-auditor-a', ['viewer', 'audit-viewer'], siteA.id);
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('list: an editor only sees their own site', async () => {
  const rows = await (await get('/api/reports', tok.editorA)).json();
  assert.ok(rows.length > 0);
  assert.ok(rows.every(r => r.site_name === siteA.name), 'no other site leaks');  // listReports carries site_name, not site_id
});
test('list: an editor cannot widen the list with ?site_id=', async () => {
  const rows = await (await get(`/api/reports?site_id=${siteB.id}`, tok.editorA)).json();
  assert.ok(rows.length > 0 && rows.every(r => r.site_name === siteA.name));
});
test('list: a site-less editor sees nothing', async () => {
  const rows = await (await get('/api/reports', tok.noSite)).json();
  assert.deepEqual(rows, []);
});
test('GET /:id — own site 200, other site 403, site-less 403', async () => {
  assert.equal((await get(`/api/reports/${repA.id}`, tok.editorA)).status, 200);
  assert.equal((await get(`/api/reports/${repB.id}`, tok.editorA)).status, 403);
  assert.equal((await get(`/api/reports/${repA.id}`, tok.noSite)).status, 403);
});
test('GET /:id — an executive with a site is NOT scoped (hierarchy, not the exact role string)', async () => {
  assert.equal((await get(`/api/reports/${repB.id}`, tok.execA)).status, 200);
});
test('every per-report read sub-route is locked to the site', async () => {
  for (const sub of ['carry-over-actions', 'action-weeks', 'site-open-actions', 'light-weeks', 'carry-over-infra', 'importable-actions', 'infra-auto']) {
    assert.equal((await get(`/api/reports/${repB.id}/${sub}`, tok.editorA)).status, 403, sub);
    assert.notEqual((await get(`/api/reports/${repA.id}/${sub}`, tok.editorA)).status, 403, sub + ' (own site)');
  }
});
test('per-site reads by URL site_id are locked (monthly, yearly, objectives)', async () => {
  for (const p of ['monthly/%s/2026/9', 'monthly/%s/2026/9/edits', 'yearly/%s/2026', 'objectives/%s/2026']) {
    assert.equal((await get('/api/reports/' + p.replace('%s', siteB.id), tok.editorA)).status, 403, p);
    assert.notEqual((await get('/api/reports/' + p.replace('%s', siteA.id), tok.editorA)).status, 403, p + ' (own site)');
  }
});
test('fleet-wide decks are admin-tier only', async () => {
  assert.equal((await get('/api/reports/monthly/all-sites/2026/9/pptx', tok.editorA)).status, 403);
  assert.equal((await get('/api/reports/weekly-summary/2026/30/pptx', tok.editorA)).status, 403);
});
test('audit log: open to an editor on their own site, locked to it', async () => {
  assert.equal((await get(`/api/reports/${repA.id}/audit`, tok.editorA)).status, 200);
  assert.equal((await get(`/api/reports/${repB.id}/audit`, tok.editorA)).status, 403);
});
test('audit log: audit-viewer stays a global read-only auditor', async () => {
  assert.equal((await get(`/api/reports/${repB.id}/audit`, tok.auditorA)).status, 200);
});
test('helpdesk charts: an editor may not ask for another site\'s Zoho group', async () => {
  const otherGroup = String(siteB.zoho_group || '').split(',')[0].trim();
  assert.ok(otherGroup, 'seeded site has a group');
  const r = await get(`/api/reports/helpdesk-charts?group=${encodeURIComponent(otherGroup)}&end_date=2026-09-30`, tok.editorA);
  assert.equal(r.status, 403);
});

// site-data / site-actions are addressed by the MEETINGS site code (HGO, MGO…).
async function codeOf(site) {
  const rows = await rdb.listSiteModuleCodes('meetings');
  const hit = (rows || []).find(r => Number(r.site_id) === Number(site.id));
  return hit && hit.code;
}
test('site-data and site-actions by code are locked to the caller\'s site', async () => {
  const own = await codeOf(siteA), other = await codeOf(siteB);
  assert.ok(own && other, 'both seeded sites carry a meetings code');
  for (const route of ['site-data', 'site-actions']) {
    assert.equal((await get(`/api/reports/${route}?site=${other}`, tok.editorA)).status, 403, route);
    assert.notEqual((await get(`/api/reports/${route}?site=${own}`, tok.editorA)).status, 403, route + ' (own)');
  }
});
