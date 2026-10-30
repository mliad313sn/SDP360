'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// User decision 2026-10-02: reverting a SUBMITTED weekly report back to draft was
// super_admin-only — too restrictive in practice. Any admin-tier account (admin,
// executive, super_admin) may now revert; an editor still may not. The site scope is
// unchanged (_authorizeReportWrite: admin+ is unscoped). Throwaway sqlite.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'report-revert-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'report-revert-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'report-revert-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'report-revert-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, site, week = 40;
const tok = {};
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const setStatus = (id, t, status) => fetch(`${base}/api/reports/${id}/status`, { method: 'PUT', headers: H(t), body: JSON.stringify({ status }) });

async function submittedReport() {
  const r = (await rdb.ensureReport(site.id, 2026, week++));
  await rdb.updateReportStatus(r.id, 'submitted', null);
  return r.id;
}

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  site = (await rdb.listSites())[0];
  const mk = async (username, roles, site_id) => {
    await rdb.createUser({ username, full_name: username, password: username + '-0000', roles, site_id });
    return (await rdb.login(username, username + '-0000')).token;
  };
  tok.admin     = await mk('rv-admin',  ['admin'], site.id);
  tok.executive = await mk('rv-exec',   ['executive'], null);
  tok.editor    = await mk('rv-editor', ['editor'], site.id);
  tok.viewer    = await mk('rv-viewer', ['viewer'], site.id);
  const me = ((await rdb.listUsers()) || []).find(u => u.username === process.env.DASH_USER);
  (await rdb.setUserRoles(me.id, ['super_admin']));
  tok.super = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('an admin can revert a submitted report to draft (200)', async () => {
  const id = await submittedReport();
  const r = await setStatus(id, tok.admin, 'draft');
  assert.equal(r.status, 200);
  assert.equal((await rdb.getReport(id)).status, 'draft');
});

test('an executive can revert too (admin tier and above)', async () => {
  const id = await submittedReport();
  assert.equal((await setStatus(id, tok.executive, 'draft')).status, 200);
});

test('a super_admin still can', async () => {
  const id = await submittedReport();
  assert.equal((await setStatus(id, tok.super, 'draft')).status, 200);
});

test('an editor CAN revert a submitted report of their own site (decision 2026-10-02, 200)', async () => {
  const id = await submittedReport();
  assert.equal((await setStatus(id, tok.editor, 'draft')).status, 200);
  assert.equal((await rdb.getReport(id)).status, 'draft');
});

test('an editor cannot revert a submitted report of another site (403)', async () => {
  const other = (await rdb.listSites())[1];
  const r = (await rdb.ensureReport(other.id, 2026, week++));
  await rdb.updateReportStatus(r.id, 'submitted', null);
  assert.equal((await setStatus(r.id, tok.editor, 'draft')).status, 403);
  assert.equal((await rdb.getReport(r.id)).status, 'submitted');
});

test('a viewer cannot revert (403)', async () => {
  const id = await submittedReport();
  assert.equal((await setStatus(id, tok.viewer, 'draft')).status, 403);
});
