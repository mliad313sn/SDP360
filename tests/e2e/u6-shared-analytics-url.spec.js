'use strict';
// E-U02 — a shared Analytics URL reproduces the same filters (report_config ui_url_filters='1' in this
// throwaway database; the shipped default stays '0'). Foreign / hostile values in the URL are ignored,
// a filter change is written back with replaceState, Back from another page restores the filters, and
// Reset clears them from the URL.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');

runJourney('U6 shared analytics URL restores the filters', async ({ base, world, browser, j, login }) => {
  await world.setConfig({ ui_url_filters: '1' });
  const ctx = await j.newContext(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page, world.users.sa, '/home.html');
  // auth.js caches the UI policy from /auth/me — wait until the switch is visible to the browser.
  await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('sdp_ui_policy')).url_filters === '1'; } catch (_) { return false; } }, null, { timeout: 15000 });

  const seen = [];
  page.on('request', (r) => { if (/\/api\/metrics\/requests\?/.test(r.url())) seen.push(r.url()); });
  await page.goto(base + '/analytics.html?site=MANA&period=30d&evil=%3Cimg%20src%3Dx%3E&status=%3Cb%3Ex');
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  assert.strictEqual(await page.inputValue('#fSite'), 'MANA', 'site restored from the shared URL');
  assert.strictEqual(await page.inputValue('#fPeriod'), '30d', 'period restored from the shared URL');
  assert.ok(seen.some((u) => /[?&]site=MANA/.test(u)), 'the data request carries the shared site');
  assert.strictEqual(await page.isVisible('#urlfReset'), true, 'Reset offered when the switch is on');
  assert.strictEqual(await page.$('img[src="x"]'), null, 'hostile URL value never rendered');
  const url1 = new URL(page.url());
  assert.strictEqual(url1.searchParams.get('evil'), '<img src=x>', 'foreign key preserved untouched (never interpreted)');

  await page.selectOption('#fPeriod', '7d');
  await page.waitForFunction(() => /period=7d/.test(location.search), null, { timeout: 10000 });
  assert.match(page.url(), /site=MANA/);

  // Back from another page lands on the same filters.
  await page.goto(base + '/home.html');
  await page.goBack();
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  assert.strictEqual(await page.inputValue('#fPeriod'), '7d', 'Back restores the period');
  assert.strictEqual(await page.inputValue('#fSite'), 'MANA', 'Back restores the site');

  await page.click('#urlfReset');
  await page.waitForFunction(() => !/site=|period=/.test(location.search), null, { timeout: 10000 });
  assert.strictEqual(await page.inputValue('#fSite'), '', 'Reset clears the site');
  await j.measure(page, 'analytics-url-filters');
});
