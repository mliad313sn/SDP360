'use strict';
// POST /api/reports/action/:uid/relineage — the per-row "Fusionner avec…" merge:
// re-lineage an already-saved follow-up into a canonical one, then verify the hub
// folds them AND that closing the newest closes the group (newest-wins). sqlite.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'relin-'));
process.env.DASH_USER = process.env.DASH_USER || 'relin-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'relin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'relin-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, token, siteId, w40, w41, canonicalLineage, newestUid, dept;

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const r = http.request(base + path, { method: 'POST', headers: {
      'x-report-token': token, 'x-dash-key': process.env.DASHBOARD_API_KEY,
      'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); });
    r.on('error', reject); r.write(data); r.end();
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const site = (await rdb.listSiteModuleCodes('meetings'))[0];
  siteId = site.site_id;
  dept = (await rdb.listDepartments({}))[0].name;
  w40 = (await rdb.ensureReport(siteId, 2026, 40)).id;
  w41 = (await rdb.ensureReport(siteId, 2026, 41)).id;
  await rdb.saveActionItems(w40, [{ task: 'Helix deployment', department: dept, status: 'open', lineage: 'HX' }]);
  await rdb.saveActionItems(w41, [{ task: 'Helix deploy (fiber)', department: dept, status: 'open' }]);
  newestUid = (await rdb.getReport(w41)).action_items[0].uid;
  canonicalLineage = 'HX';
  const me = ((await rdb.listUsers()) || []).find(u => u.username === process.env.DASH_USER);
  (await rdb.setUserRoles(me.id, ['admin']));
  token = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await new Promise(res => { server = http.createServer(app).listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('two separate follow-ups before merge, each carrying year + week_number', async () => {
  const rdb = require('../reports-db');
  const { actions } = await rdb.getSiteOpenReportActions(siteId);
  assert.equal(actions.length, 2, 'both visible before merge');
  assert.ok(actions.every(a => Number.isInteger(a.year) && Number.isInteger(a.week_number)),
    'the merge-cleanup window needs year/week_number to pick the most-recent canonical');
});

test('relineage merges them → hub shows only the newest', async () => {
  const r = await post(`/api/reports/action/${newestUid}/relineage`, { lineage: canonicalLineage });
  assert.equal(r.status, 200);
  const rdb = require('../reports-db');
  const { actions } = await rdb.getSiteOpenReportActions(siteId);
  assert.equal(actions.length, 1, 'folded into one lineage');
  assert.equal(actions[0].task, 'Helix deploy (fiber)', 'newest (W41) wins');
  assert.equal(actions[0].lineage, 'HX');
});

test('closing the newest closes the group — the older open copy does NOT resurface', async () => {
  const r = await post(`/api/reports/action/${newestUid}/status`, { status: 'closed' });
  assert.equal(r.status, 200);
  const rdb = require('../reports-db');
  const { actions } = await rdb.getSiteOpenReportActions(siteId);
  assert.equal(actions.length, 0, 'newest closed → whole lineage gone, W40 open must not reappear');
});

test('validation: empty lineage 400, unknown uid 404', async () => {
  assert.equal((await post(`/api/reports/action/${newestUid}/relineage`, { lineage: '' })).status, 400);
  assert.equal((await post(`/api/reports/action/nope-uid/relineage`, { lineage: 'HX' })).status, 404);
});

// Runs LAST — mutates w40's lineage/task, so it must not disturb the merge/close
// sequence above. Proves the optional task-rename (unify a group onto the winner).
test('relineage can also RENAME the task (unify a merged group onto the winner label)', async () => {
  const rdb = require('../reports-db');
  const w40Uid = (await rdb.getReport(w40)).action_items[0].uid;
  const r = await post(`/api/reports/action/${w40Uid}/relineage`, { lineage: 'GRP', task: 'Helix (canonical)' });
  assert.equal(r.status, 200);
  const row = (await rdb.getReport(w40)).action_items[0];
  assert.equal(row.task, 'Helix (canonical)', 'older row renamed to the winner label');
  assert.equal(row.lineage, 'GRP', 'lineage set');
});

// 2026-10-15 — the merge moves the WHOLE group, not one row. A chain carried over several
// weeks (W42 → W43) merged into another chain (W45) must not leave its W42 copy behind:
// before the fix only the newest row moved and the older copy re-appeared as an open action.
test('merging a carried chain moves every week of it — no ghost resurfaces', async () => {
  const rdb = require('../reports-db');
  const w42 = (await rdb.ensureReport(siteId, 2026, 42)).id;
  const w43 = (await rdb.ensureReport(siteId, 2026, 43)).id;
  const w45 = (await rdb.ensureReport(siteId, 2026, 45)).id;
  await rdb.saveActionItems(w42, [{ task: 'Protection foudre', department: dept, status: 'on_hold' }]);
  const root = (await rdb.getReport(w42)).action_items[0].uid;
  await rdb.saveActionItems(w43, [{ task: 'Protection foudre', department: dept, status: 'on_hold', lineage: root }]);
  const newestOfChain = (await rdb.getReport(w43)).action_items[0].uid;
  await rdb.saveActionItems(w45, [{ task: 'Protection des équipements contre la foudre', department: dept, status: 'open' }]);
  const canonical = (await rdb.getReport(w45)).action_items[0].uid;
  const open = async () => (await rdb.getSiteOpenReportActions(siteId)).actions.filter(a => /foudre/.test(a.task));
  assert.equal((await open()).length, 2, 'two groups before');
  const r = await post(`/api/reports/action/${newestOfChain}/relineage`, { lineage: canonical, task: 'Protection des équipements contre la foudre' });
  assert.equal(r.status, 200);
  assert.equal(r.body.rows, 2, 'both weeks of the merged chain moved');
  const after = await open();
  assert.equal(after.length, 1, 'one group after — the W42 copy did not come back');
  assert.equal(after[0].week_label, (await rdb.getReport(w45)).week_label);
  // and the older copy now carries the winner's label too
  assert.equal((await rdb.getReport(w42)).action_items[0].task, 'Protection des équipements contre la foudre');
});
