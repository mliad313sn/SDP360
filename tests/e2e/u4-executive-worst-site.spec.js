'use strict';
// D-10 (AMDEC AM-14 prep, agent-run, NOT user acceptance) — a Group executive tells which site is worst this week
// and why: the scorecard opens, then the Helpdesk ranking puts Houndé first with its missed-SLA count, and a
// published dashboard renders for the executive. Fictitious tickets (fixtures/tickets.js).
const assert = require('node:assert');
const crypto = require('crypto');
const { runJourney } = require('./fixtures/harness');
const { seedHelpdeskWeek } = require('./fixtures/tickets');

runJourney('U4 executive finds the worst site of the week and why (missed resolution SLA)', async ({ app, base, world, browser, j, login }) => {
  const { rdb } = app;
  await seedHelpdeskWeek(rdb);
  const u = { username: 'e2e_exec4', password: 'E2e!' + crypto.randomBytes(9).toString('hex') };
  await rdb.createUser({ username: u.username, full_name: 'E2E executive', password: u.password, roles: ['executive'], site_id: null });
  const page = await (await j.newContext(browser, { viewport: { width: 1440, height: 900 } })).newPage();
  await login(page, u, '/executive.html');
  await page.goto(base + '/executive.html');   // the sign-in lands on the role's home; open the scorecard explicitly
  await page.waitForFunction(() => /IT Executive Scorecard/.test(document.title), null, { timeout: 20000 });
  await j.measure(page, 'executive');
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => !/Loading/.test(document.getElementById('slaRankBody').textContent), null, { timeout: 30000 });
  const first = (await page.$$eval('#slaRankBody tr:first-child td', (tds) => tds.map((t) => t.textContent.trim()))).join(' | ');
  assert.match(first, /HOUNDE/i, 'Houndé is the worst site');
  assert.match(first, /\| 6 \|/, 'and why: 6 tickets missed their resolution SLA');
  await j.measure(page, 'index');
  const dash = ((await world.call('GET', '/api/dashboards', world.users.sa.token)).j.dashboards || []).find((d) => d.status === 'published');
  assert.ok(dash, 'a published dashboard exists after seedStores');
  await page.goto(base + '/dashboards.html?key=' + encodeURIComponent(dash.key));
  await page.waitForFunction(() => document.getElementById('site').options.length >= 2, null, { timeout: 20000 });
  await j.measure(page, 'dashboards');
  assert.deepStrictEqual(j.rec.page_errors, [], 'no page error on the executive pages');
});
