'use strict';
const fetch = require('./_http-fetch');
// W1-INTEGRITY / I-CONC-1 (PPM parity W0, P0) — tasks, projects and milestones were last-writer-wins. Each row now
// carries a `version` (migration 092) that every write bumps; a write that sends the version it read is refused
// with 409 STALE_VERSION when someone else saved in between. A write without a version keeps today's behaviour.
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'conc-smoke-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
let server, base, member, rdb;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  const mk = async (u, role, roles) => { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', role, roles }); } catch {} return (await rdb.login(u, u + 'pass1234')).token; };
  member = await mk('cc_member', 'viewer', ['viewer', 'committee-member']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const put = (kind, body) => fetch(base + '/api/governance/portfolio/' + kind, { method: 'PUT', headers: { 'x-report-token': member, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('store: version starts at 1, every write bumps it, a stale version is refused (409 STALE_VERSION), no version = today', async () => {
  const { makeGovernanceStore } = require('../services/governanceStore');
  const s = makeGovernanceStore({ prepare: (sql) => rdb.pgHandle().prepare(sql), runTransaction: (fn) => rdb.pgHandle().runTransaction(fn) }, { isPg: true });
  const pr = await s.upsertPortfolio('programme', { key: 'cc-p', name: 'P' }); const ob = await s.upsertPortfolio('objective', { programme_id: pr, key: 'cc-o', name: 'O' });
  const pj = await s.upsertPortfolio('project', { objective_id: ob, key: 'cc-j', name: 'J' });
  const t = await s.upsertPortfolio('task', { project_id: pj, name: 'T' });
  const m = await s.upsertPortfolio('milestone', { project_id: pj, name: 'M' });
  let d = await s.projectDetail(pj);
  assert.equal(d.project.version, 1); assert.equal(d.tasks[0].version, 1); assert.equal(d.milestones[0].version, 1);
  for (const [kind, id, ver] of [['project', pj, 1], ['task', t, 1], ['milestone', m, 1]]) {
    assert.equal(await s.upsertPortfolio(kind, { id, name: kind + ' A', version: ver }), id, kind + ': the first writer wins');
    await assert.rejects(() => s.upsertPortfolio(kind, { id, name: kind + ' B', version: ver }), (e) => e.status === 409 && e.reason === 'STALE_VERSION' && e.code === 'CONFLICT', kind + ': the second writer is told');
    assert.equal(await s.upsertPortfolio(kind, { id, name: kind + ' C' }), id, kind + ': no version = last writer wins, as before');
  }
  d = await s.projectDetail(pj);
  assert.equal(d.project.name, 'project C'); assert.equal(d.project.version, 3); assert.equal(d.tasks[0].name, 'task C'); assert.equal(d.tasks[0].version, 3); assert.equal(d.milestones[0].version, 3);
  await assert.rejects(() => s.upsertPortfolio('task', { id: t, version: 'x' }), (e) => e.code === 'INVALID');
});

test('route: 409 carries code STALE_VERSION and a readable message; the fresh version passes', async () => {
  const pr = await (await put('programme', { key: 'cr-p', name: 'P' })).json(); const ob = await (await put('objective', { programme_id: pr.id, key: 'cr-o', name: 'O' })).json();
  const pj = (await (await put('project', { objective_id: ob.id, key: 'cr-j', name: 'J' })).json()).id;
  const t = (await (await put('task', { project_id: pj, name: 'T' })).json()).id;
  const v = (await (await fetch(base + '/api/governance/portfolio/project/' + pj, { headers: { 'x-report-token': member } })).json());
  const ver = v.tasks.find((x) => x.id === t).version; assert.equal(ver, 1);
  assert.equal((await put('task', { id: t, name: 'first', version: ver })).status, 200);
  const r = await put('task', { id: t, name: 'second', version: ver }); assert.equal(r.status, 409);
  const j = await r.json(); assert.equal(j.code, 'STALE_VERSION'); assert.match(j.error, /changed/i);
  assert.equal((await put('task', { id: t, name: 'second', version: ver + 1 })).status, 200);
});

test('pages send the version they read and explain a 409 in plain words', () => {
  const proj = fs.readFileSync(path.join(__dirname, '..', 'public', 'project.html'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(proj, /STALE_VERSION:/);
  assert.match(proj, /b\.version = t\.version/);
  assert.match(proj, /b\.version = m\.version/);
  assert.match(proj, /version: V\.project\.version/);
  const pf = fs.readFileSync(path.join(__dirname, '..', 'public', 'portfolio.html'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(pf, /STALE_VERSION/);
  assert.match(pf, /b\.version = /);
});
