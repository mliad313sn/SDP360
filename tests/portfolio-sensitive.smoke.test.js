'use strict';
// B3 (P7a) — over HTTP: the sensitive flag (portfolio_sensitive_projects) and the "my projects" hint
// (portfolio_my_projects_default), both '0' = today. A reader outside the perimeter gets 404 on list, detail and ledger.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pf-sens-'));
process.env.DASH_USER = process.env.DASH_USER || 'pfx-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pfx-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'pfx-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, A, B, T = {}, P = {}, U = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 50; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'portfolio_projects' AND column_name = 'sensitive'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  A = sites.find((s) => /hounde/i.test(s.name)).id; B = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, roles, site) => { const x = await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); U[u] = x && (x.id || x); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('pfx_pmo', ['viewer', 'committee-member']);
  T.edA = await mk('pfx_eda', ['editor'], A);
  T.edB = await mk('pfx_edb', ['editor'], B);
  T.memB = await mk('pfx_memb', ['editor'], B);
  T.finB = await mk('pfx_finb', ['viewer', 'finance-viewer'], B);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'pfx-prog', name: 'Sens' })).j.id;
  const obj = (await put('objective', T.pmo, { programme_id: prog, key: 'pfx-o', name: 'O' })).j.id;
  for (const [k, site] of [['A', A], ['B', B], ['G', null]]) P[k] = (await put('project', T.pmo, { objective_id: obj, key: 'PFX-' + k, name: 'Project ' + k, site_id: site, owner: 'nobody', status: 'active' })).j.id;
  const memId = (await rdb.db.prepare('SELECT id FROM users WHERE username = ?').get('pfx_memb')).id;
  await rdb.pgHandle().prepare('INSERT INTO ppm_project_members (project_id, user_id, label, created_at) VALUES (?, ?, ?, ?)').run(P.A, Number(memId), 'member B', new Date().toISOString());
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const ids = async (t) => (await send('GET', '/api/governance/portfolio', t)).j.projects.map((p) => p.id);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');
const mark = (id, on, t = T.pmo) => send('PUT', `/api/governance/portfolio/project/${id}/sensitive`, t, { sensitive: on });

test('switch off (today): the sensitive action does not exist (404) and nothing is hidden', async () => {
  await sw({ portfolio_sensitive_projects: '0', portfolio_site_scope_reads: '0', portfolio_my_projects_default: '0' });
  assert.equal((await mark(P.A, true)).status, 404);
  assert.ok((await ids(T.edB)).includes(P.A));
  const v = (await send('GET', '/api/governance/portfolio', T.edB)).j;
  assert.equal(v.my_projects, undefined, 'no "my projects" hint while off');
});

test('switch on: only the committee marks a project sensitive; bad body 400; unknown project 404; ledger row', async () => {
  await sw({ portfolio_sensitive_projects: '1' });
  assert.equal((await mark(P.A, true, T.edA)).status, 403, 'an editor of the site does not set it');
  assert.equal((await send('PUT', `/api/governance/portfolio/project/${P.A}/sensitive`, T.pmo, { sensitive: 'yes' })).status, 400);
  assert.equal((await mark(99999999, true)).status, 404);
  const r = await mark(P.A, true); assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.sensitive, true);
  assert.equal((await mark(P.G, true)).status, 200);
  const h = (await send('GET', `/api/governance/portfolio/project/${P.A}/history`, T.pmo)).j.events;
  assert.ok(h.some((e) => e.action === 'sensitive_edit' && e.new_value === '1'));
  assert.ok((await send('GET', '/api/governance/portfolio', T.pmo)).j.can_mark_sensitive);
  assert.ok(!(await send('GET', '/api/governance/portfolio', T.edA)).j.can_mark_sensitive);
});

test('switch on: an editor of another site cannot read the sensitive project — list, detail, ledger, baselines (even with scope off)', async () => {
  await sw({ portfolio_sensitive_projects: '1', portfolio_site_scope_reads: '0' });
  const b = await ids(T.edB);
  assert.ok(!b.includes(P.A) && !b.includes(P.G), 'hidden from the list'); assert.ok(b.includes(P.B));
  assert.equal((await send('GET', `/api/governance/portfolio/project/${P.A}`, T.edB)).status, 404);
  assert.equal((await send('GET', `/api/governance/portfolio/project/${P.A}/history`, T.finB)).status, 404);
  assert.equal((await send('GET', `/api/governance/portfolio/project/${P.A}/baselines`, T.edB)).status, 404);
  // site holder, named member, committee read it; the group-level one stays the committee's
  assert.ok((await ids(T.edA)).includes(P.A)); assert.ok(!(await ids(T.edA)).includes(P.G));
  assert.ok((await ids(T.memB)).includes(P.A), 'named team member');
  assert.equal((await send('GET', `/api/governance/portfolio/project/${P.A}`, T.memB)).status, 200);
  const pmo = await ids(T.pmo); assert.ok(pmo.includes(P.A) && pmo.includes(P.G), 'committee view unchanged');
});

test('scope switch on too: out-of-perimeter projects stay hidden; turning the sensitive switch off restores today', async () => {
  await sw({ portfolio_sensitive_projects: '1', portfolio_site_scope_reads: '1' });
  const b = await ids(T.edB); assert.deepEqual(b.sort(), [P.B].sort(), 'B only: A is another site, G is sensitive group-level');
  await sw({ portfolio_sensitive_projects: '0', portfolio_site_scope_reads: '0' });
  assert.ok((await ids(T.edB)).includes(P.A), 'flag inert while off');
  assert.equal((await send('GET', `/api/governance/portfolio/project/${P.A}`, T.edB)).status, 200);
});

test('my projects hint: ids = owned / my sites / member; "all" only for committee, admin tier, finance; grants nothing', async () => {
  await sw({ portfolio_my_projects_default: '1', portfolio_sensitive_projects: '0', portfolio_site_scope_reads: '0' });
  const e = (await send('GET', '/api/governance/portfolio', T.edB)).j;
  assert.deepEqual(e.my_projects.ids.sort(), [P.B].sort()); assert.equal(e.my_projects.can_see_all, false);
  assert.ok(e.projects.some((p) => p.id === P.A), 'the API still returns every readable project (presentation only)');
  const m = (await send('GET', '/api/governance/portfolio', T.memB)).j;
  assert.deepEqual(m.my_projects.ids.sort((x, y) => x - y), [P.A, P.B].sort((x, y) => x - y), 'member of A + holder of B');
  assert.equal((await send('GET', '/api/governance/portfolio', T.finB)).j.my_projects.can_see_all, true);
  assert.equal((await send('GET', '/api/governance/portfolio', T.pmo)).j.my_projects.can_see_all, true);
  await sw({ portfolio_my_projects_default: '0' });
});
