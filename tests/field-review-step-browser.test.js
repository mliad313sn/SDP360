'use strict';
// E-F03 — browser proof (real Chromium) of the two shadow switches of the field app:
//   * both OFF (today): no review dialog, the PUT body has exactly today's keys (no meta), nothing timed;
//   * field_review_step ON: a one-screen summary (site, items, findings, photos, offline note) with "Corriger" /
//     "Mettre en file" — Corriger queues nothing;
//   * field_task_timing ON: the envelope carries meta.task_ms (active time, a number).
// Skips ONLY when Playwright/Chromium are absent.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

let pw = null; try { pw = require('playwright'); } catch (_) { pw = null; }
const PUB = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const boot = (features) => ({ ok: true, user: { username: 'tech', name: 'Tech' }, sites: [{ id: 1, name: 'Hounde', inspection_code: 'HGO' }], actions: [], trackers: [],
  lookups: { areas: [{ code: 'dc', name_en: 'Data centre' }], categories: [{ id: 'net', name_en: 'Network', items: [{ l: 'Switch' }, { l: 'Cabling' }] }] }, features, limits: {} });

function serve(features) {
  const puts = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/field/bootstrap') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(boot(features))); }
    if (req.method === 'PUT' && u.pathname.startsWith('/api/field/outbox/')) {
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { puts.push(JSON.parse(b)); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true,"status":"applied","duplicate":false}'); });
      return;
    }
    if (u.pathname.startsWith('/api/')) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"ok":false,"error":"down"}'); }
    const f = path.join(PUB, path.normalize(u.pathname).replace(/^([/\\])+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, puts })));
}

async function open(browser, features) {
  const { srv, puts } = await serve(features);
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.addInitScript(() => { localStorage.setItem('report_user', JSON.stringify({ username: 'tech' })); });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/field/index.html');
  await page.waitForFunction(() => document.getElementById('site').options.length > 0);
  await page.click('nav.tabs button[data-view="inspect"]');
  await page.waitForSelector('#i-items button[data-ix]');
  await page.locator('#i-items button[data-st="major"]').first().click();
  await page.fill('#i-notes', 'E-F03 check');
  return { srv, puts, ctx, page, errors };
}
const waitPut = (puts, n) => new Promise((r, j) => { const t0 = Date.now(); (function poll() { if (puts.length >= n) return r(); if (Date.now() - t0 > 10000) return j(new Error('no PUT')); setTimeout(poll, 100); })(); });

test('switches OFF: no review dialog, envelope keys unchanged, no task time', { skip: !pw && 'playwright not installed on this machine' }, async (t) => {
  let browser; try { browser = await pw.chromium.launch(); } catch (e) { t.skip('chromium not available: ' + e.message.split('\n')[0]); return; }
  const o = await open(browser, { ticket: false });
  try {
    await o.page.click('#i-save');
    await waitPut(o.puts, 1);
    assert.strictEqual(await o.page.$('#review'), null, 'no review dialog is created');
    assert.deepStrictEqual(Object.keys(o.puts[0]).sort(), ['author', 'client_ts', 'device', 'kind', 'payload'], 'today\'s envelope, no meta');
    assert.strictEqual(o.puts[0].payload.meta.f_obs, 'E-F03 check');
    assert.deepStrictEqual(o.errors, []);
  } finally { await browser.close(); o.srv.close(); }
});

test('field_review_step ON: summary shown in French; Corriger queues nothing, Mettre en file queues', { skip: !pw && 'playwright not installed on this machine' }, async (t) => {
  let browser; try { browser = await pw.chromium.launch(); } catch (e) { t.skip('chromium not available: ' + e.message.split('\n')[0]); return; }
  const o = await open(browser, { ticket: false, review_step: true });
  try {
    await o.ctx.setOffline(true);
    await o.page.click('#i-save');
    await o.page.waitForSelector('#review[open]');
    const txt = await o.page.textContent('#review');
    assert.match(txt, /Vérifier avant la mise en file/); assert.match(txt, /Hounde/); assert.match(txt, /Points traités : 1/); assert.match(txt, /majeur 1/);
    assert.match(txt, /Photos : 0 \(0 KB\)/); assert.match(txt, /Hors ligne/);
    await o.page.click('#review-fix');
    await o.page.waitForFunction(() => !document.getElementById('review').open);
    assert.strictEqual(await o.page.textContent('#queue'), '0', 'Corriger queues nothing');
    assert.strictEqual(await o.page.inputValue('#i-notes'), 'E-F03 check', 'the form keeps its values');
    await o.page.click('#i-save');
    await o.page.waitForSelector('#review[open]');
    await o.page.click('#review-ok');
    await o.page.waitForFunction(() => document.getElementById('queue').textContent === '1');
    await o.ctx.setOffline(false);
    await waitPut(o.puts, 1);
    assert.ok(!('meta' in o.puts[0]), 'timing still off');
    assert.deepStrictEqual(o.errors, []);
  } finally { await browser.close(); o.srv.close(); }
});

test('field_task_timing ON: the envelope carries meta.task_ms (active time in ms)', { skip: !pw && 'playwright not installed on this machine' }, async (t) => {
  let browser; try { browser = await pw.chromium.launch(); } catch (e) { t.skip('chromium not available: ' + e.message.split('\n')[0]); return; }
  const o = await open(browser, { ticket: false, task_timing: true });
  try {
    await o.page.waitForTimeout(300);
    await o.page.fill('#i-notes', 'E-F03 timed');
    await o.page.click('#i-save');
    await waitPut(o.puts, 1);
    const m = o.puts[0].meta;
    assert.ok(m && Number.isInteger(m.task_ms) && m.task_ms >= 200 && m.task_ms < 60000, 'task_ms measured: ' + JSON.stringify(m));
    assert.deepStrictEqual(Object.keys(m), ['task_ms'], 'only the time, no name');
    assert.deepStrictEqual(o.errors, []);
  } finally { await browser.close(); o.srv.close(); }
});
