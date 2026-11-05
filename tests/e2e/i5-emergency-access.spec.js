'use strict';
// C-23 (G52) I5 — emergency (break-glass) access. With emergency_access_enabled = '1' (this throwaway database
// only) a super_admin grants a time-boxed role on access.html: more than 24 h is refused, a grant to oneself is
// refused; the role is usable at once; once the review is past due it is flagged "review overdue"; the granter
// may not review it, another super_admin does, on the Emergency tab; when the hour has passed the grant ends and
// the role goes. Off by default = 404 (today).
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');
const { person, api, day, answerDialogs } = require('./fixtures/iam');

runJourney('I5 emergency access 24h cap overdue review not by the granter', async ({ app, world, browser, j, login }) => {
  const H = app.rdb.pgHandle();
  const granter = world.users.sa;
  const reviewer = await person(app, 'i5_super2', ['super_admin'], null);
  const subject = await person(app, 'i5_subject', ['viewer'], world.siteA);

  const gctx = await j.newContext(browser); const gp = await gctx.newPage();
  await login(gp, granter, '/access.html');
  assert.strictEqual((await api(gp, 'GET', '/api/access/emergencies')).status, 404, 'off by default (today)');
  await world.setConfig({ emergency_access_enabled: '1' });
  const over = await api(gp, 'POST', '/api/access/emergencies', { subject_user_id: subject.id, roles: ['tracker-editor'], site_ids: [world.siteA.id], hours: 25, reason: 'site A network outage, night shift' });
  assert.strictEqual(over.status, 400); assert.match(over.body.error, /at most 24 h/);
  const selfG = await api(gp, 'POST', '/api/access/emergencies', { subject_user_id: Number((await H.prepare('SELECT id FROM users WHERE username = ?').get(granter.username)).id), roles: ['tracker-editor'], hours: 2, reason: 'I need it myself tonight' });
  assert.match(String(selfG.body.error), /themselves/, 'never to oneself');

  // the grant, through the Emergency tab
  await gp.reload();
  await gp.click('#axEmTab');
  await gp.fill('#axEmUser', String(subject.id)); await gp.fill('#axEmRoles', 'tracker-editor');
  await gp.fill('#axEmSites', String(world.siteA.id)); await gp.fill('#axEmHours', '4');
  await gp.fill('#axEmWhy', 'site A network outage, night shift, coordinator unreachable');
  await gp.click('#axEmForm button[type="submit"]');
  await gp.waitForSelector('#axEms tr:has-text("tracker-editor")');
  const em = (await api(gp, 'GET', '/api/access/emergencies')).body.emergencies.find((e) => e.subject_user_id === subject.id);
  assert.ok(em && em.live && !em.review_overdue, JSON.stringify(em));
  const hours = (Date.parse(em.expires_at) - Date.parse(em.starts_at)) / 36e5;
  assert.ok(hours > 3.9 && hours <= 4.01, 'expires 4 h after the start: ' + hours);
  const risk = await H.prepare("SELECT risk FROM system_log WHERE action = 'access_emergency_granted' ORDER BY id DESC LIMIT 1").get();
  assert.strictEqual(Number(risk && risk.risk), 1, 'logged as a risk event');
  await j.measure(gp, 'emergency-granted');

  const sctx = await j.newContext(browser); const sp = await sctx.newPage();
  await login(sp, subject, '/access.html');
  assert.strictEqual((await api(sp, 'GET', '/api/tracker/load')).status, 200, 'the emergency role is usable');

  // the review is past due → flagged + listed
  await H.prepare('UPDATE access_emergencies SET review_due = ? WHERE id = ?').run(day(-1), em.id);
  const overdue = (await api(gp, 'GET', '/api/access/emergencies/overdue')).body.emergencies;
  assert.ok(overdue.some((e) => e.id === em.id && e.review_overdue), 'listed as overdue: ' + JSON.stringify(overdue));
  const byGranter = await api(gp, 'POST', `/api/access/emergencies/${em.id}/review`, { outcome: 'justified', notes: 'I granted it, it was fine' });
  assert.strictEqual(byGranter.status, 403); assert.match(byGranter.body.error, /granted the emergency access/);
  await gp.reload(); await gp.click('#axEmTab');
  assert.strictEqual(await gp.locator(`#axEms button[data-emrev="${em.id}"]`).count(), 0, 'no review button for the granter');

  const rctx = await j.newContext(browser); const rp = await rctx.newPage();
  answerDialogs(rp, ['justified', 'outage confirmed by the site IT lead, access used once']);
  await login(rp, reviewer, '/access.html');
  await rp.click('#axEmTab');
  const row = rp.locator('#axEms tr', { has: rp.locator(`button[data-emrev="${em.id}"]`) });
  assert.match(await row.textContent(), /review overdue/, 'the Emergency tab flags it');
  await row.locator(`button[data-emrev="${em.id}"]`).click();
  await rp.waitForFunction((id) => !document.querySelector(`#axEms button[data-emrev="${id}"]`), em.id);
  const reviewed = await H.prepare('SELECT reviewed_by, review_outcome FROM access_emergencies WHERE id = ?').get(em.id);
  assert.deepStrictEqual([Number(reviewed.reviewed_by), reviewed.review_outcome], [reviewer.id, 'justified']);
  await j.measure(rp, 'emergency-reviewed');

  // the hour has passed → the grant ends at the next read / job, the role goes
  const past = (h) => new Date(Date.now() - h * 36e5).toISOString();
  await H.prepare('UPDATE access_emergencies SET starts_at = ?, expires_at = ? WHERE id = ?').run(past(5), past(1), em.id);
  const after = (await api(gp, 'GET', '/api/access/emergencies')).body.emergencies.find((e) => e.id === em.id);
  assert.strictEqual(after.live, false);
  assert.strictEqual((await api(sp, 'GET', '/api/tracker/load')).status, 403, 'ended: the role is gone');
  await world.setConfig({ emergency_access_enabled: '0' });
});
