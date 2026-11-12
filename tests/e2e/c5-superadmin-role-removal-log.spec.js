'use strict';
// C5 (E-Q09, agent committee — automated, synthetic org, NOT user acceptance) — a super_admin removes a user's
// admin role from the Users admin API, signed in through the real page; the user's NEXT request on an admin route,
// with the session they already hold, is refused; the security journal (System Logs) shows the role change and the
// CSV export the super_admin downloads contains it.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');
const { person, api } = require('./fixtures/iam');

runJourney('C5 super_admin removes a role, the next request is refused, the security log export has the event', async ({ app, base, world, browser, j, login }) => {
  const target = await person(app, 'c5target', ['admin'], null);
  assert.equal((await world.call('POST', '/api/cache/clear', target.token)).status, 200, 'before: the admin route answers');

  const page = await (await j.newContext(browser, { viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  await login(page, world.users.sa, '/system-logs.html');
  const upd = await api(page, 'PUT', '/api/reports/users/' + target.id, { full_name: 'E2E c5target', roles: ['viewer'], active: 1 });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));

  const after = await world.call('POST', '/api/cache/clear', target.token);
  assert.equal(after.status, 403, 'the very next request with the existing session is refused');
  assert.equal((await world.call('GET', '/api/reports/current-week', target.token)).status, 200, 'the session itself still works for what a viewer may do');

  await page.goto(base + '/system-logs.html');
  await page.waitForFunction(() => /user_role_changed/.test(document.body.textContent), null, { timeout: 20000 });
  await j.measure(page, 'system-logs');
  const csv = await page.evaluate(async () => (await fetch('/api/reports/system-log/export.csv', { credentials: 'same-origin' })).text());
  const line = csv.split(/\r?\n/).find((l) => /user_role_changed/.test(l) && /c5target/.test(l));
  assert.ok(line, 'the CSV export contains the role change for the target');
  assert.match(line, /e2e_sa/, 'with the super_admin as actor');
  assert.equal((await world.call('GET', '/api/reports/system-log/export.csv', target.token)).status, 403, 'the demoted user cannot export the journal');
  assert.deepStrictEqual(j.rec.page_errors, [], 'no page error');
});
