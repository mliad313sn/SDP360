'use strict';
// F-ARCH-06 — report_config.csp_strict_pages: a comma list of pages served with the nonce-only script-src
// (no 'unsafe-inline') without a deploy. Default '' = today (login, Exec View and share links only).
// The setting can only make a page stricter: it never adds a script origin and never relaxes a built-in strict page.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'csp-cfg-'));
process.env.DASH_USER = process.env.DASH_USER || 'cspc-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'cspc-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'cspc-key';
delete process.env.SDP_CSP_REPORT_ONLY;
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');
const sessionAuth = require('../services/sessionAuth');

let server, base, rdb, cfg;
const scriptSrc = (r) => String(r.headers.get('content-security-policy')).split(';').map((s) => s.trim()).find((s) => s.startsWith('script-src')) || '';
const settle = async () => { sessionAuth.invalidateStrictPages(); await fetch(base + '/login.html'); await new Promise((r) => setTimeout(r, 150)); };

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { try { await cfg.setConfig(rdb.db, { csp_strict_pages: '' }, 'test'); } catch (_) { /* db gone */ } try { server && server.close(); } catch {} });

test('pure: the list accepts local .html paths only and never drops a built-in strict page', () => {
  assert.deepEqual(sessionAuth.parseStrictPages(' /help.html, site-actions.html ,/help.html'), ['/help.html', '/site-actions.html']);
  for (const bad of ['https://evil.example/x.html', '//evil.example/x.html', '/../x.html', '/api/data', '/x.html?y', '*', '/a b.html', '']) {
    assert.deepEqual(sessionAuth.parseStrictPages(bad), [], bad);
  }
  assert.deepEqual(sessionAuth.parseStrictPages(null), []);
  sessionAuth.setStrictPages('/help.html');
  assert.equal(sessionAuth.isStrictCspPath('/help.html'), true);
  assert.equal(sessionAuth.isStrictCspPath('/index.html'), false);
  sessionAuth.setStrictPages('');
  assert.equal(sessionAuth.isStrictCspPath('/help.html'), false);
  for (const p of ['/login.html', '/exec-view.html', '/share/abc']) assert.equal(sessionAuth.isStrictCspPath(p), true, p + ' stays strict');
  assert.ok(!sessionAuth.scriptSrc('n', true).includes('http'), 'the strict policy lists no origin');
});

test('default (empty): a legacy page keeps today\'s policy', async () => {
  assert.equal(cfg.DEFAULTS.csp_strict_pages, '');
  await settle();
  const r = await fetch(base + '/help.html');
  assert.equal(r.status, 200);
  assert.ok(scriptSrc(r).includes("'unsafe-inline'"));
});

test('a listed page gets the nonce-only script-src and its script tags carry the nonce; an unlisted page is unchanged', async () => {
  await cfg.setConfig(rdb.db, { csp_strict_pages: '/help.html' }, 'test');
  await settle();
  const r = await fetch(base + '/help.html');
  const src = scriptSrc(r);
  assert.ok(!src.includes("'unsafe-inline'"), src);
  const nonce = /'nonce-([^']+)'/.exec(src);
  assert.ok(nonce, 'nonce present');
  assert.equal(src, `script-src 'self' 'nonce-${nonce[1]}'`, 'no origin added');
  const html = await r.text();
  const tags = [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
  assert.ok(tags.length > 0 && tags.every((t) => t.includes(`nonce="${nonce[1]}"`)), 'every script tag carries the nonce');
  const other = await fetch(base + '/site-actions.html');
  assert.ok(scriptSrc(other).includes("'unsafe-inline'"), 'unlisted page unchanged');
  assert.ok(!scriptSrc(await fetch(base + '/login.html')).includes("'unsafe-inline'"), 'built-in strict page unchanged');
});

test('emptying the list returns the page to today\'s policy', async () => {
  await cfg.setConfig(rdb.db, { csp_strict_pages: '' }, 'test');
  await settle();
  assert.ok(scriptSrc(await fetch(base + '/help.html')).includes("'unsafe-inline'"));
});
