'use strict';
// P11 UX/field F-3 — browser proof (real Chromium, real service worker): after a signed-in user's bootstrap and
// field dashboard went through the service worker, Cache Storage holds NO /api/ answer — so when the session merely
// expires (no logout) the next person on a shared phone cannot inherit them. Offline, the dashboard is read from the
// user's own IndexedDB copy, flagged cached. Skips ONLY when Playwright/Chromium are absent.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

let pw = null; try { pw = require('playwright'); } catch (_) { pw = null; }
const PUB = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const BOOT = { ok: true, user: { username: 'tech', name: 'Tech' }, sites: [{ id: 1, name: 'Hounde', inspection_code: 'HGO' }], actions: [], trackers: [], lookups: { areas: [], categories: [] }, features: { ticket: true }, limits: {} };
const DASH = { ok: true, widgets: { open: { title: 'Open actions', value: 7, as_of: '2026-11-01T00:00:00Z' } } };

function serve() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/field/bootstrap') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(BOOT)); }
    if (u.pathname === '/api/dashboards/field-site/data') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(DASH)); }
    if (u.pathname.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true,"items":[]}'); }
    const f = path.join(PUB, path.normalize(u.pathname).replace(/^([/\\])+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

test('service worker stores no /api/ answer; offline dashboard comes from the per-user copy', { skip: !pw && 'playwright not installed on this machine' }, async (t) => {
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { t.skip('chromium not available: ' + e.message.split('\n')[0]); return; }
  const srv = await serve();
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'allow' });
    await ctx.addInitScript(() => { localStorage.setItem('report_user', JSON.stringify({ username: 'tech' })); localStorage.setItem('field_lang', 'en'); });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const origin = 'http://127.0.0.1:' + srv.address().port;
    await page.goto(origin + '/field/index.html');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();                                                        // now controlled by the worker
    await page.waitForFunction(() => !!navigator.serviceWorker.controller && document.getElementById('site').options.length > 0);
    await page.click('nav.tabs button[data-view="dash"]');
    await page.waitForFunction(() => /Open actions/.test(document.getElementById('d-widgets').textContent));
    await page.waitForTimeout(300);                                             // let a (wrong) cache.put settle
    const cached = await page.evaluate(async () => { const out = []; for (const k of await caches.keys()) { const c = await caches.open(k); for (const r of await c.keys()) out.push(new URL(r.url).pathname); } return out; });
    assert.ok(cached.some((p) => p.startsWith('/field/')), 'the app shell is cached: ' + cached.join(','));
    assert.deepStrictEqual(cached.filter((p) => p.startsWith('/api/')), [], 'no /api/ answer in Cache Storage');
    // offline: the dashboard still shows this user's last answer, marked cached (from IndexedDB, not the worker)
    await ctx.setOffline(true);
    await page.click('nav.tabs button[data-view="home"]');
    await page.click('nav.tabs button[data-view="dash"]');
    await page.waitForFunction(() => /cached/.test(document.getElementById('d-widgets').textContent));
    assert.match(await page.textContent('#d-widgets'), /Open actions/);
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
