'use strict';
// AMDEC 2026-11-05 (agent-run scenario, not user acceptance) — a coordinator holding TWO sites in two
// countries (Houndé BF primary + Sabodala SN extra) works in French: the report list shows exactly those two
// sites, never MANA, and the page switches to French (ui_i18n_pages='1' in this throwaway database only).
const assert = require('node:assert');
const crypto = require('crypto');
const { runJourney } = require('./fixtures/harness');

runJourney('U1 multi-site coordinator sees only their sites, in French', async ({ app, world, browser, j, login }) => {
  const { rdb } = app;
  await world.setConfig({ ui_i18n_pages: '1' });
  const sites = await rdb.listSites({ includeInactive: true });
  const sgo = sites.find((s) => s.name === 'Sabodala');
  const wk = await rdb.getPreviousWeek();
  await rdb.ensureReport(sgo.id, wk.year, wk.week);
  const u = { username: 'e2e_ms2', password: 'E2e!' + crypto.randomBytes(9).toString('hex') };
  await rdb.createUser({ username: u.username, full_name: 'E2E multi-site', password: u.password, roles: ['editor'], site_id: world.siteA.id, extra_site_ids: [sgo.id] });

  const ctx = await j.newContext(browser);
  const page = await ctx.newPage();
  await login(page, u, '/reports.html');
  await page.waitForSelector('#report-list-grid .report-card', { timeout: 20000 });
  const names = [...new Set(await page.$$eval('#report-list-grid .rc-site', (els) => els.map((e) => e.textContent.trim())))].sort();
  assert.deepStrictEqual(names, ['Hounde', 'Sabodala'], 'exactly the two sites of the account: ' + names.join(','));
  await j.measure(page, 'reports-list-en');
  await Promise.all([page.waitForEvent('load'), page.click('.shell-lang-btn')]);
  await page.waitForFunction(() => document.documentElement.lang === 'fr', null, { timeout: 15000 });
  await page.waitForFunction(() => /Rapports de site/.test(document.body.textContent), null, { timeout: 15000 });
  await page.waitForSelector('#report-list-grid .report-card', { timeout: 20000 });
  const fr = [...new Set(await page.$$eval('#report-list-grid .rc-site', (els) => els.map((e) => e.textContent.trim())))].sort();
  assert.deepStrictEqual(fr, ['Hounde', 'Sabodala'], 'site names are data, never translated');
  await j.measure(page, 'reports-list-fr');
});
