'use strict';
// T8 — using only the keyboard, reach "Portfolio" from any page (no mouse event is ever sent).
// Path: Tab → the skip link is the first stop (A-12a); Ctrl+K opens the finder, type, Enter.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');

runJourney('T8 reach Portfolio by keyboard', async ({ base, world, browser, j }) => {
  const ctx = await j.newContext(browser);
  const page = await ctx.newPage();
  // keyboard-only sign-in as well
  await page.goto(base + '/login.html?next=' + encodeURIComponent('/site-actions.html?site=HGO'));
  await page.focus('#username');
  await page.keyboard.type(world.users.edA.username);
  await page.keyboard.press('Tab');
  await page.keyboard.type(world.users.edA.password);
  await Promise.all([page.waitForURL(/site-actions\.html/), page.keyboard.press('Enter')]);
  await page.waitForSelector('.shell-search-btn');
  await j.measure(page, 'site-actions');

  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => ({ cls: document.activeElement.className, text: document.activeElement.textContent }));
  assert.match(first.cls, /skip/, 'first Tab stop is the skip link: ' + JSON.stringify(first));

  await page.keyboard.press('Control+k');
  await page.waitForSelector('#shell-search-q:focus');
  await page.keyboard.type('Portfolio');
  await Promise.all([page.waitForURL(/\/portfolio\.html/), page.keyboard.press('Enter')]);
  await page.waitForLoadState('load');
  await j.measure(page, 'portfolio');
  assert.match(await page.title(), /Portfolio/i);
});
