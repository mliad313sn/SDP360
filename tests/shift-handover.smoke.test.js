'use strict';
// C-21 (G45 G47) through the real server on PostgreSQL: scoped deputies are named only on shared sites, a
// deputy outside its scope is refused, a shift handover nobody accepted stays pending (flagged, never
// auto-accepted), only the incoming person (or an in-scope deputy) decides, the switch is off by default.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'shift-ho-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'sh-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'sh-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'sh-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');

let server, base, rdb, siteA, siteB; const tok = {}, ID = {};
before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'shift_handovers'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const sites = (await rdb.listSites()) || [];
  siteA = sites[0]; siteB = sites[1];
  const mk = async (u, roles, site_id) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pw-0000', roles, site_id });
    tok[u] = (await rdb.login(u, u + '-pw-0000')).token;
    ID[u] = Number((await rdb.pgHandle().prepare('SELECT id FROM users WHERE username=?').get(u)).id);
  };
  await mk('sh-out', ['editor'], siteA.id); await mk('sh-in', ['editor'], siteA.id);
  await mk('sh-dep', ['editor'], siteA.id); await mk('sh-other', ['editor'], siteB.id);
  await mk('sh-sadmin', ['admin'], siteA.id); await mk('sh-super', ['super_admin'], null);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const day = (n = 0) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

test('switch off by default: the shift handover routes answer 404', async () => {
  assert.equal((await send('GET', '/api/shift-handovers', tok['sh-in'])).status, 404);
});

test('scoped deputy: scope sites must be shared; out of scope it does not count', async () => {
  const base_ = { user_id: ID['sh-in'], deputy_id: ID['sh-dep'], start_date: day(), end_date: day(10), reason: 'night off' };
  const bad = await send('POST', '/api/governance/roles/deputies', tok['sh-super'], { ...base_, scope_site_ids: [siteB.id] });
  assert.equal(bad.status, 400, 'a scope site the two people do not share is refused');
  assert.equal((await send('POST', '/api/governance/roles/deputies', tok['sh-super'], { ...base_, scope_roles: ['nope'] })).status, 400);
  const ok = await send('POST', '/api/governance/roles/deputies', tok['sh-super'], { ...base_, scope_site_ids: [siteA.id], scope_roles: ['network-oncall'] });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const row = await rdb.pgHandle().prepare('SELECT scope_site_ids, scope_roles FROM deputies WHERE id = ?').get(ok.body.id);
  assert.deepEqual(JSON.parse(row.scope_site_ids), [Number(siteA.id)]); assert.deepEqual(JSON.parse(row.scope_roles), ['network-oncall']);
});

test('shift handover: not accepted stays pending; only the incoming person or an in-scope deputy decides', async () => {
  await require('../services/reportConfig').setConfig(rdb.db, { shift_handover_enabled: '1' }, 'test');
  const c = await send('POST', '/api/shift-handovers', tok['sh-out'], { site_id: siteA.id, family: 'site-it-support', to_user: ID['sh-in'], shift_label: 'night', items: ['UPS alarm in server room'] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const id = c.body.handover.id;
  assert.equal(c.body.handover.status, 'pending'); assert.equal(c.body.handover.items[0].title, 'UPS alarm in server room');
  assert.equal((await send('POST', '/api/shift-handovers', tok['sh-out'], { site_id: siteB.id, family: 'site-it-support', to_user: ID['sh-other'] })).status, 403, 'not your site');
  assert.equal((await send('POST', '/api/shift-handovers', tok['sh-out'], { site_id: siteA.id, family: 'site-it-support', to_user: ID['sh-other'] })).status, 400, 'incoming person off the site');
  // nobody decided: still pending, listed
  const l = await send('GET', `/api/shift-handovers?site=${siteA.id}`, tok['sh-in']);
  assert.equal(l.status, 200); const mine = l.body.handovers.find((h) => h.id === id);
  assert.equal(mine.status, 'pending'); assert.equal(mine.stale, false); assert.equal(l.body.flag_hours, 8);
  assert.equal((await send('POST', `/api/shift-handovers/${id}/accept`, tok['sh-out'])).status, 403, 'the outgoing person never accepts');
  assert.equal((await send('POST', `/api/shift-handovers/${id}/accept`, tok['sh-sadmin'])).status, 403, 'the admin tier does not accept on their behalf');
  assert.equal((await send('POST', `/api/shift-handovers/${id}/accept`, tok['sh-dep'])).status, 403, 'deputy scoped to network-oncall: out of scope for site-it-support');
  assert.equal((await send('POST', `/api/shift-handovers/${id}/refuse`, tok['sh-in'], { reason: 'no' })).status, 400, 'refusal needs a reason');
  assert.equal((await send('GET', `/api/shift-handovers?site=${siteB.id}`, tok['sh-in'])).status, 403);
  const still = await rdb.pgHandle().prepare('SELECT status, accepted_at FROM shift_handovers WHERE id = ?').get(id);
  assert.equal(still.status, 'pending'); assert.equal(still.accepted_at, null);
  // a stale one is flagged, not accepted
  await rdb.pgHandle().prepare('UPDATE shift_handovers SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 10 * 36e5).toISOString(), id);
  const st = (await send('GET', `/api/shift-handovers?site=${siteA.id}`, tok['sh-in'])).body.handovers.find((h) => h.id === id);
  assert.equal(st.stale, true); assert.equal(st.status, 'pending');
  // the incoming person accepts; a second decision is a conflict
  const a = await send('POST', `/api/shift-handovers/${id}/accept`, tok['sh-in']);
  assert.equal(a.status, 200); assert.equal(a.body.handover.status, 'accepted'); assert.equal(a.body.handover.accepted_by, ID['sh-in']);
  assert.equal((await send('POST', `/api/shift-handovers/${id}/refuse`, tok['sh-in'], { reason: 'changed my mind' })).status, 409);
});

test('an in-scope deputy of the incoming person accepts in their name', async () => {
  const d = await send('POST', '/api/governance/roles/deputies', tok['sh-super'], { user_id: ID['sh-in'], deputy_id: ID['sh-dep'], start_date: day(), end_date: day(10), reason: 'night off', scope_site_ids: [siteA.id], scope_roles: ['site-it-support'] });
  assert.equal(d.status, 201);
  const c = await send('POST', '/api/shift-handovers', tok['sh-out'], { site_id: siteA.id, family: 'site-it-support', to_user: ID['sh-in'] });
  const a = await send('POST', `/api/shift-handovers/${c.body.handover.id}/accept`, tok['sh-dep']);
  assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(a.body.handover.acting_for, ID['sh-in']);
  await require('../services/reportConfig').setConfig(rdb.db, { shift_handover_enabled: '0' }, 'test');
});
