'use strict';
// T7 — any user switches the interface to French and opens the manual.
// Runs with the A-09a page dictionaries switched ON in this throwaway database (ui_i18n_pages='1';
// the shipped default stays '0'). Success = the page body and <html lang> follow, the manual opens in French.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');

runJourney('T7 switch to French and open the manual', async ({ app, world, browser, j, login }) => {
  await world.setConfig({ ui_i18n_pages: '1' });
  const ctx = await j.newContext(browser);
  const page = await ctx.newPage();
  await login(page, world.users.edA, '/site-actions.html?site=HGO');
  await page.waitForSelector('.shell-lang-btn');
  await j.measure(page, 'site-actions-en');
  await Promise.all([page.waitForEvent('load'), page.click('.shell-lang-btn')]);
  await page.waitForFunction(() => /Registre des actions du site/.test(document.querySelector('h1').textContent), null, { timeout: 15000 });
  assert.strictEqual(await page.getAttribute('html', 'lang'), 'fr', '<html lang> follows a translated body');
  assert.match(await page.textContent('.shell-lang-btn'), /EN/, 'the toggle now offers English');

  const help = page.locator('a[href="help.html"]').first();
  assert.match(await help.textContent(), /Aide/, 'shell link translated');
  // the manual opens in a new tab (target=_blank)
  const [manual] = await Promise.all([ctx.waitForEvent('page'), help.click()]);
  await manual.waitForLoadState('load');
  assert.match(manual.url(), /\/help\.html$/);
  await manual.waitForSelector('#sec-fr.active');
  assert.strictEqual(await manual.isVisible('#sec-en'), false, 'English manual hidden');
  assert.match(await manual.textContent('#sec-fr h2'), /Vue d'ensemble/);
  assert.strictEqual(await manual.getAttribute('html', 'lang'), 'fr');
  await j.measure(manual, 'help-fr');

  // F-UX-01 — a bilingual data-lng page (Home) announces French too, not only the dictionary pages.
  await page.goto(app.base + '/home.html');
  await page.waitForFunction(() => document.body.classList.contains('lang-fr'), null, { timeout: 15000 });
  assert.strictEqual(await page.getAttribute('html', 'lang'), 'fr', '<html lang> follows the French body on Home');
});
