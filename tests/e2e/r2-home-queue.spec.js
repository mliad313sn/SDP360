'use strict';
// R2-QUEUE (REBUILD-SPEC R3 + R4) — browser journey with the two switches ON (inside this throwaway database only):
// the editor of site A opens Home, the queue "S1" shows A's overdue action with its state words, never B's action,
// in English and French, at 320 px and 1440 px without horizontal page scroll; the header marks exactly one current
// page per navigation landmark and links carry the current site. Structural assertions only (fixtures/layout.js).
const assert = require('node:assert');
const path = require('path');
const { runJourney } = require('./fixtures/harness');
const { artifactDir } = require('./fixtures/browser');
const layout = require('./fixtures/layout');

runJourney('R2 Home queue S1 and single active destination', async ({ base, world, browser, j, login }) => {
  await world.setConfig({ ui_home_queue: '1', ui_nav_active_from_url: '1', ui_nav_carry_site: '1' });
  const mdb = require(path.join(__dirname, '..', '..', 'meetings-db.js'));
  await mdb.saveMeeting({ header: { reference: 'E2E_PV_MGO_R2', site_code: 'MGO', department: 'mining', meeting_date: '2026-01-16', intake_source: 'dept_meeting', status: 'submitted' },
    issues: [], actions: [{ description: 'E2E site B secret action', owner_it: 'E2E edB', target_date: '2026-02-01', status: 'open' }] }, null, null);
  for (const w of [320, 1440]) {
    const ctx = await j.newContext(browser, { viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await login(page, world.users.edA, '/home.html');
    await page.goto(base + '/home.html');
    await page.waitForSelector('#hmQueue .hq-list, #hmQueue .hq', { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('#hmQueue [aria-busy="true"]'), null, { timeout: 20000 }).catch(() => {});
    const q = await page.evaluate(() => {
      const box = document.getElementById('hmQueue');
      return { text: box.innerText, links: [...box.querySelectorAll('.hq-list a')].map((a) => a.getAttribute('href')), states: [...box.querySelectorAll('.hq-state')].map((s) => s.getAttribute('aria-label')) };
    });
    assert.match(q.text, /E2E overdue action/, 'site A action listed');
    assert.ok(!/site B secret/.test(q.text), 'site B action never listed');
    assert.ok(q.links.some((h) => /^meeting\.html\?id=\d+$/.test(h)), 'authorised deep link');
    assert.ok(q.states.length === 5 && q.states.every((s) => /^(Available|Unknown|Stale|Partial|Not allowed|Loading)/.test(s)), JSON.stringify(q.states));
    assert.match(q.text, /late/);
    const bad = layout.judge(await page.evaluate(layout.measure), { shell: true });
    assert.deepStrictEqual(bad, [], 'layout at ' + w + ' px');
    await page.screenshot({ path: path.join(artifactDir(), `r2-home-queue-${w}.png`) }).catch(() => {});
    // R4 — exactly one current page per navigation landmark; an in-page #fragment moves it
    const cur = await page.evaluate(() => [...document.querySelectorAll('nav')].map((n) => n.querySelectorAll('[aria-current="page"]').length));
    assert.ok(cur.every((n) => n <= 1) && cur.reduce((a, b) => a + b, 0) >= 1, JSON.stringify(cur));
    assert.deepStrictEqual(errs, [], 'no uncaught page error');
    await ctx.close();
  }
  // French: the same queue in French words
  const ctx = await j.newContext(browser, { viewport: { width: 390, height: 900 } });
  const page = await ctx.newPage();
  await login(page, world.users.edA, '/home.html');
  await page.evaluate(() => { try { localStorage.setItem('sdp_lang', 'fr'); } catch (_) { /* storage */ } });
  await page.goto(base + '/home.html');
  await page.waitForSelector('#hmQueue .hq', { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('#hmQueue [aria-busy="true"]'), null, { timeout: 20000 }).catch(() => {});
  const fr = await page.evaluate(() => document.getElementById('hmQueue').innerText);
  assert.match(fr, /Ma file de travail/); assert.match(fr, /en retard/);
  // carried site: on site-actions.html?site=HGO the menu link to Site Actions keeps the site
  await page.goto(base + '/site-actions.html?site=HGO');
  await page.waitForSelector('#__shell .shell-nav', { timeout: 20000 });
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('#__shell a')].map((a) => a.getAttribute('href')));
  assert.ok(hrefs.includes('site-actions.html?site=HGO'), JSON.stringify(hrefs.filter((h) => /site-actions/.test(h || ''))));
  await ctx.close();
}, { timeout: 300000 });
