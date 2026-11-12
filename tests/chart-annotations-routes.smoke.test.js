'use strict';
const fetch = require('./_http-fetch');
// E-V08 — /api/dashboards/annotations: switch 0 → 404; read scope = the viewer's sites; source mandatory;
// editor writes on own site only; group-wide note = admin tier; soft delete; "annotations" is not a dashboard key.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ann-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'ann-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ann-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ann-smoke-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, admin, editor, viewer, other, siteId, otherSite, rdb, cfg;

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  cfg = require('../services/reportConfig');
  const sites = await rdb.listSites({ includeInactive: true });
  siteId = sites.find((s) => /hounde/i.test(s.name)).id; otherSite = sites.find((s) => s.id !== siteId).id;
  const mk = async (u, role, roles, site) => { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', role, roles, site_id: site }); } catch {} return (await rdb.login(u, u + 'pass1234')).token; };
  admin = await mk('ann_admin', 'admin', ['admin'], null);
  editor = await mk('ann_editor', 'editor', ['editor'], siteId);
  other = await mk('ann_other', 'editor', ['editor'], otherSite);
  viewer = await mk('ann_viewer', 'viewer', ['viewer'], siteId);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const H = (t, extra) => ({ headers: Object.assign(t ? { 'x-report-token': t } : {}, extra || {}) });
const get = (p, t) => fetch(base + p, H(t));
const send = (m, p, t, body) => fetch(base + p, { method: m, ...H(t, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
const note = (extra) => Object.assign({ at: '2026-10-05', label: 'ISP outage', source_kind: 'ticket', source_ref: '#312004', metric_key: 'helpdesk.sla_res_pct' }, extra);

test('switch 0 (default) → every annotation route answers 404, nothing is created', async () => {
  await cfg.setConfig(rdb.db, { chart_annotations_enabled: '0' }, 'test');
  assert.equal((await get('/api/dashboards/annotations', editor)).status, 404);
  assert.equal((await send('POST', '/api/dashboards/annotations', editor, note({ site_id: siteId }))).status, 404);
  assert.equal((await send('DELETE', '/api/dashboards/annotations/1', editor)).status, 404);
  assert.equal((await get('/api/dashboards/annotations')).status, 401);
});

test('switch 1 → create on own site (source mandatory), read scope = the viewer\'s sites', async () => {
  await cfg.setConfig(rdb.db, { chart_annotations_enabled: '1' }, 'test');
  const noSrc = await send('POST', '/api/dashboards/annotations', editor, note({ site_id: siteId, source_ref: '' }));
  assert.equal(noSrc.status, 400);
  assert.match((await noSrc.json()).error, /source/);
  assert.equal((await send('POST', '/api/dashboards/annotations', viewer, note({ site_id: siteId }))).status, 403, 'viewer cannot write');
  assert.equal((await send('POST', '/api/dashboards/annotations', editor, note({ site_id: otherSite }))).status, 403, 'not their site');
  assert.equal((await send('POST', '/api/dashboards/annotations', editor, note({ site_id: null }))).status, 403, 'group-wide = admin tier');
  const c = await send('POST', '/api/dashboards/annotations', editor, note({ site_id: siteId }));
  assert.equal(c.status, 201);
  const a = (await c.json()).annotation;
  assert.equal(a.source_ref, '#312004'); assert.equal(a.site_id, siteId);
  const g = await send('POST', '/api/dashboards/annotations', admin, note({ site_id: null, metric_key: null, label: 'Group-wide change freeze', source_kind: 'decision', source_ref: 'CAB-2026-11' }));
  assert.equal(g.status, 201);
  await send('POST', '/api/dashboards/annotations', other, note({ site_id: otherSite, label: 'Other site note' }));

  const mine = (await (await get('/api/dashboards/annotations', viewer)).json()).annotations.map((x) => x.label).sort();
  assert.deepEqual(mine, ['Group-wide change freeze', 'ISP outage'], 'own site + group-wide, never another site');
  assert.equal((await get('/api/dashboards/annotations?site=' + otherSite, viewer)).status, 403);
  const all = (await (await get('/api/dashboards/annotations', admin)).json()).annotations;
  assert.equal(all.length, 3);
  const m = (await (await get('/api/dashboards/annotations?metric=other.metric', admin)).json()).annotations.map((x) => x.label);
  assert.deepEqual(m, ['Group-wide change freeze'], 'a metric filter keeps the notes of that metric + notes for every metric');

  assert.equal((await send('DELETE', '/api/dashboards/annotations/' + a.id, other)).status, 403, 'other site editor cannot delete');
  assert.equal((await send('DELETE', '/api/dashboards/annotations/' + a.id, editor)).status, 200);
  assert.equal((await send('DELETE', '/api/dashboards/annotations/' + a.id, editor)).status, 404, 'soft-deleted = gone');
  const row = await rdb.pgHandle().prepare('SELECT deleted_at, deleted_by FROM chart_annotations WHERE id = ?').get(a.id);
  assert.ok(row.deleted_at, 'kept with deleted_at (audit)');
  await cfg.setConfig(rdb.db, { chart_annotations_enabled: '0' }, 'test');
});
