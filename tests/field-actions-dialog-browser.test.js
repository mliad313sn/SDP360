'use strict';
// P11 round 2 (UX/field) — browser proof on the real field app (Chromium, no service worker):
//  F-5: an INSPECTION action offers Close + Cancel only (no → Ticket / → Demand), and its Cancel queues 'Cancelled'
//       (the inspection vocabulary); a meeting action keeps its transfer buttons.
//  F-7: the justification dialog's Cancel closes it while the required comment is still empty.
//  F-4: a 409 refusal is shown in French (from the server's `reason`, not its English text).
// Skips ONLY when Playwright/Chromium are absent.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

let pw = null; try { pw = require('playwright'); } catch (_) { pw = null; }
const PUB = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const BOOT = { ok: true, user: { username: 'tech', name: 'Tech' }, sites: [{ id: 1, name: 'Hounde', inspection_code: 'HGO' }], trackers: [], lookups: { areas: [], categories: [] }, features: {}, limits: {},
  actions: [{ source: 'inspection', id: 11, site: 'HGO', description: 'Insp action', status: 'Open', due_date: '2026-01-10' },
    { source: 'meetings', id: 22, site: 'HGO', description: 'Meeting action', status: 'open', due_date: '2026-01-10' }] };

function serve(puts) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/field/bootstrap') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(BOOT)); }
    if (req.method === 'PUT' && u.pathname.startsWith('/api/field/outbox/')) {
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
        puts.push(JSON.parse(b));
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, status: 'rejected', result: { error: 'this action was changed on the server since it was queued (now In Progress)', conflict: true, reason: 'action_changed', detail: { now: 'In Progress' } } }));
      }); return;
    }
    if (u.pathname.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true,"items":[]}'); }
    if (u.pathname === '/field/sw.js') { res.writeHead(404); return res.end(); }
    const f = path.join(PUB, path.normalize(u.pathname).replace(/^([/\\])+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

test('inspection action buttons, dialog Cancel with an empty comment, French refusal', { skip: !pw && 'playwright not installed on this machine' }, async (t) => {
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { t.skip('chromium not available: ' + e.message.split('\n')[0]); return; }
  const puts = [];
  const srv = await serve(puts);
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript(() => { localStorage.setItem('report_user', JSON.stringify({ username: 'tech' })); localStorage.setItem('field_lang', 'fr'); });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + srv.address().port + '/field/index.html');
    await page.waitForFunction(() => document.getElementById('site').options.length > 0);
    await page.click('nav.tabs button[data-view="actions"]');
    await page.waitForFunction(() => document.querySelectorAll('#a-list .item').length === 2);
    const rows = await page.$$eval('#a-list .item', (els) => els.map((e) => [...e.querySelectorAll('button')].map((b) => b.dataset.st)));
    assert.deepStrictEqual(rows[0], ['Closed', 'Cancelled'], 'inspection action: Close + Cancel only');
    assert.deepStrictEqual(rows[1], ['resolved', 'helpdesk_ticket', 'demand', 'cancelled'], 'meeting action keeps the transfer buttons');
    // F-7 — Cancel with an empty required comment closes the dialog, nothing queued
    await page.click('#a-list .item:first-child button[data-st="Cancelled"]');
    await page.waitForFunction(() => document.getElementById('dlg').open);
    await page.click('#dlg button[value="cancel"]');
    await page.waitForFunction(() => !document.getElementById('dlg').open, null, { timeout: 2000 });
    assert.strictEqual(puts.length, 0);
    // a confirmed Cancel queues the inspection vocabulary; the 409 is shown in French
    await page.click('#a-list .item:first-child button[data-st="Cancelled"]');
    await page.fill('#dlg-note', 'plus nécessaire');
    await page.click('#dlg button[value="ok"]');
    await page.waitForFunction(() => /modifiée sur le serveur/.test(document.getElementById('outbox-list').textContent), null, { timeout: 5000 });
    assert.strictEqual(puts[0].payload.status_change, 'Cancelled');
    assert.doesNotMatch(await page.textContent('#outbox-list'), /changed on the server/);
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
