'use strict';
const fetch = require('./_http-fetch');
// E-K03 — red figure → linked action, through the real server: switch off = 404 / refused; on: create from a red
// figure links it ('metric' source), a second open action on the same figure is refused (409 naming the first),
// another site's editor and a viewer are refused, the link list never shows another site's figure.
const _os = require('os'), _fs = require('fs'), _path = require('path');
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'redact-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'redact-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'redact-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'redact-smoke-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, hounde, mana, editor, otherEditor, viewer, superT;
const cfg = (patch) => require('../services/reportConfig').setConfig(rdb.db, patch, 'test');

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 50; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'commitments'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, role, roles, site) => { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', role, roles, site_id: site }); } catch {} return (await rdb.login(u, u + 'pass1234')).token; };
  editor = await mk('ra_editor', 'editor', ['editor'], hounde); otherEditor = await mk('ra_other', 'editor', ['editor'], mana);
  viewer = await mk('ra_viewer', 'viewer', ['viewer'], hounde); superT = await mk('ra_super', 'super_admin', ['super_admin']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  await cfg({ commitments_enabled: '1' });
});
after(() => server && server.close());
const H = (t, extra) => ({ headers: Object.assign(t ? { 'x-report-token': t } : {}, extra || {}) });
const get = (p, t) => fetch(base + p, H(t));
const send = (m, p, t, body) => fetch(base + p, { method: m, ...H(t, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
const sid = (site) => `helpdesk.resolution_sla_pct|${site}|2026-10`;
const create = (t, site, link, extra) => send('POST', '/api/commitments', t, { kind: 'issue', title: 'Resolution SLA is red', site_id: site, metric_link: link, ...(extra || {}) });

test('switch off: metric-links is 404, a create carrying metric_link is refused, a metric link cannot be attached', async () => {
  assert.equal((await get('/api/commitments/metric-links?ids=' + encodeURIComponent(sid(hounde)), editor)).status, 404);
  const r = await create(editor, hounde, sid(hounde));
  assert.equal(r.status, 400);
  const plain = await (await send('POST', '/api/commitments', editor, { kind: 'issue', title: 'plain', site_id: hounde })).json();
  assert.equal((await send('POST', `/api/commitments/${plain.commitment.id}/links`, editor, { source_system: 'metric', source_id: sid(hounde) })).status, 400);
  await cfg({ dashboard_red_action_links: '1' });
});

let firstId;
test('create from a red figure: 201, linked as source_system=metric with the documented source id', async () => {
  const r = await create(editor, hounde, sid(hounde));
  assert.equal(r.status, 201);
  const c = (await r.json()).commitment; firstId = c.id;
  assert.ok(c.links.some((l) => l.source_system === 'metric' && l.source_id === sid(hounde) && l.relation === 'red_kpi'));
  const m = await (await get('/api/commitments/metric-links?ids=' + encodeURIComponent(sid(hounde)), editor)).json();
  assert.equal(m.links[sid(hounde)].count, 1); assert.equal(m.links[sid(hounde)].open[0].id, firstId); assert.equal(m.links[sid(hounde)].can_create, true);
  const list = await (await get('/api/commitments?metric=' + encodeURIComponent(sid(hounde)), editor)).json();
  assert.deepEqual(list.commitments.map((x) => x.id), [firstId]);
});

test('a second open action on the same red figure is refused with 409 naming the first', async () => {
  const r = await create(superT, hounde, sid(hounde));
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, new RegExp('#' + firstId));
});

test('site scope: another site\'s editor and a viewer are refused; the figure must be on the action\'s site', async () => {
  assert.equal((await create(otherEditor, hounde, sid(hounde))).status, 403);
  assert.equal((await create(viewer, hounde, sid(hounde))).status, 403);
  assert.equal((await create(editor, hounde, sid(mana))).status, 400, 'link of another site than the action');
  assert.equal((await create(editor, hounde, 'not-a-source')).status, 400);
  const m = await (await get('/api/commitments/metric-links?ids=' + encodeURIComponent(sid(hounde) + ',' + sid(mana)), otherEditor)).json();
  assert.ok(!(sid(hounde) in m.links), 'another site\'s figure is not listed');
  assert.equal(m.links[sid(mana)].count, 0); assert.equal(m.links[sid(mana)].can_create, true);
  const v = await (await get('/api/commitments/metric-links?ids=' + encodeURIComponent(sid(hounde)), viewer)).json();
  assert.equal(v.links[sid(hounde)].can_create, false, 'a viewer sees the count but cannot create');
});

test('a closed action frees the figure: a new action can then be created', async () => {
  let c = (await (await get('/api/commitments/' + firstId, superT)).json()).commitment;
  const r = await send('POST', `/api/commitments/${firstId}/transition`, superT, { to: 'cancelled_with_reason', version: c.version, reason: 'duplicate of a group-level action already running' });
  assert.equal(r.status, 200);
  const again = await create(editor, hounde, sid(hounde));
  assert.equal(again.status, 201);
});
