'use strict';
// C-20 — /api/duty/* through the real server: session required; an editor reads only its own sites and never
// writes; the admin tier of a site enters shifts and policies; CSV import is a dry run with per-row errors, then an
// idempotent commit; coverage reads unknown with no roster, covered once rostered, gap when the holder is
// deactivated; coverage.html is served from the boot cache.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'duty-routes-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'du-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'du-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'du-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');

let server, base, rdb, siteA, siteB; const tok = {}, ID = {};
before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const sites = (await rdb.listSites()) || [];
  siteA = sites[0]; siteB = sites[1];
  const mk = async (u, roles, site_id) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pw-0000', roles, site_id });
    tok[u] = (await rdb.login(u, u + '-pw-0000')).token;
    ID[u] = Number((await rdb.pgHandle().prepare('SELECT id FROM users WHERE username=?').get(u)).id);
  };
  await mk('du-editor', ['editor'], siteA.id); await mk('du-tech', ['editor'], siteA.id);
  await mk('du-sadmin', ['admin'], siteA.id); await mk('du-super', ['super_admin'], null);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const DAY = '2026-11-02';
const cov = (t, site) => send('GET', `/api/duty/coverage?site=${site}&from=${DAY}&days=1`, t);

test('session required; an editor reads its own site only and cannot write', async () => {
  assert.equal((await fetch(base + '/api/duty/coverage')).status, 401);
  const own = await cov(tok['du-editor'], siteA.id);
  assert.equal(own.status, 200); assert.deepEqual(own.body.can_edit_sites, []);
  assert.equal((await cov(tok['du-editor'], siteB.id)).status, 403);
  const w = await send('POST', '/api/duty/shifts', tok['du-editor'], { site_id: siteA.id, family: 'site-it-support', user_id: ID['du-tech'], starts_at: `${DAY} 06:00`, ends_at: `${DAY} 18:00` });
  assert.equal(w.status, 403);
  assert.equal((await send('POST', '/api/duty/import', tok['du-editor'], { csv: 'a,b\n1,2' })).status, 403);
});

test('no roster → unknown, never covered; the families are seeded', async () => {
  const r = await cov(tok['du-super'], siteA.id);
  assert.deepEqual(r.body.families.map((f) => f.key).sort(), ['network-oncall', 'site-it-support']);
  assert.equal(r.body.summary.covered, 0); assert.ok(r.body.summary.unknown > 0);
});

test('admin of the site: manual shift + policy; another site is refused; duplicates 409', async () => {
  const body = { site_id: siteA.id, family: 'site-it-support', user_id: ID['du-tech'], starts_at: `${DAY} 06:00`, ends_at: `${DAY} 18:00` };
  const c = await send('POST', '/api/duty/shifts', tok['du-sadmin'], body);
  assert.equal(c.status, 201);
  assert.equal((await send('POST', '/api/duty/shifts', tok['du-sadmin'], body)).status, 409);
  assert.equal((await send('POST', '/api/duty/shifts', tok['du-sadmin'], { ...body, site_id: siteB.id })).status, 403);
  const bad = await send('POST', '/api/duty/shifts', tok['du-sadmin'], { ...body, ends_at: `${DAY} 05:00` });
  assert.equal(bad.status, 400);
  const p = await send('PUT', '/api/duty/policy', tok['du-sadmin'], { site_id: siteA.id, family: 'site-it-support', mode: 'business_hours', business_start: '06:00', business_end: '18:00' });
  assert.equal(p.status, 200);
  assert.equal((await send('PUT', '/api/duty/policy', tok['du-sadmin'], { site_id: siteA.id, family: 'site-it-support', mode: 'always' })).status, 400);
  const r = await cov(tok['du-sadmin'], siteA.id);
  const row = r.body.rows.find((x) => x.family === 'site-it-support');
  assert.equal(row.policy.source, 'site'); assert.equal(row.slots[0].status, 'covered'); assert.deepEqual(row.slots[0].people, [ID['du-tech']]);
  assert.deepEqual(r.body.can_edit_sites, [Number(siteA.id)]);
});

test('CSV: dry run lists per-row errors and writes nothing; apply is refused with errors, then idempotent', async () => {
  const good = `﻿"User","Duty family","Site","Start","End"\ndu-tech,network-oncall,${siteA.id},${DAY} 06:00,${DAY} 18:00\n`;
  const csv = good + `ghost,network-oncall,${siteA.id},${DAY} 06:00,${DAY} 18:00\ndu-tech,network-oncall,${siteB.id},${DAY} 06:00,${DAY} 18:00\n`;
  const dry = await send('POST', '/api/duty/import', tok['du-sadmin'], { csv });
  assert.equal(dry.status, 200); assert.equal(dry.body.applied, false);
  assert.equal(dry.body.rows.length, 1); assert.deepEqual(dry.body.errors.map((e) => e.line), [3, 4]);
  assert.equal((await send('GET', `/api/duty/shifts?site=${siteA.id}&from=${DAY}`, tok['du-sadmin'])).body.shifts.filter((s) => s.family === 'network-oncall').length, 0);
  assert.equal((await send('POST', '/api/duty/import?apply=1', tok['du-sadmin'], { csv })).status, 400);
  const a1 = await send('POST', '/api/duty/import?apply=1', tok['du-sadmin'], { csv: good });
  assert.deepEqual([a1.body.inserted, a1.body.already], [1, 0]);
  const a2 = await send('POST', '/api/duty/import?apply=1', tok['du-sadmin'], { csv: good });
  assert.deepEqual([a2.body.inserted, a2.body.already], [0, 1]);
  const sh = (await send('GET', `/api/duty/shifts?site=${siteA.id}&from=${DAY}`, tok['du-sadmin'])).body.shifts.find((s) => s.family === 'network-oncall');
  assert.equal(sh.source, 'csv'); assert.equal(sh.imported_by, ID['du-sadmin']);
});

test('a deactivated holder no longer counts; removal is soft and site-checked', async () => {
  await rdb.pgHandle().prepare('UPDATE users SET active = 0 WHERE id = ?').run(ID['du-tech']);
  const r = await cov(tok['du-super'], siteA.id);
  const s = r.body.rows.find((x) => x.family === 'site-it-support').slots[0];
  assert.equal(s.status, 'gap'); assert.equal(s.reason, 'inactive_holder');
  const sh = (await send('GET', `/api/duty/shifts?site=${siteA.id}&from=${DAY}`, tok['du-super'])).body.shifts[0];
  assert.equal((await send('DELETE', `/api/duty/shifts/${sh.id}`, tok['du-editor'])).status, 403);
  assert.equal((await send('DELETE', `/api/duty/shifts/${sh.id}`, tok['du-super'])).status, 200);
  assert.equal((await send('DELETE', `/api/duty/shifts/${sh.id}`, tok['du-super'])).status, 404);
});

test('coverage.html is served (boot cache, versioned assets)', async () => {
  const r = await fetch(base + '/coverage.html');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /coverage\.js\?v=/); assert.match(html, /id="__shell"/);
});
