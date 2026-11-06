'use strict';
// E-S03 (audit S-05) — access recertification end to end (real server, PostgreSQL, migration 068):
// 404 while off; a campaign gives account × role / site lines assigned to an R7 approver (never the subject);
// revoke is RECORDED only at access_recert_apply='0' and applied with an identity log row at '1';
// the orphan list shows a missing sign-in as UNKNOWN.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'access-recert-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'rc-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'rc-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'rc-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');

let server, base, rdb, rc, site; const tok = {}, ID = {};
before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db'); rc = require('../services/reportConfig');
  site = ((await rdb.listSites()) || [])[0].id;
  const mk = async (u, roles, siteId = site) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pw-0000', roles, site_id: siteId });
    tok[u] = (await rdb.login(u, u + '-pw-0000')).token;
    ID[u] = Number((await rdb.pgHandle().prepare('SELECT id FROM users WHERE username=?').get(u)).id);
  };
  await mk('rc-super', ['super_admin'], null); await mk('rc-siteadm', ['admin']);
  await mk('rc-ed', ['editor', 'tracker-editor']); await mk('rc-nosite', ['editor'], null);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { try { await rc.setConfig(rdb.db, { access_recert_enabled: '0', access_recert_apply: '0' }, 'test'); } catch {} try { server && server.close(); } catch {} });
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

let campaign;
test('off by default: every recert route answers 404', async () => {
  assert.equal((await send('GET', '/api/access/recert/campaigns', tok['rc-super'])).status, 404);
  assert.equal((await send('POST', '/api/access/recert/lines/1/answer', tok['rc-super'], { answer: 'keep', reason: 'still here' })).status, 404);
});

test('a super_admin opens a campaign; a plain session cannot', async () => {
  await rc.setConfig(rdb.db, { access_recert_enabled: '1' }, 'test');
  assert.equal((await send('POST', '/api/access/recert/campaigns', tok['rc-ed'], { title: 'Q4' })).status, 403);
  const r = await send('POST', '/api/access/recert/campaigns', tok['rc-super'], { title: 'Q4 2026 review', scope_site_id: site });
  assert.equal(r.status, 201); assert.ok(r.body.lines >= 3);
  campaign = r.body.id;
  const c = (await send('GET', '/api/access/recert/campaigns/' + campaign, tok['rc-super'])).body.campaign;
  const edLines = c.lines.filter((l) => l.user_id === ID['rc-ed']);
  assert.deepEqual(edLines.map((l) => l.kind + ':' + (l.role || l.site_id)).sort(), ['role:editor', 'role:tracker-editor', 'site:' + site]);
  assert.ok(edLines.every((l) => l.approver_user_id === ID['rc-siteadm']), 'site admin is the R7 approver');
  assert.ok(c.lines.every((l) => l.approver_user_id !== l.user_id), 'approver is never the subject');
  const adm = c.lines.find((l) => l.user_id === ID['rc-siteadm'] && l.role === 'admin');
  assert.equal(adm.approver_user_id, ID['rc-super'], 'a platform role goes to a super_admin');
});

test('the subject cannot answer its own line; the approver sees only its lines', async () => {
  const c = (await send('GET', '/api/access/recert/campaigns/' + campaign, tok['rc-super'])).body.campaign;
  const own = c.lines.find((l) => l.user_id === ID['rc-siteadm'] && l.kind === 'site');
  assert.equal((await send('POST', `/api/access/recert/lines/${own.id}/answer`, tok['rc-siteadm'], { answer: 'keep', reason: 'mine is fine' })).status, 403);
  const mine = (await send('GET', '/api/access/recert/campaigns/' + campaign, tok['rc-siteadm'])).body.campaign.lines;
  assert.ok(mine.length && mine.every((l) => l.approver_user_id === ID['rc-siteadm']));
  assert.equal((await send('GET', '/api/access/recert/mine', tok['rc-siteadm'])).body.lines.length, mine.length);
});

test('apply=0: a revoke is recorded, the role stays', async () => {
  const c = (await send('GET', '/api/access/recert/campaigns/' + campaign, tok['rc-siteadm'])).body.campaign;
  const line = c.lines.find((l) => l.user_id === ID['rc-ed'] && l.role === 'tracker-editor');
  const r = await send('POST', `/api/access/recert/lines/${line.id}/answer`, tok['rc-siteadm'], { answer: 'revoke', reason: 'no tracker work any more' });
  assert.equal(r.status, 200); assert.equal(r.body.applied, false); assert.equal(r.body.recorded_only, true);
  const u = ((await rdb.listUsers()) || []).find((x) => Number(x.id) === ID['rc-ed']);
  assert.ok(u.roles.includes('tracker-editor'));
});

test('apply=1: a revoke goes through the role-change path with an identity log row', async () => {
  await rc.setConfig(rdb.db, { access_recert_apply: '1' }, 'test');
  const c = (await send('GET', '/api/access/recert/campaigns/' + campaign, tok['rc-siteadm'])).body.campaign;
  const line = c.lines.find((l) => l.user_id === ID['rc-ed'] && l.role === 'tracker-editor');
  const r = await send('POST', `/api/access/recert/lines/${line.id}/answer`, tok['rc-siteadm'], { answer: 'revoke', reason: 'confirmed: no tracker work' });
  assert.equal(r.status, 200); assert.equal(r.body.applied, true);
  const u = ((await rdb.listUsers()) || []).find((x) => Number(x.id) === ID['rc-ed']);
  assert.deepEqual(u.roles, ['editor']);
  await new Promise((res) => setTimeout(res, 150));
  const n = await rdb.pgHandle().prepare("SELECT count(*)::int AS n FROM system_log WHERE category='identity' AND action='user_role_changed' AND details LIKE '%access_recert%'").get();
  assert.equal(n.n, 1);
  const p = (await send('GET', '/api/access/recert/campaigns', tok['rc-super'])).body.campaigns.find((x) => x.id === campaign).progress;
  assert.equal(p.applied, 1); assert.equal(p.revoke, 1);
});

test('orphans: editor without a site listed; an account with no sign-in evidence is UNKNOWN, not idle', async () => {
  const o = (await send('GET', '/api/access/recert/orphans', tok['rc-super'])).body;
  const ns = o.rows.find((r) => r.user_id === ID['rc-nosite']);
  assert.ok(ns && ns.reasons.some((x) => x.code === 'editor_without_site'));
  assert.ok(!o.rows.some((r) => r.reasons.some((x) => x.code === 'no_login') && !r.last_login_known));
  assert.equal(o.threshold_days, 90);
});

test('closing the campaign refuses further answers', async () => {
  assert.equal((await send('POST', `/api/access/recert/campaigns/${campaign}/close`, tok['rc-super'])).status, 200);
  const c = (await send('GET', '/api/access/recert/campaigns/' + campaign, tok['rc-super'])).body.campaign;
  const any = c.lines.find((l) => !l.answer && l.approver_user_id === ID['rc-super']);
  assert.equal((await send('POST', `/api/access/recert/lines/${any.id}/answer`, tok['rc-super'], { answer: 'keep', reason: 'too late now' })).status, 409);
});
