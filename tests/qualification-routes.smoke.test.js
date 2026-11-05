'use strict';
// C-19 — through the real server: qualification evidence is recorded by the admin tier and verified by a third
// person (holder and recorder refused); qualification_check_enabled ('0' = today) refuses a field capture whose
// requirement is unmet, with the reason; access approvals follow R7 (a site admin decides a site role for its
// site, never a platform role, never for another site).
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'qual-routes-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.SDP_QUAL_CFG_TTL_MS = '0';
process.env.DASH_USER = process.env.DASH_USER || 'qr-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'qr-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'qr-key';
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
  siteA = sites[0].id; siteB = sites[1].id;
  const mk = async (u, roles, site) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pw-0000', roles, site_id: site });
    tok[u] = (await rdb.login(u, u + '-pw-0000')).token;
    ID[u] = Number((await rdb.pgHandle().prepare('SELECT id FROM users WHERE username=?').get(u)).id);
  };
  await mk('qr-tech', ['field-tech'], siteA); await mk('qr-adminA', ['admin'], siteA); await mk('qr-adminA2', ['admin'], siteA);
  await mk('qr-adminB', ['admin'], siteB); await mk('qr-super', ['super_admin'], siteA);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const plus = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

test('kinds seeded per R10; recording is admin-tier; holder and recorder never verify', async () => {
  const k = await send('GET', '/api/qualifications/kinds', tok['qr-tech']);
  assert.equal(k.status, 200);
  assert.deepEqual(k.body.kinds.map((x) => x.key), ['site-induction', 'electrical-authorisation', 'working-at-height', 'confined-space']);
  assert.match(k.body.note, /never grants a physical authorisation/);
  const body = { user_id: ID['qr-tech'], kind: 'site-induction', issuer: 'HSE site A', issued_on: plus(-30), expires_on: plus(300), evidence_ref: 'IND-001' };
  assert.equal((await send('POST', '/api/qualifications', tok['qr-tech'], body)).status, 403, 'a plain session does not record');
  const c = await send('POST', '/api/qualifications', tok['qr-adminA'], body);
  assert.equal(c.status, 201); ID.q = c.body.id;
  assert.match((await send('POST', `/api/qualifications/${ID.q}/verify`, tok['qr-tech'])).body.error, /admin tier/);
  assert.match((await send('POST', `/api/qualifications/${ID.q}/verify`, tok['qr-adminA'])).body.error, /recorded this evidence/);
  assert.equal((await send('GET', `/api/qualifications?user_id=${ID['qr-adminA']}`, tok['qr-tech'])).status, 403, 'others\' evidence is not served to a plain session');
  const mine = await send('GET', '/api/qualifications', tok['qr-tech']);
  assert.equal(mine.body.records.find((r) => r.id === ID.q).state, 'unverified');
  assert.equal((await send('PUT', '/api/qualifications/kinds/forklift', tok['qr-adminA'], { name_en: 'Forklift', name_fr: 'Chariot' })).status, 403, 'kinds: super_admin');
});

test('qualification_check_enabled: 0 = today; 1 + requirement → field capture refused with the reason until verified', async () => {
  const cfg = require('../services/reportConfig');
  const upload = () => send('POST', '/api/field/uploads', tok['qr-tech'], {});
  assert.notEqual((await upload()).status, 403, 'today: no qualification gate');
  await cfg.setConfig(rdb.db, { qualification_check_enabled: '1', qualification_requirements: JSON.stringify({ 'field.capture': ['site-induction'] }) }, 'test');
  try {
    const r = await upload();
    assert.equal(r.status, 403); assert.match(r.body.error, /not yet verified site-induction.*records evidence only/);
    const ck = await send('GET', '/api/qualifications/check?cap=field.capture', tok['qr-tech']);
    assert.deepEqual([ck.body.allow, ck.body.reason_code], [false, 'qualification_unverified']);
    assert.equal((await send('POST', `/api/qualifications/${ID.q}/verify`, tok['qr-adminA2'])).body.status, 'verified');
    assert.notEqual((await upload()).status, 403, 'verified evidence lets the capture through');
    assert.equal((await send('GET', '/api/qualifications/check?cap=field.capture', tok['qr-tech'])).body.allow, true);
  } finally { await cfg.setConfig(rdb.db, { qualification_check_enabled: '0', qualification_requirements: '{}' }, 'test'); }
});

test('R7: a site admin decides a site role on its own site; not another site, not a platform role', async () => {
  const mk = (roles, sites) => send('POST', '/api/access/requests', tok['qr-super'], { subject_user_id: ID['qr-tech'], roles, site_ids: sites, valid_to: plus(20), justification: 'site coordination cover' });
  const a = await mk(['tracker-editor'], [siteA]); assert.equal(a.status, 201);
  assert.ok((await send('GET', '/api/access/approvals', tok['qr-adminA'])).body.requests.some((r) => r.id === a.body.id));
  assert.ok(!(await send('GET', '/api/access/approvals', tok['qr-adminB'])).body.requests.some((r) => r.id === a.body.id));
  assert.match((await send('POST', `/api/access/requests/${a.body.id}/approve`, tok['qr-adminB'], {})).body.error, /do not hold site/);
  assert.equal((await send('GET', `/api/access/requests/${a.body.id}`, tok['qr-adminA'])).status, 200, 'the approver can read the request');
  assert.equal((await send('POST', `/api/access/requests/${a.body.id}/approve`, tok['qr-adminA'], { reason: 'ok' })).body.status, 'ACTIVE');
  const p = await mk(['audit-viewer'], []); assert.equal(p.status, 201);
  const refused = await send('POST', `/api/access/requests/${p.body.id}/approve`, tok['qr-adminA'], {});
  assert.equal(refused.status, 403); assert.match(refused.body.error, /platform role.*super_admin/);
  assert.equal((await send('POST', `/api/access/requests/${p.body.id}/revoke`, tok['qr-adminA'], { reason: 'not mine to end' })).status, 403, 'revoke stays super_admin');
});
