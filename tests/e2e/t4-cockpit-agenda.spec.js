'use strict';
// T4 — Group IT finds the Meeting Cockpit and prepares Friday's agenda from the cadence.
// Success = a session is created with a generated agenda and the live session view opens.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');

runJourney('T4 cockpit prepare the Friday agenda', async ({ world, browser, j, login }) => {
  const ctx = await j.newContext(browser);
  const page = await ctx.newPage();
  await login(page, world.users.groupit, '/cockpit.html');
  const row = page.locator('#cadences tr', { hasText: 'E2E Group IT Friday' });
  await row.waitFor();
  assert.match(await row.textContent(), /Fri 09:00/);
  await j.measure(page, 'cockpit');
  await row.locator('button[data-prep]').click();
  await page.waitForSelector('#msg:has-text("Session prepared — agenda with")');
  await page.waitForSelector('#live:not([hidden])');
  assert.match(await page.textContent('#l-title'), /E2E Group IT Friday/);

  const s = await world.call('GET', '/api/governance/sessions?limit=5', world.users.groupit.token);
  const mine = s.j.sessions.find((x) => x.cadence_id === world.cadenceId);
  assert.ok(mine && mine.status === 'planned', 'a planned session exists for the cadence');
  const full = await world.call('GET', '/api/governance/sessions/' + mine.id, world.users.groupit.token);
  assert.ok(full.j.session.agenda && Array.isArray(full.j.session.agenda.items), 'agenda generated');
});
