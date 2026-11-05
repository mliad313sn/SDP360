'use strict';
// AMDEC 2026-11-05 (agent-run scenario, not user acceptance) — a Group executive (site-less) opens the IT
// Review and the Executive Scorecard; a site editor is refused the IT Review data (executive-only since
// 2026-08-31). Closes the "executive: not covered" gap of docs/ops/PERSONA-JOURNEYS.md for these two pages.
const assert = require('node:assert');
const crypto = require('crypto');
const { runJourney } = require('./fixtures/harness');

runJourney('U2 executive reads the IT Review and the scorecard; an editor is refused the review data', async ({ app, world, browser, j, login }) => {
  const { rdb } = app;
  const u = { username: 'e2e_exec', password: 'E2e!' + crypto.randomBytes(9).toString('hex') };
  await rdb.createUser({ username: u.username, full_name: 'E2E executive', password: u.password, roles: ['executive'], site_id: null });
  const ctx = await j.newContext(browser);
  const page = await ctx.newPage();
  await login(page, u, '/it-review.html');
  await page.waitForFunction(() => !document.getElementById('review-fallback') && document.getElementById('review-root').textContent.trim().length > 200, null, { timeout: 30000 });
  assert.strictEqual(await page.evaluate(async () => (await fetch('/api/reports/review-data', { credentials: 'same-origin' })).status), 200);
  await j.measure(page, 'it-review');
  await page.goto(new URL('/executive.html', page.url()).href);
  await page.waitForFunction(() => /IT Executive Scorecard/.test(document.title), null, { timeout: 20000 });
  await j.measure(page, 'executive');
  assert.deepStrictEqual(j.rec.page_errors, [], 'no page error on the executive pages');

  const ed = await j.newContext(browser);
  const p2 = await ed.newPage();
  await login(p2, world.users.edA, '/site-actions.html?site=HGO');
  assert.strictEqual(await p2.evaluate(async () => (await fetch('/api/reports/review-data', { credentials: 'same-origin' })).status), 403);
});
