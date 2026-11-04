'use strict';
// B-06 — browser proof (real Chromium, real IndexedDB): with a stubbed quota error on the outbox write, the
// technician is told the entry was NOT saved, the form keeps its values, earlier entries and the pending
// badge stay, and persistent storage is requested once. Skips ONLY when Playwright/Chromium are absent.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

let pw = null; try { pw = require('playwright'); } catch (_) { pw = null; }
const PUB = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const BOOT = { ok: true, user: { username: 'tech', name: 'Tech' }, sites: [{ id: 1, name: 'Hounde', inspection_code: 'HGO' }], actions: [], trackers: [], lookups: { areas: [], categories: [] }, features: { ticket: true }, limits: {} };

function serve() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/field/bootstrap') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(BOOT)); }
    if (u.pathname.startsWith('/api/')) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"ok":false,"error":"down"}'); }
    const f = path.join(PUB, path.normalize(u.pathname).replace(/^([/\\])+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

let chromiumOk = !!pw;
test('quota error on queue → "NOT saved" shown, prior entry + badge kept, persist asked once, usage warning', { skip: !pw && 'playwright not installed on this machine' }, async (t) => {
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { chromiumOk = false; t.skip('chromium not available: ' + e.message.split('\n')[0]); return; }
  const srv = await serve();
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      localStorage.setItem('report_user', JSON.stringify({ username: 'tech' }));
      localStorage.setItem('field_lang', 'en');
      window.__persistCalls = 0; window.__quota = false;
      const st = navigator.storage;
      st.persisted = () => Promise.resolve(false);
      st.persist = () => { window.__persistCalls++; return Promise.resolve(true); };
      st.estimate = () => Promise.resolve({ usage: 80 * 1048576, quota: 100 * 1048576 });
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () {
        if (window.__quota && this.name === 'outbox') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return put.apply(this, arguments);
      };
    });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const port = srv.address().port;
    await page.goto('http://127.0.0.1:' + port + '/field/index.html');
    await page.waitForFunction(() => document.getElementById('site').options.length > 0);
    // B-05 — fresh phone (nothing stored yet): the only site is SELECTED and low-bandwidth mode is OFF
    // (a missing IndexedDB key used to come back as the IDBRequest object, truthy).
    assert.strictEqual(await page.inputValue('#site'), '1', 'the single site is selected on first use');
    assert.strictEqual(await page.isChecked('#lowbw'), false, 'low-bandwidth mode is off on first use');
    await ctx.setOffline(true);
    await page.click('nav.tabs button[data-view="actions"]');

    await page.fill('#k-subject', 'first entry'); await page.click('#k-send');
    await page.waitForFunction(() => document.getElementById('queue').textContent === '1');
    await page.waitForFunction(() => !document.getElementById('storage-warn').classList.contains('hidden'));
    assert.match(await page.textContent('#storage-warn'), /80 %/);

    await page.evaluate(() => { window.__quota = true; });
    await page.fill('#k-subject', 'second entry'); await page.click('#k-send');
    await page.waitForFunction(() => /NOT saved/.test(document.getElementById('msg').textContent));
    const m = await page.textContent('#msg');
    assert.match(m, /out of storage space/); assert.match(m, /second entry/);
    assert.match(await page.getAttribute('#msg', 'class'), /err/);
    assert.strictEqual(await page.inputValue('#k-subject'), 'second entry', 'the form keeps what was typed');
    assert.strictEqual(await page.textContent('#queue'), '1', 'pending badge still counts the earlier entry');
    assert.match(await page.textContent('#outbox-list'), /first entry/);
    assert.doesNotMatch(await page.textContent('#outbox-list'), /second entry/);
    assert.strictEqual(await page.evaluate(() => window.__persistCalls), 1, 'persistent storage requested once');
    assert.strictEqual(await page.isDisabled('#k-send'), false, 'button usable again');

    // offline reload: the badge is rendered from the phone's outbox even though the network is gone
    await ctx.setOffline(false); await page.evaluate(() => { window.__quota = false; });
    await ctx.route('**/api/**', (r) => r.abort());
    await page.reload();
    await page.waitForFunction(() => document.getElementById('queue').textContent === '1');
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
