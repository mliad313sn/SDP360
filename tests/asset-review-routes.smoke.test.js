'use strict';
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'asset-review-'));
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

let server, base, rdb, hounde, mana, explo, repH, repPrev, repExplo;
const tok = {};
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const get = (p, t) => fetch(base + p, { headers: H(t) });
const put = (p, t, b) => fetch(base + p, { method: 'PUT', headers: H(t), body: JSON.stringify(b) });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const adb = require('../assets-db');
  const COLS = ['asset_id', 'asset_name', 'site', 'state', 'user_name', 'department', 'purchase_cost', 'acquisition_date'];
  adb.replaceTable('assets', COLS, [{ asset_id: 'B1', asset_name: 'B', site: 'Hounde', state: 'In Use', user_name: 'x', department: 'IT', purchase_cost: '5', acquisition_date: '2024-01-01' }]);
  adb.recordAssetSightings({ asOf: '2026-07-20' });
  adb.replaceTable('assets', COLS, [
    { asset_id: 'B1', asset_name: 'B', site: 'Hounde', state: 'In Use', user_name: 'x', department: 'IT', purchase_cost: '5', acquisition_date: '2024-01-01' },
    { asset_id: 'N1', asset_name: 'N', site: 'Hounde', state: 'In Use', user_name: '', department: '', purchase_cost: '0.00', acquisition_date: '' },
  ]);
  adb.recordAssetSightings({ asOf: '2026-07-28' });

  const sites = rdb.listSites();
  hounde = sites.find(s => s.name === 'Hounde');
  mana = sites.find(s => s.name === 'MANA');
  explo = sites.find(s => s.name === 'Exploration');
  repPrev = rdb.ensureReport(hounde.id, 2026, 29);
  rdb.saveReportAssetReview(repPrev.id, { applicable: true, counts: { new: 0, unassigned: 3, no_cost: 3, no_date: 3 } }, 'seed');
  repH = rdb.ensureReport(hounde.id, 2026, 30);      // 2026-07-26 .. 2026-08-01
  repExplo = rdb.ensureReport(explo.id, 2026, 30);

  const me = rdb.listUsers().find(u => u.username === process.env.DASH_USER);
  rdb.setUserRoles(me.id, ['super_admin']);
  tok.super = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  const mk = async (username, roles, site_id) => {
    await rdb.createUser({ username, full_name: username, password: username + '-0000', roles, site_id });
    return (await rdb.login(username, username + '-0000')).token;
  };
  tok.editorH = await mk('ar-editor-h', ['editor'], hounde.id);
  tok.viewerH = await mk('ar-viewer-h', ['viewer'], hounde.id);
  tok.editorM = await mk('ar-editor-m', ['editor'], mana.id);
  tok.editorNoSite = await mk('ar-editor-nosite', ['editor'], null);
  tok.admin = await mk('ar-admin', ['admin'], null);

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('GET asset-followups: same-site viewer 200 with counts, lists, previous_counts', async () => {
  const r = await get(`/api/reports/${repH.id}/asset-followups`, tok.viewerH);
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.applicable, true);
  assert.deepStrictEqual(j.counts, { new: 1, unassigned: 1, no_cost: 1, no_date: 1 });
  assert.deepStrictEqual(j.labels, ['Hounde']);
  assert.strictEqual(j.lists.new[0].asset_id, 'N1');
  assert.deepStrictEqual(j.previous_counts, { new: 0, unassigned: 3, no_cost: 3, no_date: 3 });
  assert.ok(!JSON.stringify(j).includes('purchase_cost'), 'no amount on the wire');
});

test('GET asset-followups: admin (no site) 200; other-site editor 403; site-less editor 403', async () => {
  assert.strictEqual((await get(`/api/reports/${repH.id}/asset-followups`, tok.admin)).status, 200);
  assert.strictEqual((await get(`/api/reports/${repH.id}/asset-followups`, tok.editorM)).status, 403);
  assert.strictEqual((await get(`/api/reports/${repH.id}/asset-followups`, tok.editorNoSite)).status, 403);
  assert.strictEqual((await get(`/api/reports/999999/asset-followups`, tok.super)).status, 404);
});

test('GET asset-followups: site without meetings code → applicable:false', async () => {
  const j = await (await get(`/api/reports/${repExplo.id}/asset-followups`, tok.super)).json();
  assert.strictEqual(j.applicable, false);
  assert.strictEqual(j.counts, null);
});

test('PUT asset-review: server freezes counts (client counts ignored), trims notes', async () => {
  const r = await put(`/api/reports/${repH.id}/asset-review`, tok.editorH,
    { handled_note: '  Tagged N1 ', plan_note: 'Assign user', counts: { new: 99 }, applicable: false });
  assert.strictEqual(r.status, 200);
  const rev = rdb.getReportAssetReview(repH.id);
  assert.deepStrictEqual(rev.counts, { new: 1, unassigned: 1, no_cost: 1, no_date: 1 });
  assert.strictEqual(rev.applicable, true);
  assert.strictEqual(rev.handled_note, 'Tagged N1');
});

test('PUT asset-review: write auth (viewer, other site, site-less → 403)', async () => {
  for (const t of [tok.viewerH, tok.editorM, tok.editorNoSite]) {
    assert.strictEqual((await put(`/api/reports/${repH.id}/asset-review`, t, { plan_note: 'x' })).status, 403);
  }
});

test('PUT asset-review: assets layer throwing → 200, notes saved, frozen counts kept', async () => {
  const adb = require('../assets-db');
  const orig = adb.getSiteAssetFollowups;
  adb.getSiteAssetFollowups = () => { throw new Error('assets down'); };
  try {
    const r = await put(`/api/reports/${repH.id}/asset-review`, tok.editorH, { handled_note: 'during outage', plan_note: 'p' });
    assert.strictEqual(r.status, 200);
  } finally { adb.getSiteAssetFollowups = orig; }
  const rev = rdb.getReportAssetReview(repH.id);
  assert.strictEqual(rev.handled_note, 'during outage');
  assert.deepStrictEqual(rev.counts, { new: 1, unassigned: 1, no_cost: 1, no_date: 1 }, 'counts from the previous save kept');
});

test('PUT asset-review on a SUBMITTED report (super_admin): notes only, counts never recomputed', async () => {
  rdb.saveReportAssetReview(repH.id, { applicable: true, counts: { new: 9, unassigned: 9, no_cost: 9, no_date: 9 } }, 'freeze');
  rdb.updateReportStatus(repH.id, 'submitted', 1);
  const r = await put(`/api/reports/${repH.id}/asset-review`, tok.super, { handled_note: 'late fix', plan_note: 'p2' });
  assert.strictEqual(r.status, 200);
  const rev = rdb.getReportAssetReview(repH.id);
  assert.deepStrictEqual(rev.counts, { new: 9, unassigned: 9, no_cost: 9, no_date: 9 });
  assert.strictEqual(rev.handled_note, 'late fix');
  assert.strictEqual((await put(`/api/reports/${repH.id}/asset-review`, tok.editorH, { plan_note: 'x' })).status, 403, 'editor frozen out after submission');
});
