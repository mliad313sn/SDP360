'use strict';
// R2-WORKBENCH (REBUILD-SPEC R5) over HTTP, fictitious data only: every action is 404 while its PROPOSED switch is
// '0' (= today), then behaves as specified once the switch is '1'. Switches are put back to '0' after each test.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-wb-'));
process.env.DASH_USER = process.env.DASH_USER || 'ppmwb-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ppmwb-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ppmwb-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, A, B, pid, pidB, obj, T = {}, ID = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_project_members'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  A = sites.find((s) => /hounde/i.test(s.name)).id; B = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); ID[u] = Number(((await rdb.listUsers()) || []).find((x) => x.username === u).id); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('wb_pmo', ['viewer', 'committee-member']);
  T.cio = await mk('wb_cio', ['viewer', 'committee-member']);
  T.fin = await mk('wb_fin', ['viewer', 'finance-viewer']);
  T.viewer = await mk('wb_viewer', ['viewer'], A);
  T.editorB = await mk('wb_editor_b', ['editor'], B);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'wb-prog', name: 'WB' })).j.id;
  obj = (await put('objective', T.pmo, { programme_id: prog, key: 'wb-o', name: 'O' })).j.id;
  pid = (await put('project', T.pmo, { objective_id: obj, key: 'WB-1', name: 'Fictitious radio upgrade', owner: 'wb_pmo', site_id: A, start_date: '2026-11-02', end_date: '2027-03-31', budget: 1000, currency: 'USD' })).j.id;
  pidB = (await put('project', T.pmo, { objective_id: obj, key: 'WB-2', name: 'Fictitious site B work', owner: 'wb_pmo', site_id: B, start_date: '2026-11-02', end_date: '2027-03-31' })).j.id;
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j, r }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');

test('R2-WB-04 team: 404 while off and the conflicts are today’s; on: plan-write rule, member allocation fills unknown tasks, ledger row', async () => {
  const url = `/api/governance/ppm/project/${pid}/team`;
  await sw({ ppm_project_team_enabled: '0' });
  for (const n of [1, 2]) assert.equal((await put('task', T.pmo, { project_id: pid, name: 'Survey ' + n, owner: 'Ana', start_date: '2026-11-02', end_date: '2026-11-06', allocation_pct: null })).status, 200);
  assert.equal((await send('GET', url, T.pmo)).status, 404);
  assert.equal((await send('PUT', url, T.pmo, { label: 'Ana', allocation_pct: 60 })).status, 404);
  const before = (await send('GET', `/api/governance/portfolio/project/${pid}`, T.pmo)).j;
  assert.deepEqual(before.resource_conflicts, [], 'unknown allocations are never summed');
  assert.equal((await send('GET', '/api/governance/ppm/features', T.viewer)).j.team, false);
  await sw({ ppm_project_team_enabled: '1' });
  try {
    assert.equal((await send('PUT', url, T.viewer, { label: 'Ana', allocation_pct: 60 })).status, 403, 'plan-write rule (committee while editor writes are off)');
    const bad = await send('PUT', url, T.pmo, { label: 'Ana', allocation_pct: 150 });
    assert.equal(bad.status, 400); assert.equal(bad.j.code, 'BAD_ALLOCATION');
    const ok = await send('PUT', url, T.pmo, { label: 'Ana', role: 'radio technician', allocation_pct: 60 });
    assert.equal(ok.status, 200, JSON.stringify(ok.j)); assert.equal(ok.j.members.length, 1);
    const g = await send('GET', url, T.viewer); assert.equal(g.status, 200); assert.equal(g.j.members[0].allocation_pct, 60);
    const after = (await send('GET', `/api/governance/portfolio/project/${pid}`, T.pmo)).j;
    assert.deepEqual(after.resource_conflicts.map((c) => [c.owner, c.peak_pct]), [['Ana', 120]], 'two unknown tasks read at the member allocation');
    assert.equal((await send('GET', `/api/governance/ppm/project/${pidB}/team`, T.viewer)).status, 200, 'site scope off: readable');
    await sw({ portfolio_site_scope_reads: '1' });
    assert.equal((await send('GET', `/api/governance/ppm/project/${pidB}/team`, T.viewer)).status, 404, 'another site under the read scope does not exist');
    await sw({ portfolio_site_scope_reads: '0' });
    const mid = ok.j.member.id;
    assert.equal((await send('DELETE', `${url}/${mid}`, T.pmo)).status, 200);
    const h = await send('GET', `/api/governance/portfolio/project/${pid}/history`, T.pmo);
    assert.deepEqual(h.j.events.filter((e) => /^team_member/.test(e.action)).map((e) => e.action), ['team_member_added', 'team_member_removed']);
    assert.equal((await send('GET', '/api/governance/ppm/features', T.viewer)).j.team, true);
  } finally { await sw({ ppm_project_team_enabled: '0', portfolio_site_scope_reads: '0' }); }
});
