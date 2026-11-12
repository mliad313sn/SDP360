'use strict';
// UAT-OI-05 (G3-UX) — the executive tier inherits the admin tier, so a director could create a programme (UAT S5-07:
// 200). Switch portfolio_executive_readonly ('0' = today): '1' → an account whose ONLY write tier is `executive` reads
// the portfolio but gets 403 (readable reason) on portfolio / project / benefit / change-request writes; admin,
// super_admin and committee-member (PMO) are unchanged.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'pf-exec-ro-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'pf-exec-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const G = require('../services/portfolioExecutiveReadonly');

let server, base, rdb, reportConfig;
const tok = {};
const send = (m, p, t, b) => fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', 'x-report-token': t }, body: b ? JSON.stringify(b) : undefined });
const sw = (v) => reportConfig.setConfig(rdb.db, { portfolio_executive_readonly: v }, 'smoke');
let n = 0;
const prog = (who) => send('PUT', '/api/governance/portfolio/programme', tok[who], { key: 'p' + (++n), name: 'Programme ' + n });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db'); reportConfig = require('../services/reportConfig');
  const users = { exec: ['executive'], admin: ['admin'], pmo: ['executive', 'committee-member'], viewer: ['viewer'] };
  for (const [u, roles] of Object.entries(users)) {
    await rdb.createUser({ username: 'pfx-' + u, full_name: u, password: 'pfx-' + u + '-pass-0000', roles });
    tok[u] = (await rdb.login('pfx-' + u, 'pfx-' + u + '-pass-0000')).token;
  }
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { try { server && server.close(); } catch {} });

test('unit: who is executive-only, which requests are portfolio writes', () => {
  assert.equal(G.isExecutiveOnly({ roles: ['executive'] }), true);
  assert.equal(G.isExecutiveOnly({ roles: ['executive', 'committee-member'] }), false);
  assert.equal(G.isExecutiveOnly({ roles: ['admin'] }), false);
  assert.equal(G.isExecutiveOnly({ roles: ['super_admin'] }), false);
  assert.equal(G.isPortfolioWrite('PUT', '/api/governance/portfolio/programme'), true);
  assert.equal(G.isPortfolioWrite('POST', '/api/governance/ppm/project/3/changes'), true);
  assert.equal(G.isPortfolioWrite('POST', '/api/governance/ppm/project/3/changes/9/approve'), true);
  assert.equal(G.isPortfolioWrite('GET', '/api/governance/portfolio'), false);
  assert.equal(G.isPortfolioWrite('POST', '/api/governance/sessions/1/decisions'), false);
});

test('default is today: switch off, an executive creates a programme (200)', async () => {
  assert.equal((await reportConfig.getConfig(rdb.db)).portfolio_executive_readonly, '0');
  const r = await prog('exec');
  assert.equal(r.status, 200, await r.text());
});

test('switch on: executive-only → 403 with a readable reason on writes, reads still 200', async () => {
  await sw('1');
  try {
    const r = await prog('exec');
    const b = await r.json();
    assert.equal(r.status, 403);
    assert.equal(b.code, 'executive_read_only');
    assert.match(b.error, /Read-only for the executive tier/);
    const stage = await send('POST', '/api/governance/portfolio/project/1/stage', tok.exec, { to: 'delivery' });
    assert.equal(stage.status, 403);
    const cr = await send('POST', '/api/governance/ppm/project/1/changes', tok.exec, { title: 'x' });
    assert.equal(cr.status, 403);
    const del = await send('DELETE', '/api/governance/portfolio/programme/1', tok.exec);
    assert.equal(del.status, 403);
    const read = await send('GET', '/api/governance/portfolio', tok.exec);
    assert.equal(read.status, 200, 'reads unchanged');
    const rb = await read.json();
    assert.equal(rb.committee, false, 'the page is told not to offer edits'); assert.equal(rb.executive_read_only, true);
  } finally { await sw('0'); }
});

test('switch on: admin and PMO (committee-member) unchanged, viewer still refused by the route itself', async () => {
  await sw('1');
  try {
    assert.equal((await prog('admin')).status, 200);
    assert.equal((await prog('pmo')).status, 200, 'an executive who is also committee-member keeps writing');
    const v = await prog('viewer');
    assert.equal(v.status, 403);
    assert.notEqual((await v.json()).code, 'executive_read_only', 'the route\'s own committee rule answers, not this switch');
  } finally { await sw('0'); }
});

test('switch on: an unauthenticated write is still a 401 from the route (the guard never authenticates)', async () => {
  await sw('1');
  try { assert.equal((await send('PUT', '/api/governance/portfolio/programme', 'nope', { key: 'z', name: 'z' })).status, 401); }
  finally { await sw('0'); }
});
