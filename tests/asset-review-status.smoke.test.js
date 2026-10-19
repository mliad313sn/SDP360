'use strict';
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'asset-status-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'asset-review-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'asset-review-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'asset-review-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, adb, hounde, explo;
const tok = {};
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const put = (p, t, b) => fetch(base + p, { method: 'PUT', headers: H(t), body: JSON.stringify(b) });
const submit = (id, t) => put(`/api/reports/${id}/status`, t, { status: 'submitted' });
const COLS = ['asset_id', 'asset_name', 'site', 'state', 'user_name', 'department', 'purchase_cost', 'acquisition_date'];

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db'); adb = require('../assets-db');
  adb.replaceTable('assets', COLS, [{ asset_id: 'U1', asset_name: 'U', site: 'Hounde', state: 'In Use', user_name: '', department: '', purchase_cost: '5', acquisition_date: '2024-01-01' }]);
  adb.recordAssetSightings({ asOf: '2026-01-01' });
  const sites = rdb.listSites();
  hounde = sites.find(s => s.name === 'Hounde'); explo = sites.find(s => s.name === 'Exploration');
  const me = rdb.listUsers().find(u => u.username === process.env.DASH_USER);
  rdb.setUserRoles(me.id, ['super_admin']);
  tok.super = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  const mk = async (u, roles, site_id) => { await rdb.createUser({ username: u, full_name: u, password: u + '-0000', roles, site_id }); return (await rdb.login(u, u + '-0000')).token; };
  tok.editorH = await mk('st-editor-h', ['editor'], hounde.id);
  tok.editorX = await mk('st-editor-x', ['editor'], explo.id);
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('empty notes → 200, counts frozen, notes stay empty', async () => {
  const rep = rdb.ensureReport(hounde.id, 2026, 20);
  const r = await submit(rep.id, tok.editorH);
  assert.strictEqual(r.status, 200);
  const rev = rdb.getReportAssetReview(rep.id);
  assert.deepStrictEqual(rev.counts, { new: 0, no_tag: 1, unassigned: 1, no_cost: 0, no_date: 0,
    active_total: 1, unassigned_in_use: 1, unassigned_other: 0 });
  assert.strictEqual(rev.applicable, true);
  assert.strictEqual(rev.handled_note, null);
  assert.strictEqual(rdb.getReport(rep.id).status, 'submitted');
});

test('filled notes → 200 and notes untouched by the freeze', async () => {
  const rep = rdb.ensureReport(hounde.id, 2026, 21);
  rdb.saveReportAssetReview(rep.id, { handled_note: 'h', plan_note: 'p' }, 'c');
  assert.strictEqual((await submit(rep.id, tok.editorH)).status, 200);
  const rev = rdb.getReportAssetReview(rep.id);
  assert.deepStrictEqual([rev.handled_note, rev.plan_note, rev.counts.unassigned], ['h', 'p', 1]);
});

test('non-applicable site → 200, applicable:false', async () => {
  const rep = rdb.ensureReport(explo.id, 2026, 21);
  assert.strictEqual((await submit(rep.id, tok.editorX)).status, 200);
  assert.strictEqual(rdb.getReportAssetReview(rep.id).applicable, false);
});

test('assets layer throwing → 200 with null counts', async () => {
  const rep = rdb.ensureReport(hounde.id, 2026, 22);
  const orig = adb.getSiteAssetFollowups;
  adb.getSiteAssetFollowups = () => { throw new Error('assets down'); };
  try { assert.strictEqual((await submit(rep.id, tok.editorH)).status, 200); }
  finally { adb.getSiteAssetFollowups = orig; }
  assert.strictEqual(rdb.getReportAssetReview(rep.id).counts, null);
  assert.strictEqual(rdb.getReport(rep.id).status, 'submitted');
});

test('re-submitting an already submitted report keeps the frozen counts', async () => {
  const rep = rdb.ensureReport(hounde.id, 2026, 23);
  await submit(rep.id, tok.editorH);
  const before = rdb.getReportAssetReview(rep.id).counts;
  adb.replaceTable('assets', COLS, []);                            // the register changes afterwards
  assert.strictEqual((await submit(rep.id, tok.super)).status, 200);
  assert.deepStrictEqual(rdb.getReportAssetReview(rep.id).counts, before);
});

test('ready is not a freeze point', async () => {
  const rep = rdb.ensureReport(hounde.id, 2026, 24);
  assert.strictEqual((await put(`/api/reports/${rep.id}/status`, tok.editorH, { status: 'ready' })).status, 200);
  assert.strictEqual(rdb.getReportAssetReview(rep.id), null);
});

test('an editor from another site cannot submit a Hounde report (403); no freeze row is left', async () => {
  const rep = rdb.ensureReport(hounde.id, 2026, 25);
  const r = await submit(rep.id, tok.editorX);
  assert.strictEqual(r.status, 403);
  assert.strictEqual((await rdb.getReportAssetReview(rep.id)), null);
});
