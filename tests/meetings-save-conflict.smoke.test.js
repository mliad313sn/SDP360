'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// A-06 — POST /api/meetings/save with a stale edit token answers 409 CONFLICT (not the 403 the
// "Cross-site|closed" regex would produce) and writes nothing; GET returns header.edit_token.
process.env.DASH_USER = process.env.DASH_USER || 'mtg-conflict-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'mtg-conflict-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'mtg-conflict-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, mdb, code, dept, pvId, tok;
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  mdb = require('../meetings-db');
  const L = await mdb.loadLookups();
  dept = L.departments[0].code;
  const coded = (await rdb.listSites()).map(s => ({ s, code: require('../inspection-db').siteNameToCode(s.name) }))
    .filter(x => x.code && L.sites.some(ls => ls.code === x.code));
  assert.ok(coded.length >= 1, 'a seeded site with a meetings code');
  code = coded[0].code;
  await rdb.createUser({ username: 'mc-editor', full_name: 'mc-editor', password: 'mc-editor-0000', roles: ['editor'], site_id: coded[0].s.id });
  tok = (await rdb.login('mc-editor', 'mc-editor-0000')).token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  const out = await mdb.saveMeeting({ header: { site_code: code, department: dept, meeting_date: '2025-03-14', status: 'draft' },
    actions: [{ description: 'Replace switch', status: 'open' }] }, null, null);
  pvId = out.id;
});
after(() => { try { server && server.close(); } catch {} });

test('GET /api/meetings/:id returns header.edit_token as a string', async () => {
  const r = await fetch(`${base}/api/meetings/${pvId}`, { headers: H(tok) });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(typeof j.header.edit_token, 'string');
  assert.ok(j.header.edit_token.length > 10);
});

test('a stale token → 409 CONFLICT (not 403) and nothing changes', async () => {
  const rec = await (await fetch(`${base}/api/meetings/${pvId}`, { headers: H(tok) })).json();
  const stale = rec.header.edit_token;
  await mdb.addActionUpdate(rec.actions[0].id, { status_change: 'resolved', body: 'closed from the register' });
  const r = await fetch(base + '/api/meetings/save', { method: 'POST', headers: H(tok), body: JSON.stringify({ state: {
    id: pvId, header: { ...rec.header, priority_1: 'stale edit', expected_edit_token: stale }, issues: rec.issues, actions: rec.actions } }) });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.code, 'CONFLICT');
  assert.equal(typeof j.current_token, 'string');
  assert.notEqual(j.current_token, stale);
  const after = await mdb.getMeeting(pvId);
  assert.notEqual(after.header.priority_1, 'stale edit');
  assert.equal(after.actions[0].status, 'resolved');
});

test('the current token → 200', async () => {
  const rec = await (await fetch(`${base}/api/meetings/${pvId}`, { headers: H(tok) })).json();
  const r = await fetch(base + '/api/meetings/save', { method: 'POST', headers: H(tok), body: JSON.stringify({ state: {
    id: pvId, header: { ...rec.header, priority_1: 'fresh', expected_edit_token: rec.header.edit_token }, issues: rec.issues, actions: rec.actions } }) });
  assert.equal(r.status, 200);
  assert.equal((await mdb.getMeeting(pvId)).header.priority_1, 'fresh');
});
