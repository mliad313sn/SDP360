'use strict';
// E-V08 — a site editor's human note appears on the dashboard trends of their site (marker + list with its
// source), can be hidden per viewer, and an editor of another site never sees it. Runs with
// report_config chart_annotations_enabled='1' in this throwaway database (shipped default '0').
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');

runJourney('U7 human chart note on a dashboard trend', async ({ base, world, browser, j, login }) => {
  await world.setConfig({ chart_annotations_enabled: '1' });
  const day = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const c = await world.call('POST', '/api/dashboards/annotations', world.users.edA.token,
    { site_id: world.siteA.id, metric_key: null, at: day, label: 'E2E note: ISP outage', source_kind: 'ticket', source_ref: '312004' });
  assert.strictEqual(c.status, 201, JSON.stringify(c.j));
  const ctx = await j.newContext(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page, world.users.edA, '/home.html');
  await page.goto(base + '/dashboards.html?key=site-weekly');
  await page.waitForSelector('.edv-annotations li', { timeout: 20000 });
  assert.match(await page.textContent('.edv-annotations'), /E2E note: ISP outage.*ticket #312004/);
  assert.strictEqual(await page.isVisible('#annWrap'), true);
  await page.uncheck('#annShow');
  await page.waitForFunction(() => !document.querySelector('.edv-annotations'), null, { timeout: 15000 });
  await page.check('#annShow');
  await page.waitForSelector('.edv-annotations li', { timeout: 15000 });
  await j.measure(page, 'dashboard-annotations');
  // another site's editor: the note is not in their scope
  const other = await world.call('GET', '/api/dashboards/annotations', world.users.edB.token);
  assert.ok(!(other.j.annotations || []).some((a) => /E2E note/.test(a.label)), 'not visible to another site');
});
