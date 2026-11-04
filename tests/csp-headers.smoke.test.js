'use strict';
// Fiche E5 (2026-10-20) — the public / share pages are served with a nonce-only script-src:
// no 'unsafe-inline', every inline <script> carries the per-request nonce, no inline handlers.
// Other pages still carry 'unsafe-inline' (progressive work, DECISIONS-EN-ATTENTE).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'csp-smoke-'));
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'csp-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'csp-pass-0000';
delete process.env.SDP_CSP_REPORT_ONLY;   // A-28a: this file pins the DEFAULT (switch off); tests/csp-report.smoke.test.js covers it on
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');

let server, base;
before(async () => {
  const { app } = require('../server');
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

function scriptSrc(csp) { return (String(csp).split(';').map(s => s.trim()).find(s => s.startsWith('script-src')) || ''); }

for (const page of ['/login.html', '/exec-view.html']) {
  test(`${page}: nonce-only script-src, every inline script nonced, no inline handler`, async () => {
    const r = await fetch(base + page);
    assert.equal(r.status, 200);
    const src = scriptSrc(r.headers.get('content-security-policy'));
    assert.ok(src, 'has a script-src directive');
    assert.ok(!src.includes("'unsafe-inline'"), `no 'unsafe-inline' in ${src}`);
    assert.ok(!/jsdelivr|cdnjs|unpkg/.test(src), `no CDN origin on a page an anonymous visitor reaches: ${src}`);
    const nm = /'nonce-([^']+)'/.exec(src);
    assert.ok(nm, 'script-src carries a nonce');
    const html = await r.text();
    const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map(m => m[1]);
    assert.ok(scripts.length > 0);
    for (const attrs of scripts) {
      if (/\bsrc=/.test(attrs)) continue;
      assert.ok(attrs.includes(`nonce="${nm[1]}"`), `inline script without the request nonce: <script${attrs}>`);
    }
    assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(html), 'no inline event-handler attribute');
    assert.ok(!html.includes('%%CSP_NONCE%%'), 'nonce placeholder replaced');
  });
}

test('/share/<token>: nonce-only script-src (even on the expired-link answer)', async () => {
  const r = await fetch(base + '/share/not-a-real-token');
  const src = scriptSrc(r.headers.get('content-security-policy'));
  assert.ok(src && !src.includes("'unsafe-inline'"), `share script-src: ${src}`);
});

test("other pages keep their policy (tracker override untouched)", async () => {
  const r = await fetch(base + '/activity-tracker.html');
  assert.ok(/script-src/.test(String(r.headers.get('content-security-policy'))));
});

// B-01 — the libraries are same-origin (public/vendor/): no production page allows a CDN to run script,
// and 'unsafe-eval' stays only on the dev previews.
for (const page of ['/index.html', '/reports.html', '/executive-report.html', '/activity-tracker.html', '/activity-tracker/dist/app.js', '/wan.html']) {
  test(`${page}: no CDN origin and no 'unsafe-eval' in script-src`, async () => {
    const r = await fetch(base + page);
    const csp = String(r.headers.get('content-security-policy'));
    const src = scriptSrc(csp);
    assert.ok(src, `script-src present on ${page}`);
    assert.ok(!/jsdelivr|cdnjs|unpkg/.test(src), `no CDN origin: ${src}`);
    assert.ok(!src.includes("'unsafe-eval'"), `no 'unsafe-eval': ${src}`);
    assert.ok(!/jsdelivr|cdnjs|unpkg/.test(csp), `no CDN origin anywhere in the policy: ${csp}`);
  });
}

test('the dev previews keep their CDN + unsafe-eval exception', async () => {
  const r = await fetch(base + '/dashboard-preview/');
  const src = scriptSrc(r.headers.get('content-security-policy'));
  assert.ok(src.includes("'unsafe-eval'") && /unpkg/.test(src), src);
});

test('a vendored library is served same-origin as JavaScript', async () => {
  const r = await fetch(base + '/vendor/chart.js/4.4.1/chart.umd.js');
  assert.equal(r.status, 200);
  assert.match(String(r.headers.get('content-type')), /javascript/);
  assert.match(await r.text(), /Chart\.js v4\.4\.1/);
});

// A-28a — the report-only CSP is opt-in (SDP_CSP_REPORT_ONLY=1, read at boot). Default = today: no
// second header and no report endpoint.
test('A-28a default: no Content-Security-Policy-Report-Only header and no report endpoint', async () => {
  for (const page of ['/index.html', '/login.html', '/activity-tracker.html']) {
    const r = await fetch(base + page);
    assert.strictEqual(r.headers.get('content-security-policy-report-only'), null, page);
    assert.strictEqual(r.headers.get('reporting-endpoints'), null, page);
  }
  const p = await fetch(base + '/api/security/csp-report', { method: 'POST', headers: { 'content-type': 'application/csp-report' }, body: '{"csp-report":{}}' });
  assert.notStrictEqual(p.status, 204, 'the endpoint only exists when the switch is on');
});
