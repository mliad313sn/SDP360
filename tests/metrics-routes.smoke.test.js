'use strict';
const fetch = require('./_http-fetch');
// Step 3 — /api/metrics/* on sqlite: registry listing, a value through the real readers,
// scope (an editor may not read another site), 404 on unknown key, 400 without site.
const _os = require('os'), _fs = require('fs'), _path = require('path');
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'metrics-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'metrics-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'metrics-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'metrics-smoke-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, admin, editor, siteId, otherSite;

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const sites = rdb.listSites({ includeInactive: true });
  siteId = sites.find((s) => /hounde/i.test(s.name)).id; otherSite = sites.find((s) => s.id !== siteId).id;
  try { await rdb.createUser({ username: 'mx_admin', full_name: 'A', password: 'adminpass1234', role: 'admin', roles: ['admin'] }); } catch {}
  try { await rdb.createUser({ username: 'mx_editor', full_name: 'E', password: 'editorpass1234', role: 'editor', roles: ['editor'], site_id: siteId }); } catch {}
  admin = (await rdb.login('mx_admin', 'adminpass1234')).token;
  editor = (await rdb.login('mx_editor', 'editorpass1234')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const get = (p, t) => fetch(base + p, t ? { headers: { 'x-report-token': t } } : {});

test('registry: 401 without session, lists ≥ 40 metrics with policies', async () => {
  assert.equal((await get('/api/metrics/registry')).status, 401);
  const r = await get('/api/metrics/registry', editor); assert.equal(r.status, 200);
  const j = await r.json(); assert.ok(j.count >= 40); assert.ok(j.policies['site-score']); assert.ok(j.metrics.every((m) => m.key && m.formula));
  const h = await (await get('/api/metrics/registry?module=helpdesk', editor)).json(); assert.ok(h.metrics.every((m) => m.module === 'helpdesk'));
});

test('value: helpdesk metric for an empty site resolves to a measured zero / null, never 500', async () => {
  const r = await get(`/api/metrics/helpdesk.resolution_sla_pct?site=${siteId}&window=2026-09`, admin);
  assert.equal(r.status, 200); const j = await r.json();
  assert.equal(j.key, 'helpdesk.resolution_sla_pct'); assert.equal(j.window.label, '2026-09'); assert.ok(j.value === null); assert.equal(j.rag, 'NA');
  const inb = await (await get(`/api/metrics/helpdesk.inbound?site=${siteId}&window=2026-09`, admin)).json();
  assert.ok(inb.value === 0 || inb.value === null, 'measured zero or not measured');
  const fleet = await (await get('/api/metrics/tracker.fleet_score_pct', admin)).json(); assert.equal(fleet.ok, true);
});

test('scope + validation: editor reads own site, 403 on another, 404 unknown key, 400 no site / bad site', async () => {
  assert.equal((await get(`/api/metrics/assets.total?site=${siteId}`, editor)).status, 200);
  assert.equal((await get(`/api/metrics/assets.total?site=${otherSite}`, editor)).status, 403);
  assert.equal((await get(`/api/metrics/assets.total?site=${otherSite}`, admin)).status, 200);
  assert.equal((await get('/api/metrics/does.not.exist?site=1', admin)).status, 404);
  assert.equal((await get('/api/metrics/assets.total', admin)).status, 400);
  assert.equal((await get('/api/metrics/assets.total?site=abc', admin)).status, 400);
});
