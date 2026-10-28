'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// RBAC audit 2026-10-02, lot 4d — decision "open everything to coordinators, locked to
// their site", WAN SLA. The SLA tab was hidden from non-admins in the page while the
// routes served EVERY site's outages to any session. Now: open to an editor, every SLA
// read (summary, outages, CSV and Excel exports) limited to their site.
// Throwaway sqlite; boots the app in-process.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'wan-scope-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'wan-scope-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'wan-scope-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'wan-scope-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, siteA, siteB;
const tok = {};
const get = (p, t) => fetch(base + p, { headers: { 'x-report-token': t } });
const MONTH = '2026-09';

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  [siteA, siteB] = (await rdb.listSites());
  for (const [site, start] of [[siteA, '2026-09-10T08:00:00Z'], [siteB, '2026-09-11T08:00:00Z']]) {
    await rdb.upsertWanOutage({ site_id: site.id, sub_site: '', uplink: 'wan1', detected_start: start,
      restored_end: start.replace('08:00', '09:00'), duration_s: 3600, attribution: 'isp' });
  }
  const mk = async (username, roles, site_id) => {
    await rdb.createUser({ username, full_name: username, password: username + '-0000', roles, site_id });
    return (await rdb.login(username, username + '-0000')).token;
  };
  tok.editorA = await mk('wan-editor-a', ['editor'], siteA.id);
  tok.admin   = await mk('wan-admin', ['admin'], null);
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('outages: an editor only gets their own site, even when asking for another', async () => {
  const mine = (await (await get(`/api/analytics/wan/sla/outages?from=2026-09-01`, tok.editorA)).json()).outages;
  assert.ok(mine.length > 0 && mine.every(o => o.site_id === siteA.id), JSON.stringify(mine.map(o => o.site_id)));
  const other = (await (await get(`/api/analytics/wan/sla/outages?site=${siteB.id}&from=2026-09-01`, tok.editorA)).json()).outages;
  assert.ok(other.every(o => o.site_id === siteA.id));
});
test('summary: an editor never sees another site\'s circuits or unmapped outages', async () => {
  const body = await (await get(`/api/analytics/wan/sla/summary?month=${MONTH}`, tok.editorA)).json();
  assert.ok([...body.circuits, ...body.unmapped].every(c => c.site_id === siteA.id), JSON.stringify(body.unmapped));
});
test('CSV export: an editor only gets their own site', async () => {
  const csv = await (await get(`/api/analytics/wan/sla/export.csv?month=${MONTH}`, tok.editorA)).text();
  const rows = csv.replace(/^﻿/, '').trim().split(/\r?\n/).slice(1);
  assert.ok(rows.length > 0 && rows.every(l => l.replace(/^"/, '').startsWith(String(siteA.id) + (l.startsWith('"') ? '",' : ','))), rows.join(' | '));
});
test('the admin tier still sees every site', async () => {
  const all = (await (await get(`/api/analytics/wan/sla/outages?from=2026-09-01`, tok.admin)).json()).outages;
  assert.ok(all.some(o => o.site_id === siteB.id));
});
