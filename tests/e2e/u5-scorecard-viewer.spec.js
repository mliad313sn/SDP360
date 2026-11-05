'use strict';
// D-10 (AMDEC AM-14 prep, agent-run, NOT user acceptance) — a scorecard-viewer reads the Executive Scorecard and
// Analytics, but every write power the executive tier holds is refused (settings, site report content, finance); the IT Review data stays readable.
const assert = require('node:assert');
const crypto = require('crypto');
const { runJourney } = require('./fixtures/harness');

runJourney('U5 scorecard viewer reads the scorecard and analytics without write powers', async ({ app, base, world, browser, j, login }) => {
  const { rdb } = app;
  const u = { username: 'e2e_scv', password: 'E2e!' + crypto.randomBytes(9).toString('hex') };
  await rdb.createUser({ username: u.username, full_name: 'E2E scorecard viewer', password: u.password, roles: ['scorecard-viewer'], site_id: null });
  const page = await (await j.newContext(browser, { viewport: { width: 1440, height: 900 } })).newPage();
  await login(page, u, '/executive.html');
  await page.goto(base + '/executive.html');   // the sign-in lands on the role's home; open the scorecard explicitly
  await page.waitForFunction(() => /IT Executive Scorecard/.test(document.title), null, { timeout: 20000 });
  assert.strictEqual(new URL(page.url()).pathname, '/executive.html', 'the scorecard opens for the viewer');
  await j.measure(page, 'executive');
  await page.goto(base + '/analytics.html');
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  assert.strictEqual(new URL(page.url()).pathname, '/analytics.html', 'analytics opens for the viewer');
  await j.measure(page, 'analytics');
  const st = (m, p, b) => page.evaluate(async ([m, p, b]) => (await fetch(p, { method: m, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-report-token': localStorage.getItem('report_token') || '' }, body: b ? JSON.stringify(b) : undefined })).status, [m, p, b]);
  assert.strictEqual(await st('PUT', '/api/reports/config', { exec_view_lang: 'fr' }), 403, 'no settings write');
  assert.strictEqual(await st('PUT', `/api/reports/${world.reportA}/lights`, []), 403, 'no report write');
  assert.strictEqual(await st('GET', '/api/reports/review-data'), 200, 'reads the IT Review data (executive | scorecard-viewer)');
  assert.strictEqual(await st('GET', `/api/reports/${world.reportA}`, null), 403, 'no site report content');
  assert.strictEqual(await st('GET', '/api/assets/finance/summary', null), 403, 'no finance figures');
  assert.deepStrictEqual(j.rec.page_errors, [], 'no page error on the reader pages');
});
