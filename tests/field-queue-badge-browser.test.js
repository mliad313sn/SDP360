'use strict';
// UAT-OI-04 (G3-UX) — the f1-field-network journey failed 1 run in 4: "(c) inspection stored once 0 !== 1". Cause: the
// pending badge (#queue) was hard-coded "0" in field/index.html until the outbox was READ; a page ready before that
// read showed "nothing waiting" while an entry was queued, and the journey's sync loop stopped on it. Reproduced by
// delaying the outbox read (below); the badge now reads "…" until the read, then the real count.
// Skips ONLY when Playwright/Chromium are absent.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

let pw = null; try { pw = require('playwright'); } catch (_) { pw = null; }
const PUB = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const BOOT = { ok: true, user: { username: 'tech', name: 'Tech' }, sites: [{ id: 1, name: 'Hounde', inspection_code: 'HGO' }], actions: [], trackers: [], lookups: { areas: [], categories: [] }, features: {}, limits: {} };

function serve() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/field/bootstrap') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(BOOT)); }
    if (u.pathname.startsWith('/api/')) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"ok":false,"offline":true,"error":"down"}'); }
    const f = path.join(PUB, path.normalize(u.pathname).replace(/^([/\\])+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

test('the pending badge never says 0 before the outbox is read (queued entry, slow outbox read)', { skip: !pw && 'playwright not installed on this machine' }, async (t) => {
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { t.skip('chromium not available: ' + e.message.split('\n')[0]); return; }
  const srv = await serve();
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      localStorage.setItem('report_user', JSON.stringify({ username: 'tech' }));
      localStorage.setItem('field_lang', 'en');
      // one entry already queued on this phone (as after a session expiry), and every outbox READ delayed 1.5 s
      const open = indexedDB.open('field', 1);
      open.onupgradeneeded = () => { const d = open.result; d.createObjectStore('outbox', { keyPath: 'uuid' }); d.createObjectStore('kv'); };
      open.onsuccess = () => { const d = open.result; const tx = d.transaction('outbox', 'readwrite'); tx.objectStore('outbox').put({ uuid: 'u-1', kind: 'inspection', user: 'tech', state: 'pending', client_ts: '2026-11-12T08:00:00Z', label: 'Inspection X', payload: {} }); tx.oncomplete = () => d.close(); };
      const desc = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
      Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { configurable: true, get() { return desc.get.call(this); },
        set(fn) { const slow = this.mode === 'readonly' && [...this.objectStoreNames].includes('outbox') && !window.__seeding; desc.set.call(this, slow ? function (ev) { setTimeout(() => fn.call(this, ev), 1500); } : fn); } });
    });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:' + srv.address().port + '/field/index.html');
    await page.waitForFunction(() => document.getElementById('site').options.length > 0);
    const early = await page.textContent('#queue');
    assert.notStrictEqual(early, '0', 'before the read the badge must not claim an empty outbox');
    await page.waitForFunction(() => document.getElementById('queue').textContent === '1', null, { timeout: 10000 });
    await ctx.close();
  } finally { srv.close(); await browser.close(); }
});
