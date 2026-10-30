'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// 2026-10-15 — the "import actions from a previous week" window: each week counts only the
// actions still worth importing, each action says why it cannot be imported, and every
// action carries its group identity (code, first week, number of weeks). sqlite, in-process.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'act-import-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'ai-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ai-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ai-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, tok, r30, r31, cur, rdb;
const get = (path) => fetch(base + path, { headers: { 'x-report-token': tok } }).then(r => r.json());

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const siteId = (await rdb.listSites())[0].id;
  r30 = (await rdb.ensureReport(siteId, 2026, 30)); r31 = (await rdb.ensureReport(siteId, 2026, 31)); cur = (await rdb.ensureReport(siteId, 2026, 32));
  (await rdb.saveActionItems(r30.id, [{ task: 'Câblage atelier', department: 'IT', status: 'open' }]));
  const a = (await rdb.getReport(r30.id)).action_items[0].uid;
  (await rdb.saveActionItems(r31.id, [
    { task: 'Câblage atelier', department: 'IT', status: 'closed', lineage: a },
    { task: 'Radio upgrade', department: 'IT', status: 'open' },
    { task: 'Vieux projet', department: 'IT', status: 'cancelled' },
    { task: 'VSAT', department: 'IT', status: 'in_progress' },
  ]));
  const d = (await rdb.getReport(r31.id)).action_items.find(x => x.task === 'VSAT').uid;
  (await rdb.saveActionItems(cur.id, [{ task: 'VSAT', department: 'IT', status: 'in_progress', lineage: d }]));
  const me = (await rdb.listUsers()).find(u => u.username === process.env.DASH_USER);
  (await rdb.setUserRoles(me.id, ['super_admin']));
  tok = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('action-weeks counts only the actions still worth importing', async () => {
  const { weeks } = await get(`/api/reports/${cur.id}/action-weeks`);
  const w = Object.fromEntries(weeks.map(x => [x.report_id, x.action_count]));
  assert.equal(w[r30.id], 0, 'W30: its only action was closed in W31');
  assert.equal(w[r31.id], 1, 'W31: Radio only — closed, cancelled and already-carried are not counted');
});

test('actions-from marks each action importable or not, with the reason and its group', async () => {
  const d31 = await get(`/api/reports/${cur.id}/actions-from/${r31.id}`);
  const by = Object.fromEntries(d31.actions.map(x => [x.task, x]));
  assert.equal(by['Radio upgrade'].importable, true);
  assert.equal(by['VSAT'].reason, 'in_current');
  assert.equal(by['Vieux projet'].reason, 'cancelled');
  assert.ok(!by['Câblage atelier'] || by['Câblage atelier'].importable === false, 'a closed row is never importable');
  assert.match(by['Radio upgrade'].group.code, /^#[0-9A-Z]{4}$/);
  const d30 = await get(`/api/reports/${cur.id}/actions-from/${r30.id}`);
  assert.equal(d30.actions[0].reason, 'closed_since');
  assert.equal(d30.actions[0].closed_week, (await rdb.getReport(r31.id)).week_label);
  assert.equal(d30.actions[0].group.weeks, 2);
});

test('site-open-actions carries the group identity for the merge window', async () => {
  const { actions } = await get(`/api/reports/${cur.id}/site-open-actions`);
  const vsat = actions.find(x => x.task === 'VSAT');
  assert.ok(vsat && vsat.group, 'group attached');
  assert.equal(vsat.group.weeks, 2);
  assert.equal(vsat.group.first_week, (await rdb.getReport(r31.id)).week_label);
});
