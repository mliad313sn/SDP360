'use strict';
// B6 (P7a) — audience-scoped roadmap publications over HTTP (roadmap_audience_publication_enabled, '0' = 404):
// perimeter of the audience, amounts only for the admin tier / finance-viewer, expiry, revocation, share links.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'rm-aud-'));
process.env.DASH_USER = process.env.DASH_USER || 'rma-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'rma-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'rma-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, A, B, T = {}, P = {}, PROG;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 50; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'roadmap_publications'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  A = sites.find((s) => /hounde/i.test(s.name)).id; B = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.adm = await mk('rma_adm', ['admin']);
  T.pmo = await mk('rma_pmo', ['viewer', 'committee-member']);
  T.edA = await mk('rma_eda', ['editor'], A);
  T.viewA = await mk('rma_viewa', ['viewer'], A);
  T.edB = await mk('rma_edb', ['editor'], B);
  T.finA = await mk('rma_fina', ['viewer', 'finance-viewer'], A);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  PROG = (await put('programme', T.adm, { key: 'rma-prog', name: 'Pub' })).j.id;
  const obj = (await put('objective', T.adm, { programme_id: PROG, key: 'rma-o', name: 'O' })).j.id;
  for (const [k, site] of [['A', A], ['S', A], ['B', B]]) P[k] = (await put('project', T.adm, { objective_id: obj, key: 'RMA-' + k, name: 'Project ' + k, site_id: site, status: 'active', budget: 1234, spent: 56, currency: 'USD' })).j.id;
  await cfg.setConfig(rdb.db, { portfolio_sensitive_projects: '1' }, 'smoke');
  assert.equal((await send('PUT', `/api/governance/portfolio/project/${P.S}/sensitive`, T.adm, { sensitive: true })).status, 200);
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign(t ? { 'x-report-token': t } : {}, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (_) {} return { status: r.status, j, text }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const pub = (t, b) => send('POST', '/api/governance/roadmap-publications', t, b);
const read = (id, t) => send('GET', '/api/governance/roadmap-publications/' + id, t);
const sw = (v) => cfg.setConfig(rdb.db, { roadmap_audience_publication_enabled: v }, 'smoke');

test('switch off (today): every publication route answers 404; the migration switch is untouched', async () => {
  await sw('0');
  assert.equal((await send('GET', '/api/governance/roadmap-publications', T.adm)).status, 404);
  assert.equal((await pub(T.adm, { audience: 'exec', title: 'x' })).status, 404);
  assert.equal((await read(1, T.adm)).status, 404);
  assert.equal((await cfg.getConfig(rdb.db)).roadmap_publication_enabled, '0');
});

test('site audience: an editor publishes for his site only; perimeter = site projects minus sensitive; no amounts', async () => {
  await sw('1');
  assert.equal((await pub(T.edA, { audience: 'site', site_id: B, title: 'B' })).status, 403, 'another site');
  assert.equal((await pub(T.viewA, { audience: 'site', site_id: A, title: 'v' })).status, 403, 'a viewer does not publish');
  assert.equal((await pub(T.edA, { audience: 'exec', title: 'x' })).status, 403, 'exec = committee');
  assert.equal((await pub(T.edA, { audience: 'site', title: 'no ref' })).status, 400);
  const r = await pub(T.edA, { audience: 'site', site_id: A, title: 'Hounde roadmap', include_amounts: true });
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.has_amounts, false, 'never amounts for a site audience');
  P.pubA = r.j.id;
  const v = await read(P.pubA, T.viewA); assert.equal(v.status, 200);
  assert.deepEqual(v.j.roadmap.projects.map((p) => p.id), [P.A], 'site A project only, the sensitive one left out');
  assert.equal(v.j.roadmap.projects[0].budget, undefined);
  assert.equal((await read(P.pubA, T.edB)).status, 404, 'out of the audience = does not exist');
  assert.equal((await read(P.pubA, T.pmo)).status, 200, 'committee reads');
  const l = (await send('GET', '/api/governance/roadmap-publications', T.edB)).j.publications;
  assert.ok(!l.some((p) => p.id === P.pubA), 'not listed for another site');
});

test('committee / exec audiences: amounts kept only when the publisher reads money, served only to admin tier / finance', async () => {
  const c1 = await pub(T.pmo, { audience: 'committee', title: 'C1', include_amounts: true });
  assert.equal(c1.status, 200); assert.equal(c1.j.has_amounts, false, 'a committee member without admin cannot freeze amounts');
  const c2 = await pub(T.adm, { audience: 'committee', title: 'C2', include_amounts: true });
  assert.equal(c2.j.has_amounts, true);
  const asPmo = (await read(c2.j.id, T.pmo)).j.roadmap;
  assert.ok(asPmo.projects.every((p) => p.budget === undefined), 'committee-member: amounts masked'); assert.equal(asPmo.amounts_hidden, true);
  assert.ok(asPmo.projects.some((p) => p.id === P.S && p.sensitive === true), 'committee snapshot carries the sensitive project, flagged');
  const asAdm = (await read(c2.j.id, T.adm)).j.roadmap;
  assert.equal(asAdm.projects.find((p) => p.id === P.A).budget, 1234);
  assert.equal((await read(c2.j.id, T.finA)).status, 404, 'committee audience: finance outside it');
  assert.equal((await read(c2.j.id, T.edA)).status, 404);
  const ex = await pub(T.adm, { audience: 'exec', title: 'E', include_amounts: true });
  assert.equal((await read(ex.j.id, T.pmo)).status, 404, 'exec = admin tier only');
  assert.equal((await read(ex.j.id, T.adm)).status, 200);
  const pr = await pub(T.pmo, { audience: 'programme', programme_id: PROG, title: 'Prog' });
  assert.equal(pr.status, 200);
  const asB = (await read(pr.j.id, T.edB)).j.roadmap;
  assert.deepEqual(asB.projects.map((p) => p.id).sort(), [P.A, P.B].sort(), 'programme: holders of a published site read it; sensitive left out');
  assert.equal((await pub(T.pmo, { audience: 'programme', programme_id: 99999999, title: 'x' })).status, 404);
  P.committee = c2.j.id;
});

test('expiry and revocation: an expired / revoked publication does not exist, its share link dies with it', async () => {
  const s = await send('POST', `/api/governance/roadmap-publications/${P.pubA}/share`, T.edA, { ttl_hours: 24 });
  assert.equal(s.status, 200, JSON.stringify(s.j)); assert.ok(s.j.token);
  const view = await send('GET', '/share/' + s.j.token);
  assert.equal(view.status, 200); assert.ok(view.text.includes('Hounde roadmap')); assert.ok(!view.text.includes('1234'), 'no amount on the public view');
  assert.equal((await send('POST', `/api/governance/roadmap-publications/${P.committee}/share`, T.adm, {})).status, 403, 'committee snapshot: no public link');
  assert.equal((await send('POST', '/api/engagement/share', T.adm, { target_kind: 'roadmap_publication', target_key: String(P.pubA) })).status, 400, 'not through the generic share route');
  assert.equal((await send('POST', `/api/governance/roadmap-publications/${P.pubA}/revoke`, T.edB)).status, 404);
  assert.equal((await send('POST', `/api/governance/roadmap-publications/${P.pubA}/revoke`, T.viewA)).status, 403, 'a reader is not the publisher');
  assert.equal((await send('POST', `/api/governance/roadmap-publications/${P.pubA}/revoke`, T.edA)).status, 200);
  assert.equal((await read(P.pubA, T.viewA)).status, 404);
  assert.equal((await send('GET', '/share/' + s.j.token)).status, 404, 'the link stops with the publication');
  const e = await pub(T.edA, { audience: 'site', site_id: A, title: 'short', expires_in_days: 1 });
  await rdb.pgHandle().prepare('UPDATE roadmap_publications SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', e.j.id);
  assert.equal((await read(e.j.id, T.edA)).status, 404, 'expired');
  assert.equal((await send('POST', `/api/governance/roadmap-publications/${e.j.id}/share`, T.edA, {})).status, 404);
  assert.equal((await pub(T.edA, { audience: 'site', site_id: A, title: 'x', expires_in_days: 0 })).status, 400);
  await sw('0');
});
