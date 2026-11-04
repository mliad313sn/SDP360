'use strict';
// C-18 — /api/access/* end to end through the real server: a request filed by a super_admin cannot be approved
// by the same person (403), a plain session cannot request for someone else, a second super_admin approves and the
// role shows in /me with its expiry; templates are super_admin-only; access_require_approval ('0' = today) makes
// Admin ▸ Users refuse a requires_request role without an approved request, unless an explicit break-glass.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'access-routes-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'ar-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ar-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ar-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');

let server, base, rdb, site; const tok = {}, ID = {};
before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  site = ((await rdb.listSites()) || [])[0].id;
  const mk = async (u, roles) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pw-0000', roles, site_id: site });
    tok[u] = (await rdb.login(u, u + '-pw-0000')).token;
    ID[u] = Number((await rdb.pgHandle().prepare('SELECT id FROM users WHERE username=?').get(u)).id);
  };
  await mk('ar-viewer', ['viewer']); await mk('ar-other', ['editor']);
  await mk('ar-super', ['super_admin']); await mk('ar-super2', ['super_admin']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const plus = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

test('session required; /me answers about the caller', async () => {
  assert.equal((await fetch(base + '/api/access/me')).status, 401);
  const r = await send('GET', '/api/access/me', tok['ar-viewer']);
  assert.equal(r.status, 200); assert.equal(r.body.user.id, ID['ar-viewer']); assert.deepEqual(r.body.grants, []); assert.equal(r.body.can_approve, false);
});

test('a plain session cannot request for someone else; validation errors are typed 400s', async () => {
  const r = await send('POST', '/api/access/requests', tok['ar-viewer'], { subject_user_id: ID['ar-other'], roles: ['report-author'], valid_to: plus(30), justification: 'for my colleague please' });
  assert.equal(r.status, 403);
  const v = await send('POST', '/api/access/requests', tok['ar-viewer'], { roles: ['super_admin'], valid_to: plus(30), justification: 'I want everything now' });
  assert.equal(v.status, 400); assert.match(v.body.error, /super_admin/);
});

test('self-approval is refused (403); a second super_admin approves; /me shows the grant and its end', async () => {
  const c = await send('POST', '/api/access/requests', tok['ar-super'], { subject_user_id: ID['ar-viewer'], roles: ['report-author'], site_ids: [site], valid_from: today(), valid_to: plus(10), justification: 'monthly deck preparation' });
  assert.equal(c.status, 201);
  const self = await send('POST', `/api/access/requests/${c.body.id}/approve`, tok['ar-super'], { reason: 'self' });
  assert.equal(self.status, 403); assert.match(self.body.error, /you filed/);
  const subj = await send('POST', `/api/access/requests/${c.body.id}/approve`, tok['ar-viewer'], {});
  assert.equal(subj.status, 403);
  const q = await send('GET', '/api/access/approvals', tok['ar-super2']);
  assert.ok(q.body.requests.some((r) => r.id === c.body.id));
  assert.ok(!(await send('GET', '/api/access/approvals', tok['ar-super'])).body.requests.some((r) => r.id === c.body.id));
  const ok = await send('POST', `/api/access/requests/${c.body.id}/approve`, tok['ar-super2'], { reason: 'agreed' });
  assert.equal(ok.status, 200); assert.equal(ok.body.status, 'ACTIVE');
  const viewerTok = (await rdb.login('ar-viewer', 'ar-viewer-pw-0000')).token;
  const me = await send('GET', '/api/access/me', viewerTok);
  assert.ok(me.body.user.roles.includes('report-author'));
  assert.equal(me.body.grants.find((g) => g.role === 'report-author').valid_to, plus(10));
  assert.ok(me.body.expiring_soon.some((g) => g.role === 'report-author'));
  const detail = await send('GET', `/api/access/requests/${c.body.id}`, tok['ar-other']);
  assert.equal(detail.status, 404, 'a stranger does not read another person\'s request');
  const again = await send('POST', `/api/access/requests/${c.body.id}/approve`, tok['ar-super2'], {});
  assert.equal(again.status, 409);
});

test('templates: super_admin only to write; published versions immutable; any session reads published', async () => {
  assert.equal((await send('POST', '/api/access/templates', tok['ar-other'], { key: 'x', title_en: 'x', title_fr: 'x' })).status, 403);
  const t = await send('POST', '/api/access/templates', tok['ar-super'], { key: 'site-coordinator', title_en: 'Site coordinator', title_fr: 'Coordinateur de site' });
  assert.equal(t.status, 201);
  const v = await send('POST', `/api/access/templates/${t.body.id}/versions`, tok['ar-super'], { roles: ['editor', 'tracker-editor'], max_days: 180 });
  assert.equal(v.status, 201);
  assert.equal((await send('GET', '/api/access/templates', tok['ar-viewer'])).body.templates.length, 0, 'drafts hidden from a plain session');
  assert.equal((await send('POST', `/api/access/templates/versions/${v.body.id}/publish`, tok['ar-super'])).status, 200);
  assert.equal((await send('PUT', `/api/access/templates/versions/${v.body.id}`, tok['ar-super'], { roles: ['admin'] })).status, 409);
  const list = await send('GET', '/api/access/templates', tok['ar-viewer']);
  assert.equal(list.body.templates[0].current.id, v.body.id);
});

test('access_require_approval: 0 = today; 1 = requires_request role refused without approval, break-glass logged', async () => {
  const cfg = require('../services/reportConfig');
  const put = (body) => send('PUT', `/api/reports/users/${ID['ar-other']}`, tok['ar-super'], { full_name: 'ar-other', site_id: site, active: 1, ...body });
  assert.equal((await put({ roles: ['editor', 'finance-viewer'] })).status, 200, 'today: no gate');
  assert.equal((await put({ roles: ['editor'] })).status, 200);
  await cfg.setConfig(rdb.db, { access_require_approval: '1' }, 'test');
  try {
    const refused = await put({ roles: ['editor', 'finance-viewer'] });
    assert.equal(refused.status, 409); assert.match(refused.body.error, /finance-viewer/);
    assert.equal((await put({ roles: ['editor', 'tracker-editor'] })).status, 200, 'a role without requires_request passes');
    const bg = await put({ roles: ['editor', 'finance-viewer'], break_glass: true, break_glass_reason: 'audit tomorrow morning' });
    assert.equal(bg.status, 200);
    const ev = await rdb.pgHandle().prepare("SELECT risk FROM system_log WHERE action = 'access_break_glass' ORDER BY id DESC LIMIT 1").get();
    assert.equal(Number(ev && ev.risk), 1);
  } finally { await cfg.setConfig(rdb.db, { access_require_approval: '0' }, 'test'); }
});

test('the pages: access.html is served with a nonce; no-access offers "Request this access"', async () => {
  const a = await fetch(base + '/access.html'); const html = await a.text();
  assert.equal(a.status, 200); assert.ok(!html.includes('%%CSP_NONCE%%')); assert.match(html, /access\.js\?v=/);
  const n = await (await fetch(base + '/no-access.html')).text();
  assert.match(n, /id="naRequest"/);
});
