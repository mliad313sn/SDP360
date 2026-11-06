'use strict';
// E-A01 — survey routes (extracted from server.js into routes/survey.js). Written against the
// server BEFORE the move and kept green after it: same gates, same status codes, same shapes.
// Boots the app in-process on the throwaway PostgreSQL schema (tests/_pg-boot.mjs); no Zoho call
// (the routes that would reach Zoho are only probed for their gate). --test-force-exit.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'survey-smoke-'));
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'survey-smoke-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken, viewerToken;

function req(method, path, token) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers['x-report-token'] = token;
    const r = http.request(base + path, { method, headers, agent: false },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b ? (() => { try { return JSON.parse(b); } catch { return b; } })() : null })); });
    r.on('error', reject); r.end();
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const su = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(su.id, ['super_admin']);
  adminToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'survey-viewer', full_name: 'Viewer', password: 'survey-viewer-pass-1', role: 'viewer' });
  viewerToken = (await rdb.login('survey-viewer', 'survey-viewer-pass-1')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const GETS = ['/api/survey/list', '/api/survey/summary', '/api/survey/kpis', '/api/survey/debug', '/api/survey/by-dimension',
  '/api/survey/voice', '/api/survey', '/api/survey/R1/answers'];
const POSTS = ['/api/survey/cache/clear', '/api/survey/dimension-cache/clear', '/api/survey/voice-cache/clear'];

test('every survey route answers 401 without a session', async () => {
  for (const p of GETS) assert.equal((await req('GET', p)).status, 401, 'GET ' + p);
  for (const p of POSTS) assert.equal((await req('POST', p)).status, 401, 'POST ' + p);
});

test('cache clears are admin-only: viewer 403, admin 200', async () => {
  for (const p of POSTS) {
    assert.equal((await req('POST', p, viewerToken)).status, 403, 'viewer POST ' + p);
    const a = await req('POST', p, adminToken);
    assert.equal(a.status, 200, 'admin POST ' + p);
    assert.equal(a.body.ok, true);
  }
});

test('/api/survey/debug is 404 outside development', async () => {
  const r = await req('GET', '/api/survey/debug', viewerToken);
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { error: 'Not found.' });
});

test('summary on an empty database serves the safe empty shape', async () => {
  const r = await req('GET', '/api/survey/summary', viewerToken);
  assert.equal(r.status, 200);
  assert.equal(r.body.totalResponses, 0);
  assert.equal(r.body.csatPct, null);
  assert.equal(r.body.surveyId, '106803000000002079');
  assert.ok(Array.isArray(r.body.byMonth));
});

test('kpis, by-dimension and voice answer with their shapes', async () => {
  const k = await req('GET', '/api/survey/kpis?yr=2026&mo=2', viewerToken);
  assert.equal(k.status, 200);
  assert.equal(k.body.totalResponses, 0);
  assert.equal(k.body.csatPct, null);
  assert.equal(k.body.groupFiltered, false);
  const d = await req('GET', '/api/survey/by-dimension', viewerToken);
  assert.equal(d.status, 200);
  assert.deepEqual([d.body.byTech, d.body.bySite, d.body.byGroup], [[], [], []]);
  const v = await req('GET', '/api/survey/voice', viewerToken);
  assert.equal(v.status, 200);
  assert.equal(v.body.totalComments, 0);
  assert.ok(!('allComments' in v.body), 'unfiltered voice drops allComments');
  const vm = await req('GET', '/api/survey/voice?month=2026-03', viewerToken);
  assert.equal(vm.status, 200);
  assert.deepEqual(vm.body.allComments, []);
});

test('local-db survey list and answers', async () => {
  const s = await req('GET', '/api/survey?limit=5', viewerToken);
  assert.equal(s.status, 200);
  assert.equal(s.body.ok, true);
  assert.equal(s.body.count, 0);
  const a = await req('GET', '/api/survey/R1/answers', viewerToken);
  assert.equal(a.status, 200);
  assert.equal(a.body.source, 'local_db');
  assert.equal(a.body.count, 0);
});
