'use strict';
// E-B07 — /api/feedback: off → 404; on → submit / list / triage; anonymous row has no user id; an XSS payload
// is stored as text and comes back as JSON text (the page renders it with textContent / escaping).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'fdbk-'));
process.env.DASH_USER = process.env.DASH_USER || 'fdbk-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'fdbk-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'fdbk-key-0123456789abcdef0123456789';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, superToken, viewerToken, viewerId;
function req(method, p, token, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-report-token': token } : {}) } },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(b); } catch { return null; } })() })); });
    r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
const setOn = async (v) => { const rdb = require('../reports-db'); await require('../services/reportConfig').setConfig(rdb.db, { ui_feedback_enabled: v }, 'test'); };
before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const su = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(su.id, ['super_admin']);
  superToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'fdbk-viewer', full_name: 'V', password: 'fdbk-pass-1111', role: 'viewer' });
  viewerId = ((await rdb.listUsers()) || []).find((u) => u.username === 'fdbk-viewer').id;
  viewerToken = (await rdb.login('fdbk-viewer', 'fdbk-pass-1111')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('off (default) → every feedback route 404', async () => {
  assert.equal(require('../services/reportConfig').DEFAULTS.ui_feedback_enabled, '0');
  assert.equal((await req('POST', '/api/feedback', viewerToken, { kind: 'idea', text: 'x' })).status, 404);
  assert.equal((await req('GET', '/api/feedback', superToken)).status, 404);
  assert.equal((await req('GET', '/api/feedback/mine', viewerToken)).status, 404);
  assert.equal((await req('POST', '/api/feedback/1/triage', superToken, { status: 'done' })).status, 404);
});

test('on → submit, list, triage; anonymous row keeps no user id; XSS stays text', async () => {
  await setOn('1');
  const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const named = await req('POST', '/api/feedback', viewerToken, { kind: 'problem', text: xss, page: 'home.html' });
  assert.equal(named.status, 201);
  const anon = await req('POST', '/api/feedback', viewerToken, { kind: 'idea', text: 'anonymous idea', page: 'home.html', anonymous: true });
  assert.equal(anon.status, 201);
  assert.equal((await req('POST', '/api/feedback', viewerToken, { kind: 'rant', text: 'x' })).status, 400);
  assert.equal((await req('POST', '/api/feedback', viewerToken, { kind: 'idea', text: 'x'.repeat(2001) })).status, 400);
  assert.equal((await req('GET', '/api/feedback', viewerToken)).status, 403, 'list is admin tier');
  const list = await req('GET', '/api/feedback?page=home.html', superToken);
  assert.equal(list.status, 200);
  const a = list.json.rows.find((r) => r.id === anon.json.id);
  assert.equal(a.user_id, null); assert.equal(a.anonymous, 1); assert.equal(a.role_tier, 'viewer');
  const n = list.json.rows.find((r) => r.id === named.json.id);
  assert.equal(n.user_id, viewerId); assert.equal(n.body, xss, 'stored verbatim as text, never interpreted server-side');
  assert.equal((await req('POST', `/api/feedback/${named.json.id}/triage`, viewerToken, { status: 'done' })).status, 403);
  assert.equal((await req('POST', `/api/feedback/${named.json.id}/triage`, superToken, { status: 'bogus' })).status, 400);
  const t = await req('POST', `/api/feedback/${named.json.id}/triage`, superToken, { status: 'planned', response: 'Fix in next sprint' });
  assert.equal(t.status, 200);
  const mine = await req('GET', '/api/feedback/mine', viewerToken);
  assert.deepEqual(mine.json.rows.map((r) => r.id), [named.json.id], 'anonymous row is not "mine"');
  assert.equal(mine.json.rows[0].response, 'Fix in next sprint');
  const work = await req('GET', '/api/me/work', viewerToken);
  assert.ok(Array.isArray(work.json.feedback) && work.json.feedback.some((f) => f.response === 'Fix in next sprint'), 'My Work shows the answer');
  await new Promise((r) => setTimeout(r, 300));
  const rows = (await require('../reports-db').listSystemLog({ action: 'feedback_triaged' }, { limit: 5 })).rows;
  assert.equal(rows.length, 1);
  await setOn('0');
  assert.equal((await req('GET', '/api/me/work', viewerToken)).json.feedback, undefined, 'off → nothing on My Work');
});
