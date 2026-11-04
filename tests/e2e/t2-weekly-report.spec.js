'use strict';
// T2 — a site editor opens last week's report, looks at the helpdesk section and submits it.
// Success = status 'submitted' stored, the page says so and the audit log records the submission.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');

runJourney('T2 open and submit last week weekly report', async ({ world, browser, j, login }) => {
  const ctx = await j.newContext(browser);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());   // the "Parc informatique not filled — submit anyway?" confirm, when it applies
  await login(page, world.users.edA, '/reports.html');
  const card = page.locator('.report-card', { hasText: 'Hounde' }).first();
  await card.waitFor();
  await j.measure(page, 'reports-list');
  await card.click();
  await page.waitForSelector('#page-form.active');

  await page.click('#stab-1');
  await page.waitForSelector('#section-1:visible');
  await page.waitForFunction(() => {
    const auto = document.getElementById('hd-auto-bar');
    const st = document.getElementById('hd-fetch-status');
    return auto && getComputedStyle(auto).display !== 'none' && st && !/Loading/.test(st.textContent);
  }, null, { timeout: 20000 });
  assert.match(await page.textContent('#hd-auto-group-label'), /Hounde IT Agents/, 'helpdesk section scoped to the site group');

  await page.click('#btn-submit');
  await page.waitForFunction(() => /Submitted/.test(document.getElementById('report-status-label').textContent), null, { timeout: 20000 });
  assert.strictEqual(await page.isVisible('#btn-submit'), false, 'submit button gone once submitted');

  const r = await world.call('GET', '/api/reports/' + world.reportA, world.users.edA.token);
  assert.strictEqual(r.j.status, 'submitted');
  const audit = await world.call('GET', '/api/reports/' + world.reportA + '/audit', world.users.edA.token);
  assert.strictEqual(audit.status, 200);
  assert.ok(JSON.stringify(audit.j).includes('submitted'), 'audit log records the submission');
});
