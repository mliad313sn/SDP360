'use strict';
// A-10 — GET /api/me/work (per-person "My work") + GET /home.html through the real app.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'my-work-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'mw-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'mw-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'mw-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, hounde, mana, T = {};
before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /^mana$/i.test(s.name)).id;
  const mk = async (k, roles, site, extra) => {
    const u = 'mw_' + k;
    try { await rdb.createUser({ username: u, full_name: 'Person ' + k, password: u + 'pass1234', roles, site_id: site, extra_site_ids: extra }); } catch {}
    T[k] = (await rdb.login(u, u + 'pass1234')).token;
  };
  await mk('two', ['editor'], hounde, [mana]);
  await mk('tech', ['field-tech'], mana);
  await mk('nosite', ['admin']);
  const mdb = require('../meetings-db');
  await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'mining', meeting_date: '2026-10-05', status: 'draft' },
    actions: [{ description: 'Replace the plant switch', status: 'open', owner_it: 'mw_two', target_date: '2026-10-10' }] }, null, null);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const get = async (t, p = '/api/me/work') => {
  const r = await fetch(base + p, { headers: t ? { 'x-report-token': t } : {} });
  return { status: r.status, body: p.endsWith('.html') ? await r.text() : await r.json().catch(() => null) };
};

test('401 without a session', async () => {
  assert.equal((await get(null)).status, 401);
});

test('a two-site editor sees exactly their two sites, each block measured or null', async () => {
  const r = await get(T.two);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.sites.map((s) => s.site_id).sort(), [hounde, mana].sort());
  const h = r.body.sites.find((s) => s.site_id === hounde);
  assert.equal(h.code, 'HGO');
  assert.ok(h.actions.open >= 1 && h.actions.overdue >= 1, 'the late PV action is open + overdue');
  assert.ok(['Not started', 'In progress', 'Complete but not submitted', 'Submitted'].includes(h.weekly_report.label));
  assert.ok(h.unsigned_pvs.count >= 1, 'the draft PV is unsigned');
  assert.ok('last_inspection' in h && 'tracker_empty' in h);
  assert.equal(r.body.message, null);
});

test('a field tech with one site gets one card', async () => {
  const r = await get(T.tech);
  assert.equal(r.status, 200);
  assert.deepStrictEqual(r.body.sites.map((s) => s.site_id), [mana]);
});

test('an admin without a site gets a message, never the fleet', async () => {
  const r = await get(T.nosite);
  assert.equal(r.status, 200);
  assert.deepStrictEqual(r.body.sites, []);
  assert.match(r.body.message, /not attached to a site/);
});

test('GET /home.html returns the page with the shell mount', async () => {
  const r = await get(T.two, '/home.html');
  assert.equal(r.status, 200);
  assert.match(r.body, /<div id="__shell" data-section="home" data-current="home">/);
  assert.match(r.body, /lib\/home-page\.js\?v=/, 'asset versioning applied (served through sendHtmlPage)');
});

test('login.html (strict CSP page) serves lib/landing.js with the per-request nonce', async () => {
  const r = await get(null, '/login.html');
  assert.equal(r.status, 200);
  assert.match(r.body, /<script nonce="(?!%%)[^"]+" src="lib\/landing\.js\?v=[^"]+"><\/script>/);
  assert.ok(!r.body.includes('%%CSP_NONCE%%'));
});
