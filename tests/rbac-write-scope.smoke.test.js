'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// RBAC & site-scope audit 2026-10-02 (docs/superpowers/plans/2026-10-02-rbac-site-scope-audit.md), lot 1.
// Writes that ignored the F5 rule — editor role, the OBJECT's site unless admin+, a site-less
// profile is NOT global:
//   A12  POST /api/reports/monthly/:site/:y/:m/edits and POST /api/reports/objectives/:site/:y
//        had NO role or site check at all — a viewer could overwrite any site's monthly report.
//   A16  POST /api/assets/reconcile/decision had no role check.
//   A8   meetings / inspection saves treated a non-admin WITHOUT a site as unscoped (global).
// Throwaway sqlite; boots the app in-process.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'rbac-scope-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'rbac-scope-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'rbac-scope-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'rbac-scope-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, siteA, siteB;
const tok = {};
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const post = (path, t, body) => fetch(base + path, { method: 'POST', headers: H(t), body: JSON.stringify(body) });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const sites = rdb.listSites() || [];
  assert.ok(sites.length >= 2, 'two seeded sites');
  siteA = sites[0]; siteB = sites[1];
  const mk = async (username, roles, site_id) => {
    await rdb.createUser({ username, full_name: username, password: username + '-0000', roles, site_id });
    return (await rdb.login(username, username + '-0000')).token;
  };
  tok.viewerA      = await mk('rbac-viewer-a', ['viewer'], siteA.id);
  tok.editorA      = await mk('rbac-editor-a', ['editor'], siteA.id);
  tok.editorNoSite = await mk('rbac-editor-nosite', ['editor'], null);
  tok.adminNoSite  = await mk('rbac-admin-nosite', ['admin'], null);
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

// ── A12 — monthly edits ──────────────────────────────────────────────────────
const monthly = (site) => `/api/reports/monthly/${site}/2026/9/edits`;
const body12 = { edited_lights: [], edited_actions: [], notes: 'x', status: 'draft' };

test('A12 a viewer cannot write the monthly report of their own site (403)', async () => {
  const r = await post(monthly(siteA.id), tok.viewerA, body12);
  assert.equal(r.status, 403);
});
test('A12 an editor cannot write the monthly report of ANOTHER site (403)', async () => {
  const r = await post(monthly(siteB.id), tok.editorA, body12);
  assert.equal(r.status, 403);
});
test('A12 a site-less editor is not global for the monthly report (403)', async () => {
  const r = await post(monthly(siteA.id), tok.editorNoSite, body12);
  assert.equal(r.status, 403);
});
test('A12 an editor CAN write the monthly report of their own site (200)', async () => {
  const r = await post(monthly(siteA.id), tok.editorA, body12);
  assert.equal(r.status, 200);
});
test('A12 an admin stays unscoped on the monthly report (200)', async () => {
  const r = await post(monthly(siteB.id), tok.adminNoSite, body12);
  assert.equal(r.status, 200);
});

// ── A12 — annual objectives ──────────────────────────────────────────────────
const objectives = (site) => `/api/reports/objectives/${site}/2026`;
test('A12 a viewer cannot write annual objectives (403)', async () => {
  const r = await post(objectives(siteA.id), tok.viewerA, []);
  assert.equal(r.status, 403);
});
test('A12 an editor cannot write another site\'s objectives (403)', async () => {
  const r = await post(objectives(siteB.id), tok.editorA, []);
  assert.equal(r.status, 403);
});
test('A12 an editor CAN write their own site\'s objectives (200)', async () => {
  const r = await post(objectives(siteA.id), tok.editorA, []);
  assert.equal(r.status, 200);
});

// ── A16 — reconciliation decision ────────────────────────────────────────────
test('A16 a viewer cannot record a reconciliation decision (403)', async () => {
  const r = await post('/api/assets/reconcile/decision', tok.viewerA, { device_key: 'x', decision: null });
  assert.equal(r.status, 403);
});
test('A16 an editor still reaches the decision handler (not 403)', async () => {
  const r = await post('/api/assets/reconcile/decision', tok.editorA, { device_key: 'x', decision: null });
  assert.notEqual(r.status, 403);
});

// ── A8 — site-less non-admin is not global on meetings / inspections ─────────
test('A8 a site-less editor cannot save a PV (403)', async () => {
  const r = await post('/api/meetings/save', tok.editorNoSite, { state: { header: { site_code: 'MGO', department: 'IT', meeting_date: '2026-09-01' } } });
  assert.equal(r.status, 403);
});
test('A8 a site-less editor cannot save an inspection (403)', async () => {
  const r = await post('/api/inspection/save', tok.editorNoSite, { state: { meta: { f_id: 'EM-IT-RBAC-1', f_site: 'MGO' } } });
  assert.equal(r.status, 403);
});
