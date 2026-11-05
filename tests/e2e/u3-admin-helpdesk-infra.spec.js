'use strict';
// D-10 (AMDEC AM-14 prep, agent-run, NOT user acceptance) — a Group IT admin (site-less `admin`) sees the helpdesk
// backlog and SLA across sites, then opens infrastructure and WAN health. Fictitious tickets (fixtures/tickets.js).
const assert = require('node:assert');
const crypto = require('crypto');
const { runJourney } = require('./fixtures/harness');
const { seedHelpdeskWeek } = require('./fixtures/tickets');

runJourney('U3 admin reads the helpdesk backlog and SLA across sites, then infrastructure and WAN health', async ({ app, base, browser, j, login }) => {
  const { rdb } = app;
  const sample = await seedHelpdeskWeek(rdb);
  const u = { username: 'e2e_admin', password: 'E2e!' + crypto.randomBytes(9).toString('hex') };
  await rdb.createUser({ username: u.username, full_name: 'E2E Group IT admin', password: u.password, roles: ['admin'], site_id: null });
  const page = await (await j.newContext(browser, { viewport: { width: 1440, height: 900 } })).newPage();
  await login(page, u, '/index.html');
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => !/Loading/.test(document.getElementById('slaRankBody').textContent), null, { timeout: 30000 });
  assert.strictEqual((await page.textContent('#k-inbound')).trim(), String(sample.total), 'inbound tickets of the week, all sites');
  const first = (await page.$$eval('#slaRankBody tr:first-child td', (tds) => tds.map((t) => t.textContent.trim()))).join(' | ');
  assert.match(first, /HOUNDE/i, 'worst resolution SLA first: Houndé (6 of 12 late) before MANA (1 of 12)');
  assert.match(await page.textContent('#slaRankBody'), /MANA/i, 'both sites ranked: the admin sees across sites');
  await j.measure(page, 'index');
  for (const p of ['infra-health', 'wan']) {
    await page.goto(base + '/' + p + '.html');
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    assert.strictEqual(new URL(page.url()).pathname, '/' + p + '.html', p + ' is not redirected for an admin');
    await j.measure(page, p);
  }
  assert.strictEqual(await page.evaluate(async () => (await fetch('/api/analytics/wan/summary', { credentials: 'same-origin' })).status), 200);
  assert.deepStrictEqual(j.rec.page_errors, [], 'no page error on the admin pages');
});
