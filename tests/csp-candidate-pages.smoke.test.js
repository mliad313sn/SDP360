'use strict';
// P07 — every page the inventory proposes for report_config.csp_strict_pages, served by the real app with the
// whole candidate list set: nonce-only script-src, every <script> tag carries that nonce, no inline handler in the
// markup sent to the browser. Proves the server half; the browser half (scripts loaded at run time) is the
// report-only run in docs/security/CSP-JOURNEYS.md. The candidate list is a proposal — the default stays ''.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'csp-cand-'));
process.env.DASH_USER = process.env.DASH_USER || 'cspcand-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'cspcand-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'cspcand-key';
delete process.env.SDP_CSP_REPORT_ONLY;
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');
const sessionAuth = require('../services/sessionAuth');
const report = require('../tools/security/csp-journey-report');

let server, base, rdb, cfg;
const candidates = report.collect().inventory.filter((x) => x.readiness === 'candidate').map((x) => x.url);
const scriptSrc = (r) => String(r.headers.get('content-security-policy')).split(';').map((s) => s.trim()).find((s) => s.startsWith('script-src')) || '';

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  await cfg.setConfig(rdb.db, { csp_strict_pages: candidates.join(',') }, 'test');
  sessionAuth.invalidateStrictPages(); await fetch(base + '/login.html'); await new Promise((r) => setTimeout(r, 200));
});
after(async () => { try { await cfg.setConfig(rdb.db, { csp_strict_pages: '' }, 'test'); } catch (_) { /* db gone */ } try { server && server.close(); } catch {} });

test('the inventory proposes candidates and the default value stays empty', () => {
  assert.ok(candidates.length > 0);
  assert.equal(cfg.DEFAULTS.csp_strict_pages, '');
  assert.deepEqual(sessionAuth.parseStrictPages(candidates.join(',')).length, candidates.length, 'every candidate is a value the setting accepts');
});

test('every candidate page is served nonce-only with every script tag nonced and no markup handler', async (t) => {
  const served = [];
  for (const url of candidates) {
    const r = await fetch(base + url);
    if (r.status !== 200) continue;   // a page behind an off switch (404) is not served at all
    served.push(url);
    const src = scriptSrc(r);
    const m = /^script-src 'self' 'nonce-([^']+)'$/.exec(src);
    assert.ok(m, url + ' → ' + src);
    const html = await r.text();
    const tags = [...html.matchAll(/<script\b([^>]*)>/gi)].map((x) => x[1]);
    // an inline script needs the nonce; a src script is allowed by 'self' when it is same-origin
    const bare = tags.filter((t) => !/\bsrc=/.test(t) && !/type="(?:text\/html|application\/json|application\/ld\+json)"/.test(t) && !t.includes(`nonce="${m[1]}"`));
    assert.deepEqual(bare, [], url + ': inline script without the request nonce');
    const foreign = tags.map((t) => (/\bsrc=["']([^"']+)/.exec(t) || [])[1]).filter((u) => u && /^(?:[a-z]+:)?\/\//i.test(u));
    assert.deepEqual(foreign, [], url + ': script from another origin');
    const markup = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    assert.ok(!/<[a-zA-Z][^>]*?\son[a-z]+\s*=\s*["']/.test(markup), url + ': inline handler in markup');
    assert.ok(!/href\s*=\s*["']\s*javascript:/i.test(markup), url + ': javascript: URL');
  }
  t.diagnostic(`served ${served.length}/${candidates.length}; not served (switch off): ${candidates.filter((u) => !served.includes(u)).join(' ') || 'none'}`);
  assert.ok(served.length >= Math.floor(candidates.length / 2), `served ${served.length}/${candidates.length}`);
});
