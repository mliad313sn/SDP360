'use strict';
// Cross-site deny — the editor of site A cannot read site B's weekly report, nor (once A-15's
// portfolio_site_scope_reads switch is on, here in the throwaway database only) site B's portfolio project.
// Today's behaviour with the switch OFF is pinned too, so the journey says exactly what the switch changes.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');

runJourney('DENY site A editor cannot read site B report or portfolio project', async ({ world, browser, j, login }) => {
  const ctx = await j.newContext(browser);
  const page = await ctx.newPage();
  const status = (p) => page.evaluate(async (u) => (await fetch(u, { credentials: 'same-origin' })).status, p);

  // weekly report of site B — refused whatever the switches
  await login(page, world.users.edA, '/reports.html?report=' + world.reportB);
  await page.waitForSelector('.toast:has-text("Error loading report"), #toast:has-text("Error loading report"), :text("Error loading report")', { timeout: 15000 });
  assert.strictEqual(await page.isVisible('#page-form.active'), false, 'site B report form never opens');
  assert.strictEqual(await status('/api/reports/' + world.reportB), 403);
  assert.strictEqual(await status('/api/reports/' + world.reportA), 200, 'own site still readable');
  await j.measure(page, 'reports-denied');

  // portfolio — switch OFF (today): every session reads every project
  await world.setConfig({ portfolio_site_scope_reads: '0' });
  await page.goto(new URL('/portfolio.html', page.url()).href);
  const gantt = () => page.textContent('#gantt');
  await page.waitForFunction(() => /E2E project Hounde/.test(document.getElementById('gantt').textContent), null, { timeout: 15000 });
  assert.match(await gantt(), /E2E project Mana/, 'switch off = today: project of B listed');

  // switch ON: project B disappears and its history is 404
  await world.setConfig({ portfolio_site_scope_reads: '1' });
  await page.reload();
  await page.waitForFunction(() => /E2E project Hounde/.test(document.getElementById('gantt').textContent), null, { timeout: 15000 });
  assert.doesNotMatch(await gantt(), /E2E project Mana/, 'project of site B hidden');
  assert.doesNotMatch(await page.textContent('body'), /E2E project Mana/);
  const ids = await page.evaluate(async () => ((await (await fetch('/api/governance/portfolio', { credentials: 'same-origin' })).json()).projects || []).map((p) => p.id));
  assert.ok(ids.includes(world.projA) && !ids.includes(world.projB), 'the API the page reads carries no project of site B: ' + JSON.stringify(ids));
  await j.measure(page, 'portfolio-scoped');
});
