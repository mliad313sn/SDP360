'use strict';
// Fiche E5 (2026-10-20) — the public / share pages are served with a nonce-only script-src:
// no 'unsafe-inline', every inline <script> carries the per-request nonce, no inline handlers.
// Other pages still carry 'unsafe-inline' (progressive work, DECISIONS-EN-ATTENTE).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'csp-smoke-'));
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'csp-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'csp-pass-0000';
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
