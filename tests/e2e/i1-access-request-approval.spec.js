'use strict';
// C-23 (G52) I1 — access request → review → approve → ACTIVE → role usable → expiry job ends it.
// The subject files the request on access.html; an R7-eligible approver (admin tier holding the site, not the
// requester) takes it for review and approves it on the Approvals tab; an admin of ANOTHER site is refused.
// The role then opens a role-guarded route for the subject. Time is moved by ageing the request/grant rows in
// this throwaway database, then the nightly access.grant_expiry job runs: off by default (skips), armed in
// this database only → the grant ends, the role is gone, the route refuses again.
const assert = require('node:assert');
const path = require('path');
const { runJourney } = require('./fixtures/harness');
const { person, api, day, answerDialogs } = require('./fixtures/iam');

const ROOT = path.join(__dirname, '..', '..');

runJourney('I1 access request review approve active usable then expired', async ({ app, world, browser, j, login }) => {
  const H = app.rdb.pgHandle();
  const subject = await person(app, 'i1_subject', ['viewer'], world.siteA);
  const approver = await person(app, 'i1_adminA', ['admin'], world.siteA);
  const otherAdmin = await person(app, 'i1_adminB', ['admin'], world.siteB);

  // the subject asks for tracker-editor on site A, through the page
  const sctx = await j.newContext(browser); const sp = await sctx.newPage();
  await login(sp, subject, '/access.html');
  assert.strictEqual((await api(sp, 'GET', '/api/tracker/load')).status, 403, 'before: a viewer cannot open the tracker');
  await sp.click('[data-tab="req"]');
  await sp.fill('#axRoles', 'tracker-editor');
  await sp.fill('#axSites', String(world.siteA.id));
  await sp.fill('#axFrom', day(0)); await sp.fill('#axTo', day(30));
  await sp.fill('#axWhy', 'monthly tracker entry for site A while the coordinator is away');
  await sp.click('#axReqForm button[type="submit"]');
  await sp.waitForSelector('#axMsg.ax-ok');
  const me0 = (await api(sp, 'GET', '/api/access/me')).body;
  const req = me0.requests.find((r) => (r.roles || []).includes('tracker-editor'));
  assert.ok(req && req.status === 'REQUESTED', 'request filed: ' + JSON.stringify(me0.requests));
  assert.strictEqual((await api(sp, 'POST', `/api/access/requests/${req.id}/approve`, { reason: 'me' })).status, 403, 'the subject never approves');
  await j.measure(sp, 'access-request-filed');

  // an admin of another site: not eligible (R7)
  const octx = await j.newContext(browser); const op = await octx.newPage();
  await login(op, otherAdmin, '/access.html');
  assert.ok(!(await api(op, 'GET', '/api/access/approvals')).body.requests.some((r) => r.id === req.id), 'not in the queue of another site');
  const wrong = await api(op, 'POST', `/api/access/requests/${req.id}/approve`, { reason: 'not mine' });
  assert.strictEqual(wrong.status, 403); assert.match(wrong.body.error, /do not hold site/);

  // the eligible approver: review, then approve, on the Approvals tab
  const actx = await j.newContext(browser); const ap = await actx.newPage();
  answerDialogs(ap, ['agreed: covers the coordinator absence']);
  await login(ap, approver, '/access.html');
  await ap.click('[data-tab="appr"]');
  const row = ap.locator('#axAppr tr', { hasText: '#' + req.id });
  await row.locator('button[data-act="review"]').click();
  await ap.waitForFunction((id) => /REVIEWING/.test(([...document.querySelectorAll('#axAppr tr')].find((r) => r.textContent.includes('#' + id)) || {}).textContent || ''), req.id);
  await row.locator('button[data-act="approve"]').click();
  await row.waitFor({ state: 'detached', timeout: 15000 });   // decided → leaves the queue
  const got = (await api(ap, 'GET', `/api/access/requests/${req.id}`)).body;
  assert.strictEqual(got.request.status, 'ACTIVE');
  assert.deepStrictEqual(got.events.map((e) => e.action).filter((a) => ['review', 'approve', 'activated'].includes(a)), ['review', 'approve', 'activated']);
  await j.measure(ap, 'access-approved');

  // the role is usable at once (session re-reads the roles every request)
  assert.strictEqual((await api(sp, 'GET', '/api/tracker/load')).status, 200, 'after approval: the tracker opens');
  const me1 = (await api(sp, 'GET', '/api/access/me')).body;
  const g = me1.grants.find((x) => x.role === 'tracker-editor');
  assert.ok(g && g.valid_to === day(30), 'grant with its end date: ' + JSON.stringify(me1.grants));

  // time passes: the validity window is in the past
  await H.prepare('UPDATE access_requests SET valid_from = ?, valid_to = ? WHERE id = ?').run(day(-40), day(-1), req.id);
  await H.prepare('UPDATE access_grants SET valid_from = ?, valid_to = ? WHERE request_id = ?').run(day(-40), day(-1), req.id);
  const jobs = require(path.join(ROOT, 'services', 'sync', 'jobs.js'));
  const off = await jobs.accessGrantExpiryRun({ rdb: app.rdb });
  assert.strictEqual(off.skipped, true, 'off by default: the job does nothing');
  assert.strictEqual((await api(sp, 'GET', '/api/tracker/load')).status, 200, 'switch off = today: the role stays');
  await world.setConfig({ access_grant_expiry_job: '1' });
  const on = await jobs.accessGrantExpiryRun({ rdb: app.rdb });
  assert.ok(on.expired >= 1, JSON.stringify(on));
  assert.strictEqual((await H.prepare('SELECT status FROM access_requests WHERE id = ?').get(req.id)).status, 'EXPIRED');
  assert.strictEqual((await api(sp, 'GET', '/api/tracker/load')).status, 403, 'expired: the tracker refuses again');
  const me2 = (await api(sp, 'GET', '/api/access/me')).body;
  assert.ok(!me2.user.roles.includes('tracker-editor') && me2.user.roles.includes('viewer'), JSON.stringify(me2.user.roles));
  await world.setConfig({ access_grant_expiry_job: '0' });
});
