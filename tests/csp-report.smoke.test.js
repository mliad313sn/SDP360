'use strict';
// A-28a — Content-Security-Policy-Report-Only (switch SDP_CSP_REPORT_ONLY=1, read at boot) and its
// unauthenticated report endpoint POST /api/security/csp-report: small bodies only, two report formats,
// rate-limited per IP, one system_log row (category security, action csp_violation) per violation and
// day, nothing echoed, no query string stored. The enforcing policy is unchanged.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'csp-report-'));
process.env.SDP_CSP_REPORT_ONLY = '1';
process.env.DASH_USER = process.env.DASH_USER || 'cspr-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'cspr-pass-0000';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');

let server, base, rdb;
const wait = () => new Promise((r) => setTimeout(r, 300));   // logEvent is fire-and-forget
const rows = async () => (((await rdb.listSystemLog({ action: 'csp_violation' }, { limit: 200 })) || {}).rows || []);
const directive = (csp, name) => (String(csp || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' ')) || '');
const post = (body, type = 'application/csp-report') => fetch(base + '/api/security/csp-report', { method: 'POST', headers: { 'content-type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const legacy = (doc, blocked = 'inline', d = 'script-src-attr') => ({ 'csp-report': { 'document-uri': doc, 'violated-directive': d, 'effective-directive': d, 'blocked-uri': blocked, disposition: 'report' } });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('switch on: /index.html carries both headers; report-only script-src is nonce-based, enforcing header unchanged', async () => {
  const r = await fetch(base + '/index.html');
  const enforcing = r.headers.get('content-security-policy');
  const ro = r.headers.get('content-security-policy-report-only');
  assert.ok(ro, 'report-only header present');
  assert.strictEqual(directive(enforcing, 'script-src'), "script-src 'self' 'unsafe-inline'", 'enforcing policy unchanged');
  const src = directive(ro, 'script-src');
  const nm = /'nonce-([^']+)'/.exec(src);
  assert.ok(nm, src);
  assert.ok(!src.includes("'unsafe-inline'"), src);
  assert.match(ro, /report-uri \/api\/security\/csp-report/);
  assert.match(String(r.headers.get('reporting-endpoints')), /\/api\/security\/csp-report/);
  // every inline <script> of the page carries the nonce, so the report only lists real violations
  const html = await r.text();
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) if (!/\bsrc=/.test(m[1])) assert.ok(m[1].includes(`nonce="${nm[1]}"`), `<script${m[1]}>`);
});

test('strict pages, share links and the tracker override never get the report-only header', async () => {
  for (const page of ['/login.html', '/exec-view.html', '/share/not-a-real-token', '/activity-tracker.html', '/dashboard-preview/']) {
    const r = await fetch(base + page);
    assert.strictEqual(r.headers.get('content-security-policy-report-only'), null, page);
  }
});

test('a csp-report body → 204, nothing echoed, one system_log row without the query string', async () => {
  const r = await post(legacy('https://dash.example/index.html?token=SECRETQUERY#frag', 'inline'));
  assert.strictEqual(r.status, 204);
  assert.strictEqual(await r.text(), '');
  await wait();
  const mine = (await rows()).filter((x) => String(x.target).includes('/index.html'));
  assert.strictEqual(mine.length, 1);
  assert.strictEqual(mine[0].category, 'security');
  assert.ok(!JSON.stringify(mine[0]).includes('SECRETQUERY'), 'query string never stored');
});

test('the same violation twice in a day → still one row; a reports+json batch is accepted', async () => {
  for (let i = 0; i < 2; i++) assert.strictEqual((await post(legacy('https://dash.example/reports.html', 'https://evil.example/x.js?a=1', 'script-src-elem'))).status, 204);
  const batch = [{ type: 'csp-violation', url: 'https://dash.example/wan.html', body: { documentURL: 'https://dash.example/wan.html?q=1', effectiveDirective: 'script-src-attr', blockedURL: 'inline', disposition: 'report' } }];
  assert.strictEqual((await post(batch, 'application/reports+json')).status, 204);
  await wait();
  const all = await rows();
  const rep = all.filter((x) => String(x.target).includes('/reports.html'));
  assert.strictEqual(rep.length, 1, 'deduplicated per (directive, blocked origin, document path) and day');
  assert.ok(String(rep[0].details).includes('https://evil.example') && !String(rep[0].details).includes('x.js'), 'blocked URI reduced to its origin');
  assert.strictEqual(all.filter((x) => String(x.target).includes('/wan.html')).length, 1);
});

test('body over 16 KB → 413; wrong content-type → 415', async () => {
  const big = JSON.stringify(legacy('https://dash.example/big.html', 'inline')).replace('"report"', '"' + 'x'.repeat(17 * 1024) + '"');
  assert.strictEqual((await post(big)).status, 413);
  assert.strictEqual((await post(legacy('https://dash.example/a.html'), 'application/json')).status, 415);
  assert.strictEqual((await post('x', 'text/plain')).status, 415);
});

test('a burst over the per-IP limit → 429', async () => {
  const codes = [];
  for (let i = 0; i < 70; i++) codes.push((await post(legacy('https://dash.example/burst-' + i + '.html'))).status);
  assert.ok(codes.includes(429), `no 429 in ${codes.length} calls`);
  assert.ok(codes.indexOf(429) > 0, 'the first calls of the burst are accepted');
});
