'use strict';
// P5 / goal B2 — Site Actions register made usable, through the real app on PostgreSQL:
//   export.xlsx (perimeter, explicit columns, no amount) · bulk status (loops the EXISTING per-item update routes: same
//   RBAC, same transfer-status justification) · owner reassignment (justification + audit row, same write rule).
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'sa-p5-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'sap5-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'sap5-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'sap5-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, mdb, hounde, T = {}, A = {}, rid, uid;

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db'); mdb = require('../meetings-db');
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id;
  const mk = async (k, roles, site) => {
    const u = 'sap5_' + k;
    await rdb.createUser({ username: u, full_name: 'Person ' + k, password: u + 'pass1234', roles, site_id: site });
    T[k] = (await rdb.login(u, u + 'pass1234')).token;
  };
  await mk('ed', ['editor'], hounde);
  await mk('viewer', ['viewer'], hounde);
  await mk('nosite', ['editor']);
  await mk('admin', ['admin']);
  await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'mining', meeting_date: '2026-10-05', status: 'draft' },
    actions: [{ description: 'HGO one', status: 'open', owner_it: 'sap5_ed', target_date: '2026-10-10' }, { description: 'HGO two', status: 'open', target_date: '2026-10-11' }] }, null, null);
  await mdb.saveMeeting({ header: { site_code: 'MGO', department: 'mining', meeting_date: '2026-10-05', status: 'draft' },
    actions: [{ description: 'MGO other site', status: 'open', target_date: '2026-10-10' }] }, null, null);
  const h = await mdb.listActions({ site: 'HGO' }); const m = await mdb.listActions({ site: 'MGO' });
  A.h1 = h.find((x) => x.description === 'HGO one').id; A.h2 = h.find((x) => x.description === 'HGO two').id; A.m1 = m[0].id;
  rid = (await rdb.ensureReport(hounde, 2026, 33)).id;
  const dept = (await rdb.listDepartments({}))[0].name;
  await rdb.saveActionItems(rid, [{ task: 'a follow-up', department: dept, status: 'open', owner: 'old owner' }]);
  uid = (await rdb.getReport(rid)).action_items[0].uid;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const call = async (t, method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(t ? { 'x-report-token': t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, ct, body: /json/.test(ct) ? await r.json() : await r.arrayBuffer() };
};

test('export.xlsx: session required, own site only (admin tier any), explicit columns, never an amount', async () => {
  assert.equal((await call(null, 'GET', '/api/reports/site-actions/export.xlsx?site=HGO')).status, 401);
  assert.equal((await call(T.ed, 'GET', '/api/reports/site-actions/export.xlsx?site=MGO')).status, 403, 'another site');
  assert.equal((await call(T.nosite, 'GET', '/api/reports/site-actions/export.xlsx?site=HGO')).status, 403, 'a site-less account is not global');
  assert.equal((await call(T.ed, 'GET', '/api/reports/site-actions/export.xlsx?site=all')).status, 400);
  const r = await call(T.ed, 'GET', '/api/reports/site-actions/export.xlsx?site=HGO');
  assert.equal(r.status, 200); assert.match(r.ct, /spreadsheetml/);
  const XLSX = require('xlsx');
  const rows = XLSX.utils.sheet_to_json(XLSX.read(Buffer.from(r.body)).Sheets['Site actions']);
  assert.ok(rows.some((x) => x.title === 'HGO one' && x.ref === `meetings:${A.h1}` && x.site === 'HGO'));
  assert.ok(!rows.some((x) => /MGO/.test(x.title)), 'no other site');
  const R = require('../services/siteActionsRegister');
  for (const k of Object.keys(rows[0])) assert.ok(R.EXPORT_COLUMNS.includes(k), 'column ' + k);
  assert.ok(!R.EXPORT_COLUMNS.some((c) => /cost|budget|amount|usd|xof|price|money/i.test(c)), 'no money column');
  assert.equal((await call(T.admin, 'GET', '/api/reports/site-actions/export.xlsx?site=MGO')).status, 200);
});

test('bulk status loops the per-item routes: same RBAC per line, same justification rule', async () => {
  assert.equal((await call(T.ed, 'POST', '/api/reports/site-actions/bulk-status', { items: [], status: 'resolved' })).status, 400);
  let r = await call(T.viewer, 'POST', '/api/reports/site-actions/bulk-status', { items: [{ source: 'meetings', id: A.h2 }], status: 'in_progress' });
  assert.equal(r.status, 200); assert.equal(r.body.results[0].status, 403, 'a viewer is refused by the per-item route itself');
  // cancelling without a justification is refused line by line (statusTransfer), nothing written
  r = await call(T.ed, 'POST', '/api/reports/site-actions/bulk-status', { items: [{ source: 'meetings', id: A.h2 }], status: 'cancelled' });
  assert.equal(r.body.results[0].status, 400);
  assert.equal((await mdb.listActions({ site: 'HGO' })).find((x) => x.id === A.h2).status, 'open');
  r = await call(T.ed, 'POST', '/api/reports/site-actions/bulk-status', { items: [{ source: 'meetings', id: A.h2 }, { source: 'meetings', id: A.m1 }, { source: 'nope', id: '1' }], status: 'in_progress' });
  assert.deepStrictEqual(r.body.results.map((x) => x.status), [200, 403, 400], 'own site done, other site refused, junk rejected');
  assert.equal((await mdb.listActions({ site: 'HGO' })).find((x) => x.id === A.h2).status, 'in_progress');
  assert.equal((await mdb.listActions({ site: 'MGO' }))[0].status, 'open', 'the other site is untouched');
  const ups = await mdb.listActionUpdates(A.h2);
  assert.ok(ups.some((u) => u.status_change === 'in_progress'), 'the per-item audit row is written');
  r = await call(T.ed, 'POST', '/api/reports/site-actions/bulk-status', { items: [{ source: 'report', id: uid }], status: 'in_progress' });
  assert.equal(r.body.results[0].status, 200);
  assert.equal((await rdb.getReport(rid)).action_items[0].status, 'in_progress');
  assert.equal((await call(T.ed, 'POST', '/api/reports/site-actions/bulk-status', { items: Array.from({ length: 51 }, () => ({ source: 'meetings', id: A.h1 })), status: 'open' })).status, 400, 'at most 50 lines');
});

test('owner reassignment: justification mandatory, same site rule, audit row; submitted report frozen', async () => {
  assert.equal((await call(T.ed, 'POST', '/api/reports/site-actions/reassign', { source: 'meetings', id: A.h1, owner: 'bob' })).status, 400, 'no justification');
  assert.equal((await call(T.ed, 'POST', '/api/reports/site-actions/reassign', { source: 'meetings', id: A.h1, owner: 'bob', justification: 'short' })).status, 400);
  const why = 'Ana moved to the plant project';
  assert.equal((await call(T.ed, 'POST', '/api/reports/site-actions/reassign', { source: 'meetings', id: A.m1, owner: 'bob', justification: why })).status, 403, 'another site');
  assert.equal((await call(T.viewer, 'POST', '/api/reports/site-actions/reassign', { source: 'meetings', id: A.h1, owner: 'bob', justification: why })).status, 403, 'not an editor');
  assert.equal((await call(T.nosite, 'POST', '/api/reports/site-actions/reassign', { source: 'meetings', id: A.h1, owner: 'bob', justification: why })).status, 403, 'site-less is not global');
  const r = await call(T.ed, 'POST', '/api/reports/site-actions/reassign', { source: 'meetings', id: A.h1, owner: 'bob', justification: why });
  assert.equal(r.status, 200); assert.equal(r.body.previous, 'sap5_ed');
  assert.equal((await mdb.listActions({ site: 'HGO' })).find((x) => x.id === A.h1).owner_it, 'bob');
  assert.ok((await mdb.listActionUpdates(A.h1)).some((u) => /Owner reassigned: sap5_ed → bob\. Justification: Ana moved/.test(u.body)));
  const rr = await call(T.ed, 'POST', '/api/reports/site-actions/reassign', { source: 'report', id: uid, owner: 'carol', justification: why });
  assert.equal(rr.status, 200); assert.equal((await rdb.getReport(rid)).action_items[0].owner, 'carol');
  await rdb.updateReportStatus(rid, 'submitted', null);
  assert.equal((await call(T.ed, 'POST', '/api/reports/site-actions/reassign', { source: 'report', id: uid, owner: 'dave', justification: why })).status, 403, 'submitted report frozen');
  assert.equal((await call(T.ed, 'POST', '/api/reports/site-actions/reassign', { source: 'meetings', id: 999999, owner: 'x', justification: why })).status, 404);
});
