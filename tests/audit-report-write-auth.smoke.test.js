'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Audit OPS 2026-09-05 — F5: report section writes (PUT /api/reports/:id/{infra,helpdesk,
// lights,actions}) and follow-up writes by uid (POST /api/reports/action/:uid/{status,relineage})
// must be authorised against the OBJECT's site + the caller's role + the report's state —
// a valid session alone must not be enough. Throwaway sqlite; boots the app in-process.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'audit-auth-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'audit-auth-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'audit-auth-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'audit-auth-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb;
let siteA, siteB, reportA, reportB, actionUidB;
const tok = {};

const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const put = (path, t, body) => fetch(base + path, { method: 'PUT', headers: H(t), body: JSON.stringify(body) });
const post = (path, t, body) => fetch(base + path, { method: 'POST', headers: H(t), body: JSON.stringify(body) });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const sites = rdb.listSites() || [];
  assert.ok(sites.length >= 2, 'two seeded sites');
  siteA = sites[0]; siteB = sites[1];
  reportA = rdb.ensureReport(siteA.id, 2026, 30);
  reportB = rdb.ensureReport(siteB.id, 2026, 30);
  rdb.saveActionItems(reportB.id, [{ task: 'Site B follow-up', department: 'IT', priority: 'Medium', status: 'open' }]);
  actionUidB = (await rdb.getReport(reportB.id)).action_items[0].uid;
  assert.ok(actionUidB, 'the seeded follow-up carries a uid');

  const me = (rdb.listUsers() || []).find(u => u.username === process.env.DASH_USER);
  rdb.setUserRoles(me.id, ['super_admin']);
  tok.super = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  const mk = async (username, roles, site_id) => {
    await rdb.createUser({ username, full_name: username, password: username + '-0000', roles, site_id });
    return (await rdb.login(username, username + '-0000')).token;
  };
  tok.editorA = await mk('audit-editor-a', ['editor'], siteA.id);
  tok.editorB = await mk('audit-editor-b', ['editor'], siteB.id);
  tok.viewerA = await mk('audit-viewer-a', ['viewer'], siteA.id);
  tok.editorNoSite = await mk('audit-editor-nosite', ['editor'], null);

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('editor of site A cannot write the infra section of a site-B report (403)', async () => {
  const r = await put(`/api/reports/${reportB.id}/infra`, tok.editorA, []);
  assert.equal(r.status, 403, `expected 403, got ${r.status}`);
});

test('the same cross-site refusal covers helpdesk, lights and actions', async () => {
  for (const [sec, body] of [['helpdesk', {}], ['lights', []], ['actions', []]]) {
    const r = await put(`/api/reports/${reportB.id}/${sec}`, tok.editorA, body);
    assert.equal(r.status, 403, `${sec}: expected 403, got ${r.status}`);
  }
});

test('a viewer cannot write a section of their OWN site report (403)', async () => {
  const r = await put(`/api/reports/${reportA.id}/infra`, tok.viewerA, []);
  assert.equal(r.status, 403, `expected 403, got ${r.status}`);
});

test('an editor with NO site on the profile is not global — 403 on any report', async () => {
  const r = await put(`/api/reports/${reportA.id}/lights`, tok.editorNoSite, []);
  assert.equal(r.status, 403, `expected 403, got ${r.status}`);
});

test('editor of site A CAN write the draft report of site A (200)', async () => {
  const r = await put(`/api/reports/${reportA.id}/lights`, tok.editorA, []);
  assert.equal(r.status, 200, `expected 200, got ${r.status}`);
});

test('unknown report → 404, not 500', async () => {
  const r = await put(`/api/reports/99999999/lights`, tok.super, []);
  assert.equal(r.status, 404, `expected 404, got ${r.status}`);
});

test('a SUBMITTED report refuses section writes from its own editor (403); super_admin may still edit', async () => {
  rdb.updateReportStatus(reportA.id, 'submitted', null);
  const r1 = await put(`/api/reports/${reportA.id}/lights`, tok.editorA, []);
  assert.equal(r1.status, 403, `editor on submitted: expected 403, got ${r1.status}`);
  const r2 = await put(`/api/reports/${reportA.id}/lights`, tok.super, []);
  assert.equal(r2.status, 200, `super_admin on submitted: expected 200, got ${r2.status}`);
  rdb.updateReportStatus(reportA.id, 'draft', null);
});

test('follow-up status by uid: editor of site A cannot touch a site-B follow-up (403); site-B editor can (200)', async () => {
  const r1 = await post(`/api/reports/action/${actionUidB}/status`, tok.editorA, { status: 'closed' });
  assert.equal(r1.status, 403, `cross-site: expected 403, got ${r1.status}`);
  const r2 = await post(`/api/reports/action/${actionUidB}/status`, tok.editorB, { status: 'in_progress' });
  assert.equal(r2.status, 200, `own site: expected 200, got ${r2.status}`);
  const st = (await rdb.getReport(reportB.id)).action_items[0].status;
  assert.equal(st, 'in_progress', 'only the authorised write landed');
});

test('follow-up relineage by uid is site-scoped the same way (403 cross-site)', async () => {
  const r = await post(`/api/reports/action/${actionUidB}/relineage`, tok.editorA, { lineage: actionUidB });
  assert.equal(r.status, 403, `expected 403, got ${r.status}`);
});

test('status change is site-scoped: editor of site A cannot submit a site-B report (403); own draft → 200', async () => {
  const r1 = await put(`/api/reports/${reportB.id}/status`, tok.editorA, { status: 'ready' });
  assert.equal(r1.status, 403, `cross-site status: expected 403, got ${r1.status}`);
  const r2 = await put(`/api/reports/${reportA.id}/status`, tok.editorA, { status: 'in_progress' });
  assert.equal(r2.status, 200, `own-site status: expected 200, got ${r2.status}`);
});

test('reassign-week and DELETE refuse a site-less editor and a cross-site editor (403)', async () => {
  const r1 = await put(`/api/reports/${reportB.id}/reassign-week`, tok.editorA, { year: 2026, week: 31 });
  assert.equal(r1.status, 403, `cross-site reassign: expected 403, got ${r1.status}`);
  const r2 = await put(`/api/reports/${reportA.id}/reassign-week`, tok.editorNoSite, { year: 2026, week: 31 });
  assert.equal(r2.status, 403, `site-less reassign: expected 403, got ${r2.status}`);
  const r3 = await fetch(base + `/api/reports/${reportA.id}`, { method: 'DELETE', headers: H(tok.editorNoSite) });
  assert.equal(r3.status, 403, `site-less delete: expected 403, got ${r3.status}`);
  assert.ok(await rdb.getReport(reportA.id), 'the report still exists');
});

test('unknown uid → 404 for an authorised editor, not 500', async () => {
  const r = await post(`/api/reports/action/does-not-exist/status`, tok.super, { status: 'closed' });
  assert.equal(r.status, 404, `expected 404, got ${r.status}`);
});
