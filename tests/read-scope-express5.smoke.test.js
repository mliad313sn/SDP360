'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// G2-PLATFORM (2026-11-12) — Express-5 safety of the meetings / inspection READ scope.
// The guards used to narrow an editor's list read by ASSIGNING `req.query.site = codes`.
// In Express 5 `req.query` is a getter re-parsed from the URL on every access, so that
// assignment is silently lost and an editor's list would return EVERY site (security).
// This test serves the real app with `req.query` replaced by an Express-5-like getter
// (a fresh object parsed from the URL on each read): it fails if the scope relies on
// mutating req.query, and passes when the guards keep the scope request-locally.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'rs-x5-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'rs-x5-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'rs-x5-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'rs-x5-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const querystring = require('querystring');

let server, base, mCodeA, mCodeB, iCodeA, iCodeB;
const tok = {};
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const post = (p, t, b) => fetch(base + p, { method: 'POST', headers: H(t), body: JSON.stringify(b) });
const get = (p, t) => fetch(base + p, { headers: H(t) });

// Express 5 semantics: req.query is a getter that re-parses the URL on every access.
function express5Query(req) {
  Object.defineProperty(req, 'query', {
    configurable: true, enumerable: true,
    get() { const i = req.url.indexOf('?'); return querystring.parse(i < 0 ? '' : req.url.slice(i + 1)); },
    set() { /* Express 5 has no writable req.query */ },
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const mdb = require('../meetings-db');
  const idb = require('../inspection-db');
  const L = await mdb.loadLookups();
  const dept = L.departments[0].code;
  const sites = await rdb.listSites();
  const coded = sites.map(s => ({ s, m: idb.siteNameToCode(s.name) })).filter(x => x.m && L.sites.some(ls => ls.code === x.m));
  assert.ok(coded.length >= 2, 'two seeded sites with a meetings/inspection code');
  const [A, B] = coded; mCodeA = iCodeA = A.m; mCodeB = iCodeB = B.m;
  const mk = async (username, roles, site_id) => {
    await rdb.createUser({ username, full_name: username, password: username + '-0000', roles, site_id });
    return (await rdb.login(username, username + '-0000')).token;
  };
  tok.admin   = await mk('rsx5-admin', ['admin'], null);
  tok.editorA = await mk('rsx5-editor-a', ['editor'], A.s.id);
  await new Promise(r => { server = http.createServer((req, res) => { express5Query(req); app(req, res); }).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [code, date] of [[mCodeA, '2026-08-10'], [mCodeB, '2026-08-11']]) {
    const r = await post('/api/meetings/save', tok.admin, { state: { header: { site_code: code, department: dept, meeting_date: date, status: 'draft' } } });
    assert.equal(r.status, 200, 'meeting fixture ' + code);
  }
  for (const [id, code] of [['EM-IT-X5-A', iCodeA], ['EM-IT-X5-B', iCodeB]]) {
    const r = await post('/api/inspection/save', tok.admin, { state: { meta: { f_id: id, f_site: `Site (${code})`, f_date: '2026-09-15', f_area: 'Server room', f_lead: 'Tester' }, status: 'submitted', items: {}, actions: [] } });
    assert.equal(r.status, 200, 'inspection fixture ' + id);
  }
});
after(() => { try { server && server.close(); } catch {} });

test('the harness really behaves like Express 5 (an assignment to req.query is lost)', () => {
  const req = { url: '/x?a=1' }; express5Query(req);
  req.query.site = ['Z'];
  assert.equal(req.query.site, undefined);
});

test('meetings list: an editor without ?site= sees only their own site', async () => {
  const r = await get('/api/meetings/list', tok.editorA);
  assert.equal(r.status, 200);
  const { rows } = await r.json();
  assert.ok(rows.length >= 1, 'own-site PV listed');
  assert.ok(rows.every(x => x.site_code === mCodeA), 'no other site leaks: ' + rows.map(x => x.site_code).join(','));
});

test('meetings list: the admin still sees every site', async () => {
  const { rows } = await (await get('/api/meetings/list', tok.admin)).json();
  const codes = new Set(rows.map(x => x.site_code));
  assert.ok(codes.has(mCodeA) && codes.has(mCodeB));
});

test('meetings list: ?site= outside the editor scope is refused (403)', async () => {
  assert.equal((await get('/api/meetings/list?site=' + encodeURIComponent(mCodeB), tok.editorA)).status, 403);
});

test('inspection list: an editor without ?site= sees only their own site', async () => {
  const r = await get('/api/inspection/list', tok.editorA);
  assert.equal(r.status, 200);
  const { rows } = await r.json();
  assert.ok(rows.some(x => x.id === 'EM-IT-X5-A'), 'own-site inspection listed');
  assert.ok(!rows.some(x => x.id === 'EM-IT-X5-B'), 'the other site\'s inspection does not leak');
});
