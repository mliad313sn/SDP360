'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Step 3 (SDP-DASH-2.0) — /api/metrics/registry, /api/metrics/:key (site-scoped) and
// /api/registry/sites (admin). Throwaway sqlite; boots the app in-process.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'metrics-routes-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'mr-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'mr-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'mr-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, admin, viewer;
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });


before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  await rdb.createUser({ username: 'mr-admin', full_name: 'MR Admin', password: 'mr-admin-0000', roles: ['admin'] });
  await rdb.createUser({ username: 'mr-viewer', full_name: 'MR Viewer', password: 'mr-viewer-0000', roles: ['viewer'] });
  admin = (await rdb.login('mr-admin', 'mr-admin-0000')).token;
  viewer = (await rdb.login('mr-viewer', 'mr-viewer-0000')).token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('registry: any session, at least 40 KPIs', async () => {
  const r = await fetch(base + '/api/metrics/registry', { headers: H(viewer) });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.count >= 40 && j.metrics.length === j.count);
  assert.equal((await fetch(base + '/api/metrics/registry')).status, 401);
});

test('one KPI: validation, site scope, value from the reader', async () => {
  const codes = await rdb.listSiteModuleCodes('meetings');
  assert.ok(codes.length, 'seeded meetings codes');
  const code = codes[0].code;
  assert.equal((await fetch(base + '/api/metrics/nope?site=' + code, { headers: H(admin) })).status, 404);
  assert.equal((await fetch(base + '/api/metrics/meetings.pvs_held', { headers: H(admin) })).status, 400);
  assert.equal((await fetch(base + '/api/metrics/meetings.pvs_held?site=' + code + '&month=2026-13', { headers: H(admin) })).status, 400);
  assert.equal((await fetch(base + '/api/metrics/meetings.pvs_held?site=' + code, { headers: H(viewer) })).status, 403, 'site-less viewer');
  const r = await fetch(base + '/api/metrics/meetings.pvs_held?site=' + code + '&month=2026-09', { headers: H(admin) });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.site, code);
  assert.deepEqual(j.window, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(j.value, 0);
  assert.equal((await fetch(base + '/api/metrics/score.programme?site=' + code, { headers: H(admin) })).status, 422);
});

test('site registry: admin only, every site listed', async () => {
  assert.equal((await fetch(base + '/api/registry/sites', { headers: H(viewer) })).status, 403);
  const r = await fetch(base + '/api/registry/sites', { headers: H(admin) });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.sites.length, (await rdb.listSites()).length);
  assert.ok(j.modules.includes('meetings'));
  assert.ok(typeof j.summary.blocking_issues === 'number');
});

// ── Step 6 (lot 6.2) — group scope, series, freshness ──────────────────────
test('group figures: admin tier and the read-only direction role only', async () => {
  await rdb.createUser({ username: 'mr-sv', full_name: 'MR Scorecard', password: 'mr-sv-0000', roles: ['viewer', 'scorecard-viewer'] });
  const sv = (await rdb.login('mr-sv', 'mr-sv-0000')).token;
  assert.equal((await fetch(base + '/api/metrics/helpdesk.inbound?scope=group', { headers: H(viewer) })).status, 403);
  for (const t of [admin, sv]) {
    const r = await fetch(base + '/api/metrics/helpdesk.sla_res_pct?scope=group&month=2026-09', { headers: H(t) });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.scope, 'group');
    assert.ok(j.sites > 0);
    assert.equal(j.value, null, 'empty database: not measured, never 0');
    assert.match(j.group_rule, /numerators/);
  }
});

test('series: validation, 13 weekly points by default, a monthly-only figure refuses weeks', async () => {
  const code = (await rdb.listSiteModuleCodes('meetings'))[0].code;
  assert.equal((await fetch(base + '/api/metrics/helpdesk.inbound/series?scope=group&grain=day', { headers: H(admin) })).status, 400);
  assert.equal((await fetch(base + '/api/metrics/helpdesk.inbound/series?scope=group&points=40', { headers: H(admin) })).status, 400);
  assert.equal((await fetch(base + '/api/metrics/helpdesk.inbound/series?site=' + code, { headers: H(viewer) })).status, 403);
  const r = await fetch(base + '/api/metrics/helpdesk.inbound/series?scope=group&asOf=2026-10-22', { headers: H(admin) });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.points.length, 13);
  assert.equal(j.points[12].from, '2026-10-19');
  assert.equal((await fetch(base + '/api/metrics/meetings.pvs_held/series?site=' + code + '&grain=week', { headers: H(admin) })).status, 422);
  assert.equal((await fetch(base + '/api/metrics/meetings.pvs_held/series?site=' + code + '&grain=month&points=3', { headers: H(admin) })).status, 200);
});

test('freshness: any session, every domain present', async () => {
  assert.equal((await fetch(base + '/api/metrics/freshness')).status, 401);
  const r = await fetch(base + '/api/metrics/freshness', { headers: H(viewer) });
  assert.equal(r.status, 200);
  const j = await r.json();
  for (const d of ['helpdesk', 'changes', 'survey', 'infra', 'meetings']) assert.ok(j.domains[d], d);
  assert.equal(j.domains.meetings.status, 'live');
});
