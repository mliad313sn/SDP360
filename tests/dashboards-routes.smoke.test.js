'use strict';
const fetch = require('./_http-fetch');   // core-http shim (see tests/_http-fetch.js)
// Step 6 (lots 6.3-6.5) — /api/dashboards/*: audience, scope, view log, draft → publish → rollback → retire.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'dashboards-routes-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'db-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'db-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'db-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';
process.env.METRICS_CACHE_TTL_MS = '0';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, tok = {}, site;
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const get = (p, t) => fetch(base + p, { headers: H(t) });
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: H(t), body: body ? JSON.stringify(body) : undefined });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const codes = await rdb.listSiteModuleCodes('meetings');
  site = codes[0];
  const mk = async (u, roles, extra = {}) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pass-0000', roles, ...extra });
    tok[u] = (await rdb.login(u, u + '-pass-0000')).token;
  };
  await mk('db-exec', ['executive']);
  await mk('db-viewer', ['viewer']);
  await mk('db-author', ['viewer', 'dashboard-author']);
  await mk('db-pub', ['viewer', 'dashboard-publisher']);
  await mk('db-sitebiz', ['site-business'], { site_id: site.site_id });
  await mk('db-sa', ['super_admin']);
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('the direction space is seeded, published and reserved to its audience', async () => {
  const l = await (await get('/api/dashboards', tok['db-exec'])).json();
  const dir = l.dashboards.find(d => d.id === 'direction');
  assert.ok(dir && dir.visible && dir.kind === 'system' && dir.published_version === 1);
  const v = await (await get('/api/dashboards', tok['db-viewer'])).json();
  assert.ok(!v.dashboards.some(d => d.id === 'direction'), 'a viewer does not see it');
  assert.equal((await get('/api/dashboards/direction/data', tok['db-viewer'])).status, 403);
  assert.equal((await fetch(base + '/api/dashboards/direction/data')).status, 401);
  const r = await get('/api/dashboards/direction/data?month=2026-09', tok['db-exec']);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.context.scope, 'group');
  assert.equal(j.context.month, '2026-09');
  for (const w of j.definition.widgets) assert.ok(j.widgets[w.id], w.id);
  assert.deepStrictEqual(Object.keys(j.widgets).filter(k => j.widgets[k].error), [], 'no widget fails on an empty database');
  assert.equal(j.widgets.objectives.items[0].value, null, 'empty database: not measured, never 0');
  assert.ok(j.freshness.helpdesk, 'freshness attached');
});

test('a view is logged once per person and per day', async () => {
  await get('/api/dashboards/direction/data', tok['db-exec']);
  await get('/api/dashboards/direction/data', tok['db-exec']);
  const rows = await rdb.listSystemLog({ action: 'direction_viewed', limit: 50 });
  const mine = (rows.rows || rows).filter(r => r.actor === 'db-exec');
  assert.equal(mine.length, 1);
});

test('draft → publish → new version → rollback → retire', async () => {
  const definition = { id: 'ops-weekly', title: 'Revue opérationnelle', audience: { roles: ['any'] }, widgets: [{ type: 'kpi', metrics: ['helpdesk.inbound'] }, { type: 'text', markdown: 'v1' }] };
  assert.equal((await send('POST', '/api/dashboards', tok['db-viewer'], { definition })).status, 403, 'not an author');
  assert.equal((await send('POST', '/api/dashboards', tok['db-author'], { definition: { ...definition, widgets: [{ type: 'sql' }] } })).status, 400);
  assert.equal((await send('POST', '/api/dashboards', tok['db-author'], { definition })).status, 201);
  assert.equal((await send('POST', '/api/dashboards', tok['db-author'], { definition })).status, 409);
  assert.equal((await get('/api/dashboards/ops-weekly/data', tok['db-exec'])).status, 404, 'a draft is not on air');
  assert.equal((await send('POST', '/api/dashboards/ops-weekly/publish', tok['db-author'])).status, 403, 'an author does not publish');
  let p = await (await send('POST', '/api/dashboards/ops-weekly/publish', tok['db-pub'])).json();
  assert.equal(p.version, 1);
  assert.equal((await get('/api/dashboards/ops-weekly/data', tok['db-exec'])).status, 200);
  assert.equal((await get('/api/dashboards/ops-weekly/data', tok['db-viewer'])).status, 403, 'an "all sites" dashboard needs a group reader or a site');
  assert.equal((await send('PUT', '/api/dashboards/ops-weekly/draft', tok['db-author'], { definition: { ...definition, widgets: [{ type: 'text', markdown: 'v2' }] } })).status, 200);
  p = await (await send('POST', '/api/dashboards/ops-weekly/publish', tok['db-pub'], { note: 'second' })).json();
  assert.equal(p.version, 2);
  let d = await (await get('/api/dashboards/ops-weekly/data', tok['db-exec'])).json();
  assert.equal(d.widgets.w1.markdown, 'v2');
  const rb = await (await send('POST', '/api/dashboards/ops-weekly/rollback', tok['db-pub'], { version: 1 })).json();
  assert.deepStrictEqual([rb.version, rb.rollback_to], [3, 1]);
  d = await (await get('/api/dashboards/ops-weekly/data', tok['db-exec'])).json();
  assert.equal(d.version, 3);
  assert.equal(d.definition.widgets.length, 2, 'version 1 is back on air');
  const meta = await (await get('/api/dashboards/ops-weekly', tok['db-author'])).json();
  assert.deepStrictEqual(meta.versions.map(v => v.version), [3, 2, 1]);
  assert.equal((await send('DELETE', '/api/dashboards/ops-weekly', tok['db-author'])).status, 409, 'a published dashboard is retired, not deleted');
  assert.equal((await send('POST', '/api/dashboards/ops-weekly/retire', tok['db-pub'])).status, 200);
  assert.equal((await get('/api/dashboards/ops-weekly/data', tok['db-exec'])).status, 404);
  const logs = await rdb.listSystemLog({ action: 'dashboard_published', limit: 50 });
  assert.ok((logs.rows || logs).length >= 3, 'every publication is journalled');
});

test('system dashboards: only a super_admin edits or publishes them', async () => {
  assert.equal((await send('PUT', '/api/dashboards/direction/draft', tok['db-author'], { definition: { title: 'x', audience: { roles: ['any'] }, widgets: [{ type: 'text', markdown: 'x' }] } })).status, 403);
  assert.equal((await send('POST', '/api/dashboards/direction/publish', tok['db-pub'])).status, 403);
  assert.equal((await send('POST', '/api/dashboards/direction/publish', tok['db-sa'])).status, 200);
});

test('a site-scoped dashboard shows the viewer’s own site, never another', async () => {
  const definition = { id: 'my-site', title: 'Mon site', audience: { roles: ['any'], site_scope: 'own' }, widgets: [{ type: 'kpi', metrics: ['helpdesk.inbound'] }] };
  await send('POST', '/api/dashboards', tok['db-author'], { definition });
  await send('POST', '/api/dashboards/my-site/publish', tok['db-pub']);
  const r = await get('/api/dashboards/my-site/data', tok['db-viewer']);
  assert.equal(r.status, 403, 'no site on the account');
  const ok = await (await get('/api/dashboards/my-site/data', tok['db-sitebiz'])).json();
  assert.equal(ok.context.scope, 'site');
  assert.equal(ok.context.site.code, site.code);
  const other = (await rdb.listSiteModuleCodes('meetings')).find(c => c.code !== site.code);
  assert.equal((await get('/api/dashboards/my-site/data?site=' + other.code, tok['db-sitebiz'])).status, 403);
});

test('preview: an author sees an unsaved definition in a chosen scope', async () => {
  const definition = { id: 'tmp', title: 'Aperçu', audience: { roles: ['site-business'], site_scope: 'own' }, widgets: [{ type: 'kpi', metrics: ['helpdesk.inbound'] }] };
  assert.equal((await send('POST', '/api/dashboards/preview', tok['db-viewer'], { definition })).status, 403);
  const r = await send('POST', '/api/dashboards/preview', tok['db-sa'], { definition, as: { site: site.code } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.preview, true);
  assert.equal(j.context.site.code, site.code);
  assert.equal((await send('POST', '/api/dashboards/preview', tok['db-sa'], { definition: { id: 'x' } })).status, 400);
  const noSite = await (await send('POST', '/api/dashboards/preview', tok['db-sa'], { definition })).json();
  assert.equal(noSite.context.scope, 'site', 'an author without a site previews a one-site dashboard as the first site');
  const cat = await (await get('/api/dashboards/catalog', tok['db-sa'])).json();
  assert.ok(cat.preview_sites.length > 0 && cat.group_allowed === true);
  assert.equal(cat.widgets.length, 10);
});
