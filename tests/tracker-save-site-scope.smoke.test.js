'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Tracker save scope, end to end — found 2026-10-02 in prod: the Houndé coordinator
// (tracker-editor, site row named "Hounde") got 403 "Your account has no site assigned"
// on POST /api/tracker/save, because the route looked the site NAME up in an exact,
// case-sensitive map. A tracker-editor whose site is named like the prod rows must save
// with its own scope; one whose site resolves to nothing must still be refused.
// Throwaway sqlite; boots the app in-process.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'tracker-scope-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'tracker-scope-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'tracker-scope-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'tracker-scope-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb;
const tok = {};
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  // The boot seed may already carry a site of that name (it does for "Hounde").
  const site = (n, g) => {
    if (!rdb.listSites().some(s => s.name === n)) rdb.createSite({ name: n, zoho_group: g });
    return rdb.listSites().find(s => s.name === n);
  };
  const hounde  = site('Hounde', 'Hounde IT Agents');
  const nowhere = site('Nowhere Mine', 'Nobody IT Agents');
  const mk = async (username, roles, site_id) => {
    await rdb.createUser({ username, full_name: username, password: username + '-0000', roles, site_id });
    return (await rdb.login(username, username + '-0000')).token;
  };
  tok.hounde  = await mk('tracker-hounde',  ['admin', 'tracker-editor'], hounde.id);
  tok.nowhere = await mk('tracker-nowhere', ['tracker-editor'], nowhere.id);
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

async function loadD(t) {
  const r = await fetch(base + '/api/tracker/load', { headers: H(t) });
  assert.equal(r.status, 200, 'load');
  return (await r.json()).D;
}

test('a tracker-editor whose site row is named "Hounde" saves with scope HGO (200)', async () => {
  const D = await loadD(tok.hounde);
  const r = await fetch(base + '/api/tracker/save', { method: 'POST', headers: H(tok.hounde), body: JSON.stringify({ D }) });
  const body = await r.json();
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(body)}`);
  assert.equal(body.scope, 'HGO');
});

test('a tracker-editor whose site resolves to no tracker code is still refused (403)', async () => {
  // GET /api/tracker/load is admin-gated, so load the document with the Houndé
  // account; the refusal under test is the SAVE's site resolution.
  const D = await loadD(tok.hounde);
  const r = await fetch(base + '/api/tracker/save', { method: 'POST', headers: H(tok.nowhere), body: JSON.stringify({ D }) });
  assert.equal(r.status, 403);
});

test('closed months (2026-10-16): a tracker-editor cannot change a past month, the current one saves', async (t) => {
  const now = new Date(), y = now.getFullYear(), cur = now.getMonth(), past = cur - 2;
  if (past < 0) return t.skip('January/February: the closed month sits in the previous year');
  const D = await loadD(tok.hounde);
  const row = D.inputs && D.inputs[y] && D.inputs[y].HGO && D.inputs[y].HGO[0];
  if (!row) return t.skip('no seeded HGO input row for the current year');
  const before = row[past];
  row[past] = (Number(before) || 0) + 7;
  row[cur] = (Number(row[cur]) || 0) + 3;
  const want = row[cur];
  const r = await fetch(base + '/api/tracker/save', { method: 'POST', headers: H(tok.hounde), body: JSON.stringify({ D }) });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.ok(body.closed_blocked >= 1, 'the closed-month edit is reported');
  const after = (await loadD(tok.hounde)).inputs[y].HGO[0];
  assert.equal(Number(after[past]) || 0, Number(before) || 0, 'closed month unchanged');
  assert.equal(Number(after[cur]), want, 'current month saved');
});
