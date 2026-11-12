'use strict';
// C2 (E-Q09, agent committee — automated, synthetic org, NOT user acceptance) — a Group IT manager (admin tier)
// finds the worst site on the Helpdesk resolution-SLA ranking (Houndé, fictitious tickets), goes to that site's
// action register, filters the overdue actions, picks the seeded overdue one and moves it to "in progress": the
// status is stored with the manager as author and is what the register shows after a reload.
// Finding recorded (not fixed here): the ranking row carries no link to the site's action register — the manager
// navigates by the site code (site-actions.html?site=HGO).
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');
const { seedHelpdeskWeek } = require('./fixtures/tickets');
const { person, api } = require('./fixtures/iam');

runJourney('C2 Group IT manager goes from the worst-gap ranking to the site overdue action and updates it', async ({ app, base, world, browser, j, login }) => {
  await seedHelpdeskWeek(app.rdb);
  const mgr = await person(app, 'c2groupit', ['admin'], null);
  const page = await (await j.newContext(browser, { viewport: { width: 1440, height: 900 } })).newPage();
  await login(page, mgr, '/index.html');
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => !/Loading/.test(document.getElementById('slaRankBody').textContent), null, { timeout: 30000 });
  const first = (await page.$$eval('#slaRankBody tr:first-child td', (tds) => tds.map((t) => t.textContent.trim()))).join(' | ');
  assert.match(first, /HOUNDE/i, 'the worst gap is Houndé');
  const links = await page.$$eval('#slaRankBody tr:first-child a[href*="site-actions"]', (a) => a.length);
  assert.equal(links, 0, 'recorded finding: no link from the ranking to the action register (update this when one is added)');
  await j.measure(page, 'index');

  await page.goto(base + '/site-actions.html?site=HGO');
  const target = 'replace the core switch PSU';
  await page.waitForSelector('.sa-row strong:has-text("' + target + '")', { timeout: 15000 });
  await page.check('#saOverdue');
  const row = page.locator('.sa-row', { hasText: target });
  await assert.doesNotReject(row.locator('.sa-overdue-tag').waitFor(), 'the action is flagged overdue');
  await row.locator('select.sa-status-sel').selectOption('in_progress');
  await page.waitForSelector('#saToast.show', { timeout: 10000 });
  await j.measure(page, 'site-actions');

  const stored = await api(page, 'GET', '/api/meetings/' + world.meetingId);
  const act = stored.body.actions.find((a) => a.id === world.action.id);
  assert.equal(act.status, 'in_progress', 'status stored');
  const hist = await require('../../meetings-db').listActionUpdates(world.action.id);
  assert.ok(hist.some((u) => u.status_change === 'in_progress' && /c2groupit/.test(String(u.author_name))), 'the manager is the author in the audit trail');

  await page.reload();
  await page.waitForSelector('.sa-row strong:has-text("' + target + '")', { timeout: 15000 });
  const shown = await page.locator('.sa-row', { hasText: target }).locator('select.sa-status-sel').inputValue();
  assert.equal(shown, 'in_progress', 'the register shows the new status after a reload');
  assert.deepStrictEqual(j.rec.page_errors, [], 'no page error');
});
