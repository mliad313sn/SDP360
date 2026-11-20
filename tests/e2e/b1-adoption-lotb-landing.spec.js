'use strict';
// Adoption Lot B — browser journey (throwaway database only). Switches OFF: the committee member lands on the
// Helpdesk as today. Switches ON (ui_role_landing_profiles, ui_home_group_variant, ui_home_freshness_strip,
// ui_helpdesk_site_default): the committee member lands on the portfolio; Home for a person with no site shows the
// group card (no link to a page the role cannot open; unknown = "not measured", never 0); the super_admin also sees
// the worst-sites line and the data-source freshness strip ("never synced" — nothing is synced in the e2e world);
// the site editor's Helpdesk opens without a page error. Structural assertions only.
const assert = require('node:assert');
const path = require('path');
const { runJourney } = require('./fixtures/harness');
const { artifactDir } = require('./fixtures/browser');
const layout = require('./fixtures/layout');

runJourney('B1 Adoption Lot B — each profile lands on its job', async ({ base, world, browser, j, login }) => {
  // switches off: today's landing
  {
    const ctx = await j.newContext(browser, { viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    await login(page, world.users.groupit);
    assert.match(new URL(page.url()).pathname, /\/index\.html$|\/$/, 'off: committee lands on the Helpdesk (today)');
    await ctx.close();
  }
  await world.setConfig({ ui_role_landing_profiles: '1', ui_home_group_variant: '1', ui_home_freshness_strip: '1', ui_helpdesk_site_default: '1' });

  // committee member: lands on the portfolio; Home shows the group card without the worst-sites line
  for (const w of [390, 1366]) {
    const ctx = await j.newContext(browser, { viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await login(page, world.users.groupit);
    await page.waitForURL((u) => /\/portfolio\.html$/.test(u.pathname), { timeout: 15000 });
    await page.goto(base + '/home.html');
    await page.waitForSelector('#hmGroup', { timeout: 20000 });
    const g = await page.evaluate(() => ({ text: document.getElementById('hmGroup').innerText, links: [...document.querySelectorAll('#hmGroup a')].map((a) => a.getAttribute('href')), fresh: !!document.getElementById('hmFresh'), msg: document.getElementById('hmMsg').innerText }));
    assert.deepStrictEqual(g.links.sort(), ['cockpit.html', 'portfolio.html'], 'no link to a page the committee cannot open');
    assert.ok(!g.fresh, 'freshness strip is admin tier only');
    assert.ok(!/no site|aucun site/i.test(g.msg), 'the group card replaces the "no site" message');
    const bad = layout.judge(await page.evaluate(layout.measure), { shell: true });
    assert.deepStrictEqual(bad, [], 'layout at ' + w + ' px');
    await page.screenshot({ path: path.join(artifactDir(), `b1-home-group-committee-${w}.png`) }).catch(() => {});
    assert.deepStrictEqual(errs, [], 'no uncaught page error');
    await ctx.close();
  }

  // super_admin (no site): group card with the worst-sites line + freshness strip, in French
  {
    const ctx = await j.newContext(browser, { viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await login(page, world.users.sa, '/home.html');
    await page.evaluate(() => { try { localStorage.setItem('sdp_lang', 'fr'); } catch (_) { /* storage */ } });
    await page.goto(base + '/home.html');
    await page.waitForSelector('#hmGroup', { timeout: 20000 });
    await page.waitForSelector('#hmFresh', { timeout: 20000 });
    const s = await page.evaluate(() => ({ group: document.getElementById('hmGroup').innerText, links: [...document.querySelectorAll('#hmGroup a')].map((a) => a.getAttribute('href')), fresh: document.getElementById('hmFresh').innerText }));
    assert.ok(s.links.includes('site-awareness.html'), 'worst-sites line for the executive tier');
    assert.match(s.group, /Sites à surveiller/);
    assert.match(s.fresh, /jamais synchronisé/, 'never-synced source said in words');
    await page.screenshot({ path: path.join(artifactDir(), 'b1-home-group-superadmin-fr.png') }).catch(() => {});
    assert.deepStrictEqual(errs, [], 'no uncaught page error');
    await ctx.close();
  }

  // site editor: Helpdesk opens (the preset applies only when the ticket data names the site)
  {
    const ctx = await j.newContext(browser, { viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await login(page, world.users.edA, '/index.html');
    await page.goto(base + '/index.html');
    await page.waitForSelector('#fSite', { timeout: 20000 });
    assert.strictEqual(await page.evaluate(() => typeof window.HelpdeskSiteDefault), 'object');
    assert.deepStrictEqual(errs, [], 'no uncaught page error');
    await ctx.close();
  }
}, { timeout: 300000 });
