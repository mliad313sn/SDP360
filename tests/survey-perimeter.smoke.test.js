'use strict';
// A8 — voice of the user: invariant 1 (site perimeter) on the survey routes, and the CSAT/NPS tiles per site and group.
// An editor sees only the verbatims / scores of tickets handled by HIS sites' helpdesk groups; the admin tier sees all;
// a site-less account sees none. A survey reply is attached to a site through its ticket (request_records.tech_group ∈
// sites.zoho_group). No response = null ("no responses"), never 0; a failed survey sync reads "unknown" with its cause.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'survey-perim-'));
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'survey-perim-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb;
const tok = {};
function req(method, path, token) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers['x-report-token'] = token;
    const r = http.request(base + path, { method, headers, agent: false },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b ? (() => { try { return JSON.parse(b); } catch { return b; } })() : null })); });
    r.on('error', reject); r.end();
  });
}
const SECRET_B = 'Site B verbatim — printer never fixed at all';
const TEXT_A = 'Site A verbatim — very slow resolution of my laptop';

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const H = rdb.db;
  const su = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(su.id, ['super_admin']);
  tok.admin = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  for (const [n, g] of [['A8 Site A', 'A8 Desk A'], ['A8 Site B', 'A8 Desk B'], ['A8 Site Quiet', 'A8 Desk Quiet']]) {
    await H.prepare('INSERT INTO sites (name, zoho_group) VALUES (?, ?) ON CONFLICT DO NOTHING').run(n, g);
  }
  const sid = async (n) => Number((await H.prepare('SELECT id FROM sites WHERE name=?').get(n)).id);
  const A = await sid('A8 Site A');
  await rdb.createUser({ username: 'a8-editor', full_name: 'Editor A', password: 'a8-editor-pass-1', role: 'editor', site_id: A });
  tok.editor = (await rdb.login('a8-editor', 'a8-editor-pass-1')).token;
  await rdb.createUser({ username: 'a8-nosite', full_name: 'No site', password: 'a8-nosite-pass-1', role: 'editor' });
  tok.nosite = (await rdb.login('a8-nosite', 'a8-nosite-pass-1')).token;
  const reqRow = (id, disp, grp, created, pending) => H.prepare(`INSERT INTO request_records (request_id, display_id, request_status, pending_status, overdue_status, tech_group, created_time)
    VALUES (?, ?, ?, ?, 0, ?, ?)`).run(id, disp, pending === 0 ? 'Closed' : 'Open', pending, grp, created);
  await reqRow('RA1', '1001', 'A8 Desk A', '2026-08-03T08:00:00.000Z', 0);
  await reqRow('RA2', '1002', 'A8 Desk A', '2026-08-04T08:00:00.000Z', 0);
  await reqRow('RA3', '1003', 'A8 Desk A', '2026-08-05T08:00:00.000Z', 0);
  await reqRow('RA4', '1004', 'A8 Desk A', '2026-08-06T08:00:00.000Z', 0);
  await reqRow('RB1', '2001', 'A8 Desk B', '2026-08-03T08:00:00.000Z', 0);
  await reqRow('RQ1', '3001', 'A8 Desk Quiet', '2026-08-03T08:00:00.000Z', 0);
  const res = (rid, resp, reqId, disp, score) => H.prepare(`INSERT INTO survey_results (result_id, response_id, request_id, request_display_id, overall_score, survey_sent_on, survey_responded_on)
    VALUES (?, ?, ?, ?, ?, '2026-08-10T08:00:00.000Z', '2026-08-11T08:00:00.000Z')`).run(rid, resp, reqId, disp, score);
  await res('SA1', 'RESP-A1', 'RA1', '1001', 100);
  await res('SA2', 'RESP-A2', 'RA2', '1002', 60);
  await res('SB1', 'RESP-B1', 'RB1', '2001', 40);
  const ans = (resp, rid, text) => H.prepare(`INSERT INTO survey_answers (response_id, result_id, question_id, answer_text, skipped) VALUES (?, ?, 'Q1', ?, 0)`).run(resp, rid, text);
  await ans('RESP-A1', 'SA1', TEXT_A);
  await ans('RESP-B1', 'SB1', SECRET_B);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const has = (body, s) => JSON.stringify(body).includes(s);

test('voice verbatims: editor sees only his site, admin all, site-less none', async () => {
  const e = await req('GET', '/api/survey/voice?month=2026-08', tok.editor);
  assert.equal(e.status, 200);
  assert.ok(has(e.body, TEXT_A), 'own site verbatim visible');
  assert.ok(!has(e.body, SECRET_B), 'other site verbatim NOT visible');
  const eAll = await req('GET', '/api/survey/voice', tok.editor);
  assert.ok(!has(eAll.body, SECRET_B), 'unfiltered view (quotes) does not leak either');
  assert.equal(eAll.body.totalComments, 1);
  const a = await req('GET', '/api/survey/voice?month=2026-08', tok.admin);
  assert.ok(has(a.body, TEXT_A) && has(a.body, SECRET_B), 'admin tier sees all');
  const n = await req('GET', '/api/survey/voice?month=2026-08', tok.nosite);
  assert.equal(n.status, 200);
  assert.equal(n.body.totalComments, 0);
});

test('single response answers and the raw list are perimeter-filtered (no leak, no existence oracle)', async () => {
  const b = await req('GET', '/api/survey/RESP-B1/answers', tok.editor);
  assert.equal(b.status, 200); assert.equal(b.body.count, 0); assert.ok(!has(b.body, SECRET_B));
  const a = await req('GET', '/api/survey/RESP-A1/answers', tok.editor);
  assert.equal(a.body.count, 1);
  assert.equal((await req('GET', '/api/survey/RESP-B1/answers', tok.admin)).body.count, 1);
  const l = await req('GET', '/api/survey?limit=50', tok.editor);
  const ids = l.body.data.map((r) => r.response_id).sort();
  assert.deepEqual(ids, ['RESP-A1', 'RESP-A2']);
  assert.equal((await req('GET', '/api/survey?limit=50', tok.nosite)).body.count, 0);
});

test('kpis / by-dimension / summary: an editor cannot read another site\'s scores', async () => {
  const k = await req('GET', '/api/survey/kpis?yr=2026&mo=8&groups=A8%20Desk%20B', tok.editor);
  assert.equal(k.body.totalResponses, 0, 'requested foreign group is dropped');
  assert.equal(k.body.csatPct, null);
  const k2 = await req('GET', '/api/survey/kpis?yr=2026&mo=8', tok.editor);
  assert.equal(k2.body.totalResponses, 2, 'no groups requested → own groups only');
  const d = await req('GET', '/api/survey/by-dimension', tok.editor);
  assert.deepEqual(d.body.byGroup.map((g) => g.group), ['A8 Desk A']);
  const da = await req('GET', '/api/survey/by-dimension', tok.admin);
  assert.ok(da.body.byGroup.some((g) => g.group === 'A8 Desk B'));
  const s = await req('GET', '/api/survey/summary', tok.editor);
  assert.equal(s.body.totalResponses, 2);
  const sn = await req('GET', '/api/survey/summary', tok.nosite);
  assert.equal(sn.body.totalResponses, 0); assert.equal(sn.body.csatPct, null);
});

test('voice tiles per site and group: CSAT/NPS, response rate on closed tickets, trend, helpdesk volume, perimeter', async () => {
  await rdb.db.prepare(`INSERT INTO sync_metadata (job_name, last_sync_at) VALUES ('survey', '2026-08-12T00:00:00Z')
    ON CONFLICT (job_name) DO UPDATE SET last_sync_at = EXCLUDED.last_sync_at, last_error = NULL, last_error_at = NULL`).run();
  const t = await req('GET', '/api/survey/voice-tiles?yr=2026&mo=8', tok.admin);
  assert.equal(t.status, 200);
  assert.equal(t.body.freshness.state, 'ok');
  assert.match(t.body.response_rate_definition, /closed tickets/);
  const A = t.body.sites.find((s) => s.site === 'A8 Site A');
  assert.equal(A.responses, 2); assert.equal(A.closed, 4); assert.equal(A.response_rate_pct, 50);
  assert.equal(A.csat_pct, 50, '1 of 2 scored ≥ 80');
  assert.equal(A.nps, 0, '1 promoter, 1 detractor');
  assert.equal(A.inbound, 4);
  assert.ok(Array.isArray(A.trend) && A.trend.length === 6);
  assert.equal(A.trend[A.trend.length - 1].csat_pct, 50);
  assert.equal(A.trend[0].csat_pct, null, 'a month without responses is null, never 0');
  const Q = t.body.sites.find((s) => s.site === 'A8 Site Quiet');
  assert.equal(Q.responses, 0); assert.equal(Q.csat_pct, null); assert.equal(Q.nps, null);
  assert.equal(Q.response_rate_pct, 0, '1 closed ticket, 0 responses: a measured 0 %');
  assert.equal(Q.state, 'no_responses');
  assert.ok(t.body.groups.some((g) => g.group === 'A8 Desk B'));
  const e = await req('GET', '/api/survey/voice-tiles?yr=2026&mo=8', tok.editor);
  assert.deepEqual(e.body.sites.map((s) => s.site), ['A8 Site A']);
  assert.deepEqual(e.body.groups.map((g) => g.group), ['A8 Desk A']);
  const n = await req('GET', '/api/survey/voice-tiles?yr=2026&mo=8', tok.nosite);
  assert.deepEqual(n.body.sites, []);
});

test('voice tiles: a failed survey sync reads unknown with its cause', async () => {
  await rdb.db.prepare(`INSERT INTO sync_metadata (job_name, last_sync_at, last_error, last_error_at) VALUES ('survey', '2026-08-01T00:00:00Z', 'Zoho 7301 SECURITY_NOT_PERMITTED', '2026-08-20T00:00:00Z')
    ON CONFLICT (job_name) DO UPDATE SET last_sync_at = EXCLUDED.last_sync_at, last_error = EXCLUDED.last_error, last_error_at = EXCLUDED.last_error_at`).run();
  const t = await req('GET', '/api/survey/voice-tiles?yr=2026&mo=8', tok.admin);
  assert.equal(t.body.freshness.state, 'unknown');
  assert.match(t.body.freshness.cause, /7301/);
  assert.ok(t.body.sites.every((s) => s.state === 'unknown'), 'every tile says unknown');
  await rdb.db.prepare(`DELETE FROM sync_metadata WHERE job_name='survey'`).run();
  const never = await req('GET', '/api/survey/voice-tiles?yr=2026&mo=8', tok.admin);
  assert.equal(never.body.freshness.state, 'unknown');
  assert.match(never.body.freshness.cause, /never run/);
  assert.equal((await req('GET', '/api/survey/voice-tiles?yr=2026&mo=13', tok.admin)).status, 400);
});
