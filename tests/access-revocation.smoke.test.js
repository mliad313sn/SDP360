'use strict';
// G-07 — revoking access takes effect on the NEXT request of a session that is already open
// (committee review 2026-10-28). Each change goes through the real admin API (PUT /api/reports/users/:id),
// then the same session token is reused: no logout, no new login.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'revoke-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'rv-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'rv-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'rv-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, superTok, A, B;
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const get = (p, t) => fetch(base + p, { headers: H(t) });
const put = (p, t, b) => fetch(base + p, { method: 'PUT', headers: H(t), body: JSON.stringify(b) });

async function makeUser(username, fields) {
  await rdb.createUser({ username, full_name: username, password: username + '-pass-0000', ...fields });
  const u = ((await rdb.listUsers()) || []).find((x) => x.username === username);
  return { id: u.id, tok: (await rdb.login(username, username + '-pass-0000')).token,
    form: { full_name: username, site_id: fields.site_id ?? null, active: 1, roles: fields.roles } };
}
// The admin page always sends the whole form (site and active are overwritten), so do the same.
const edit = (u, change) => put(`/api/reports/users/${u.id}`, superTok, { ...u.form, ...change });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const sites = (await rdb.listSites()) || [];
  A = sites.find((s) => s.name === 'Hounde'); B = sites.find((s) => s.name === 'Sabodala');
  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['super_admin']);
  superTok = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('deactivating an account ends its open session on the next request', async () => {
  const u = await makeUser('rv-deact', { roles: ['editor'], site_id: A.id });
  assert.equal((await get('/api/reports/auth/me', u.tok)).status, 200, 'session works before');
  assert.equal((await edit(u, { active: 0 })).status, 200);
  const r = await get('/api/reports/auth/me', u.tok);
  assert.ok(r.status === 401 || r.status === 403, `deactivated session must be refused, got ${r.status}`);
  assert.ok([401, 403].includes((await get('/api/meetings/list', u.tok)).status), 'module reads refused too');
});

test('removing a privileged role denies the privileged route on the next request', async () => {
  const u = await makeUser('rv-demote', { roles: ['super_admin'] });
  assert.equal((await get('/api/reports/users', u.tok)).status, 200, 'super_admin reads users before');
  assert.equal((await edit(u, { roles: ['viewer'] })).status, 200);
  assert.equal((await get('/api/reports/users', u.tok)).status, 403, 'viewer must be refused with the same token');
});

test('moving an editor to another site moves its read scope on the next request', async () => {
  const u = await makeUser('rv-move', { roles: ['editor'], site_id: A.id });
  const before = await get(`/api/reports/yearly/${A.id}/2026`, u.tok);
  assert.notEqual(before.status, 403, 'own site readable before the move');
  assert.equal((await edit(u, { site_id: B.id })).status, 200);
  assert.equal((await get(`/api/reports/yearly/${A.id}/2026`, u.tok)).status, 403, 'old site refused after the move');
  assert.notEqual((await get(`/api/reports/yearly/${B.id}/2026`, u.tok)).status, 403, 'new site readable');
});

test('a revoked extra site stops being readable on the next request', async () => {
  const u = await makeUser('rv-extra', { roles: ['editor'], site_id: A.id, extra_site_ids: [B.id] });
  assert.notEqual((await get(`/api/reports/yearly/${B.id}/2026`, u.tok)).status, 403, 'extra site readable before');
  assert.equal((await edit(u, { extra_site_ids: [] })).status, 200);
  assert.equal((await get(`/api/reports/yearly/${B.id}/2026`, u.tok)).status, 403, 'extra site refused after revocation');
});

test('a role check on a bare user id fails closed (PO-08 regression)', async () => {
  assert.equal(rdb.userHasRole(1, 'viewer'), false);
  assert.equal(rdb.userHasRole({ id: 1 }, 'viewer'), false, 'no preloaded roles → no access');
});
