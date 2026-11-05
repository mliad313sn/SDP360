'use strict';
// C-23 (G52) I2 — separation of duties on access approvals. A site admin files a request for a colleague:
// approving it themselves is refused, and so is approval by the requester's own deputy (a stand-in acts in their
// name) — even though that deputy is otherwise an eligible R7 approver of the site. The request is not even in
// the deputy's queue. A third admin of the site, neither requester nor deputy, can decide it: the refusals are
// separation of duties, not a lack of eligibility.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');
const { person, api, day } = require('./fixtures/iam');

runJourney('I2 access self approval and requester deputy approval refused', async ({ app, world, browser, j, login }) => {
  const subject = await person(app, 'i2_subject', ['viewer'], world.siteA);
  const requester = await person(app, 'i2_requester', ['admin'], world.siteA);
  const deputy = await person(app, 'i2_deputy', ['admin'], world.siteA);
  const third = await person(app, 'i2_third', ['admin'], world.siteA);

  // the requester's deputy, named by a super_admin (the governance-roles route)
  const dep = await world.call('POST', '/api/governance/roles/deputies', world.users.sa.token,
    { user_id: requester.id, deputy_id: deputy.id, start_date: day(0), end_date: day(14), reason: 'leave cover for site A admin' });
  assert.strictEqual(dep.status, 201, JSON.stringify(dep.j));

  const rctx = await j.newContext(browser); const rp = await rctx.newPage();
  await login(rp, requester, '/access.html');
  const c = await api(rp, 'POST', '/api/access/requests', { subject_user_id: subject.id, roles: ['tracker-editor'], site_ids: [world.siteA.id], valid_from: day(0), valid_to: day(20), justification: 'tracker entry for site A this month' });
  assert.strictEqual(c.status, 201, JSON.stringify(c.body));
  const id = c.body.id;
  assert.ok(!(await api(rp, 'GET', '/api/access/approvals')).body.requests.some((r) => r.id === id), 'not in the requester\'s own queue');
  const self = await api(rp, 'POST', `/api/access/requests/${id}/approve`, { reason: 'self' });
  assert.strictEqual(self.status, 403); assert.match(self.body.error, /you filed/);

  const dctx = await j.newContext(browser); const dp = await dctx.newPage();
  await login(dp, deputy, '/access.html');
  await dp.click('[data-tab="appr"]');
  await dp.waitForSelector('#axAppr :is(table, p)');
  assert.doesNotMatch(await dp.textContent('#axAppr'), new RegExp('#' + id + '\\b'), 'the deputy\'s Approvals tab does not offer it');
  const byDep = await api(dp, 'POST', `/api/access/requests/${id}/approve`, { reason: 'covering' });
  assert.strictEqual(byDep.status, 403); assert.match(byDep.body.error, /deput/i);
  assert.strictEqual((await api(dp, 'POST', `/api/access/requests/${id}/review`, { reason: 'covering' })).status, 403, 'nor review it');
  await j.measure(dp, 'deputy-approvals');

  const sctx = await j.newContext(browser); const sp = await sctx.newPage();
  await login(sp, subject, '/access.html');
  assert.strictEqual((await api(sp, 'POST', `/api/access/requests/${id}/approve`, {})).status, 403, 'the subject never decides');

  assert.strictEqual((await app.rdb.pgHandle().prepare('SELECT status FROM access_requests WHERE id = ?').get(id)).status, 'REQUESTED', 'still undecided');
  const tctx = await j.newContext(browser); const tp = await tctx.newPage();
  await login(tp, third, '/access.html');
  const ok = await api(tp, 'POST', `/api/access/requests/${id}/approve`, { reason: 'checked with the site lead' });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body)); assert.strictEqual(ok.body.status, 'ACTIVE');
});
