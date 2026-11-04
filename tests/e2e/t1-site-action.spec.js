'use strict';
// T1 — a site editor finds the OVERDUE actions of the site and closes one with a justification.
// Success = the action leaves the open list, its status is stored and the justification is in its history.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');

runJourney('T1 close an overdue site action with justification', async ({ base, world, browser, j, login }) => {
  const ctx = await j.newContext(browser);
  const page = await ctx.newPage();
  await login(page, world.users.edA, '/site-actions.html?site=HGO');
  // E2E_NEGATIVE_CONTROL=1 (tools/test/run-e2e.js --negative-control): a deliberately broken selector — the
  // job must go red, which proves a missing element is never silently accepted.
  const target = process.env.E2E_NEGATIVE_CONTROL === '1' ? 'no-such-action-e2e-negative-control' : 'replace the core switch PSU';
  await page.waitForSelector('.sa-row strong:has-text("' + target + '")', { timeout: 15000 });
  await j.measure(page, 'site-actions');

  await page.check('#saOverdue');
  const row = page.locator('.sa-row', { hasText: 'replace the core switch PSU' });
  await assert.doesNotReject(row.locator('.sa-overdue-tag').waitFor(), 'the action is flagged late');
  const why = 'Replaced under ticket handled by the vendor — closed in the E2E journey';
  await row.locator('select.sa-status-sel').selectOption('cancelled');
  const dlg = page.locator('[role="dialog"]');
  await dlg.locator('textarea[data-k="note"]').fill(why);
  await dlg.locator('button[data-k="ok"]').click();
  await page.waitForSelector('#saToast.show:has-text("Action updated")');
  await page.waitForFunction(() => !/replace the core switch PSU/.test(document.getElementById('saGroups').textContent));

  // stored: status + justification in the action's history (read back through the app's own API)
  const stored = await page.evaluate(async (id) => (await fetch('/api/meetings/' + id, { credentials: 'same-origin' })).json(), world.meetingId);
  const act = stored.actions.find((a) => a.id === world.action.id);
  assert.strictEqual(act.status, 'cancelled');
  assert.strictEqual(act.status_note, why, 'justification stored on the action');
  const hist = await require('../../meetings-db').listActionUpdates(world.action.id);
  assert.ok(hist.some((u) => u.status_change === 'cancelled' && u.body === why && u.author_name), 'justification + author in the audit trail');
});
