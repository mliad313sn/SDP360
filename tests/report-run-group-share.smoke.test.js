'use strict';
// P11-F1 (AI qualification panel, security seat) — a GROUP-WIDE report run (site_id NULL) is not "every site's"
// run. Before the fix a site-scoped editor could mint an anonymous public link to an executive-audience group run
// (routes/engagement.js only checked the site when site_id != null) and any session read such runs in-app
// (routes/reportStudio.js visibleRun). AUTHZ-MATRIX: share = "admin, editor — userSites"; a site-less run has no
// site in an editor's scope. Regression: editor share 403, viewer read 403 (single + list), committee member reads a
// council group run, admin share 200, and a link minted by a non-admin before the fix is dead at view time.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(), 'rrgs-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'rrgs-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'rrgs-super-pass-0000';
process.env.DASHBOARD_API_KEY = 'rrgs-dash-key-0123456789abcdef';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, rs, eng, tok = {}, ids = {}, siteA, execRun, councilRun, siteRun;
const H = (t) => ({ 'Content-Type': 'application/json', ...(t ? { 'x-report-token': t } : {}) });
const get = (p, t) => fetch(base + p, { headers: H(t) });
const post = (p, t, b) => fetch(base + p, { method: 'POST', headers: H(t), body: JSON.stringify(b) });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const sites = await rdb.listSites({ includeInactive: false });
  siteA = Number(sites[0].id);
  const mk = async (u, roles, site) => { const x = await rdb.createUser({ username: u, full_name: u, password: u + '-pass-0000', roles, site_id: site }); ids[u] = x && Number(x.id ?? x.lastID); return (await rdb.login(u, u + '-pass-0000')).token; };
  tok.admin = await mk('rrgs-admin', ['admin']);
  tok.editor = await mk('rrgs-ed', ['editor'], siteA);
  tok.viewer = await mk('rrgs-vw', ['viewer'], siteA);
  tok.committee = await mk('rrgs-cm', ['viewer', 'committee-member'], siteA);
  rs = require('../routes/reportStudio').createStore(rdb);
  eng = require('../routes/engagement').createStore(rdb);
  await rs.saveTemplate({ key: 'rrgs-exec', name: 'rrgs exec', dashboard_key: 'direction', audience: 'executive' });
  await rs.saveTemplate({ key: 'rrgs-council', name: 'rrgs council', dashboard_key: 'direction', audience: 'council' });
  await rs.saveTemplate({ key: 'rrgs-site', name: 'rrgs site', dashboard_key: 'direction', audience: 'site' });
  const pub = async (templateKey, siteId, marker) => { const r = await rs.createRun({ templateKey, siteId, windowLabel: 'w', figures: [], analysis: {}, html: `<html><body>${marker}</body></html>` }); await rs.setStatus(r.id, 'published', {}); return r.id; };
  execRun = await pub('rrgs-exec', null, 'GROUP-EXEC-SECRET');
  councilRun = await pub('rrgs-council', null, 'GROUP-COUNCIL');
  siteRun = await pub('rrgs-site', siteA, 'SITE-A-PACK');
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server.close(); } catch (_) {} });

test('editor cannot share a group-wide report run (exec or council); viewer cannot either', async () => {
  for (const id of [execRun, councilRun]) {
    const r = await post('/api/engagement/share', tok.editor, { target_kind: 'report_run', target_key: String(id) });
    assert.equal(r.status, 403, `editor share of group run ${id}`);
  }
  assert.equal((await post('/api/engagement/share', tok.viewer, { target_kind: 'report_run', target_key: String(execRun) })).status, 403);
});

test('editor still shares a published run of their own site (no widening, no regression)', async () => {
  const r = await post('/api/engagement/share', tok.editor, { target_kind: 'report_run', target_key: String(siteRun) });
  assert.equal(r.status, 200); const j = await r.json();
  const v = await get('/share/' + j.token); assert.equal(v.status, 200); assert.ok((await v.text()).includes('SITE-A-PACK'));
});

test('admin shares a group-wide run; the anonymous link serves it', async () => {
  const r = await post('/api/engagement/share', tok.admin, { target_kind: 'report_run', target_key: String(execRun) });
  assert.equal(r.status, 200); const j = await r.json();
  const v = await get('/share/' + j.token); assert.equal(v.status, 200); assert.ok((await v.text()).includes('GROUP-EXEC-SECRET'));
});

test('a link to a group run minted by a non-admin before the fix is dead at view time', async () => {
  const edUser = { id: ids['rrgs-ed'], roles: ['editor'] };
  const l = await eng.createShareLink({ targetKind: 'report_run', targetKey: String(execRun), siteId: null, user: edUser });
  const v = await get('/share/' + l.token); assert.equal(v.status, 404);
  assert.ok(!(await v.text()).includes('GROUP-EXEC-SECRET'));
});

// P11 round 3 R2-N2 — the view-time check used the creator's CURRENT roles: a pre-fix link minted by an editor on a
// group-wide run revived when that editor was later promoted. The creator's admin tier is now recorded WHEN the link
// is minted (share_links.creator_admin) and both must hold: admin at creation AND admin now.
test('R2-N2: a pre-fix editor link stays dead after the editor is promoted; a demoted admin\'s link dies', async () => {
  const x = await rdb.createUser({ username: 'rrgs-ed2', full_name: 'rrgs-ed2', password: 'rrgs-ed2-pass-0000', roles: ['editor'], site_id: siteA });
  const l = await eng.createShareLink({ targetKind: 'report_run', targetKey: String(execRun), siteId: null, user: { id: Number(x.lastID), roles: ['editor'] } });
  assert.equal((await get('/share/' + l.token)).status, 404, 'dead while editor');
  await rdb.setUserRoles(Number(x.lastID), ['admin']);
  const v = await get('/share/' + l.token);
  assert.equal(v.status, 404, 'still dead after promotion'); assert.ok(!(await v.text()).includes('GROUP-EXEC-SECRET'));
  // an admin link keeps working while the creator stays admin, and dies when they are demoted
  const y = await rdb.createUser({ username: 'rrgs-ad2', full_name: 'rrgs-ad2', password: 'rrgs-ad2-pass-0000', roles: ['admin'] });
  const t = (await rdb.login('rrgs-ad2', 'rrgs-ad2-pass-0000')).token;
  const j = await (await post('/api/engagement/share', t, { target_kind: 'report_run', target_key: String(execRun) })).json();
  assert.equal((await get('/share/' + j.token)).status, 200);
  await rdb.setUserRoles(Number(y.lastID), ['editor']);
  assert.equal((await get('/share/' + j.token)).status, 404, 'demoted admin: link dead');
});

test('in-app read: viewer/editor refused on executive group run (single + list); committee member reads the council run only', async () => {
  for (const t of [tok.viewer, tok.editor]) {
    assert.equal((await get(`/api/report-studio/runs/${execRun}`, t)).status, 403);
    assert.equal((await get(`/api/report-studio/runs/${execRun}.html`, t)).status, 403);
    assert.equal((await get(`/api/report-studio/runs/${councilRun}`, t)).status, 403);
    const l = await (await get('/api/report-studio/runs', t)).json();
    assert.ok(!l.runs.some((x) => x.id === execRun || x.id === councilRun), 'group runs not listed to a non-author');
    assert.ok(l.runs.some((x) => x.id === siteRun), 'own-site published run still listed');
  }
  assert.equal((await get(`/api/report-studio/runs/${councilRun}`, tok.committee)).status, 200);
  assert.equal((await get(`/api/report-studio/runs/${execRun}`, tok.committee)).status, 403);
  const lc = await (await get('/api/report-studio/runs', tok.committee)).json();
  assert.ok(lc.runs.some((x) => x.id === councilRun)); assert.ok(!lc.runs.some((x) => x.id === execRun));
  assert.equal((await get(`/api/report-studio/runs/${execRun}`, tok.admin)).status, 200);
});
