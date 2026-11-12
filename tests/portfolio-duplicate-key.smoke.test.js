'use strict';
// UAT-F (S5-07, AI-simulated committee — not user acceptance): saving a NEW programme / objective / project with a key
// that is already used answered a raw 500 carrying the database constraint name. It is a 409 CONFLICT with a message
// the person can act on; the existing row is untouched. Fictitious data only.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pf-dup-'));
process.env.DASH_USER = process.env.DASH_USER || 'pfdup-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pfdup-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'pfdup-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, tok;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  const rdb = require('../reports-db');
  await rdb.createUser({ username: 'pfdup_pmo', full_name: 'pfdup_pmo', password: 'pfdup_pmo-pass1234', roles: ['viewer', 'committee-member'] });
  tok = (await rdb.login('pfdup_pmo', 'pfdup_pmo-pass1234')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const put = async (kind, body) => { const r = await fetch(base + '/api/governance/portfolio/' + kind, { method: 'PUT', headers: { 'x-report-token': tok, 'content-type': 'application/json' }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; };

test('a new programme / objective / project with a key already used is a 409 with a readable message, never a 500', async () => {
  const p1 = await put('programme', { key: 'dup-prog', name: 'First' });
  assert.equal(p1.status, 200);
  const p2 = await put('programme', { key: 'dup-prog', name: 'Second' });
  assert.equal(p2.status, 409, JSON.stringify(p2.j));
  assert.match(p2.j.error, /already exists/);
  assert.doesNotMatch(JSON.stringify(p2.j), /constraint|portfolio_programmes/);
  const o1 = await put('objective', { programme_id: p1.j.id, key: 'dup-o', name: 'O' });
  assert.equal(o1.status, 200);
  assert.equal((await put('objective', { programme_id: p1.j.id, key: 'dup-o', name: 'O2' })).status, 409);
  assert.equal((await put('project', { objective_id: o1.j.id, key: 'DUP-1', name: 'P' })).status, 200);
  assert.equal((await put('project', { objective_id: o1.j.id, key: 'DUP-1', name: 'P again' })).status, 409);
  // editing the existing row by id still works
  assert.equal((await put('programme', { id: p1.j.id, key: 'dup-prog', name: 'Renamed' })).status, 200);
});
