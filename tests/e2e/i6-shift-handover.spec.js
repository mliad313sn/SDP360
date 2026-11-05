'use strict';
// C-23 (G52) I6 — shift handover with explicit acceptance. With shift_handover_enabled = '1' (this throwaway
// database only) the outgoing technician hands the shift over to the incoming one: it stays PENDING — nobody
// else accepts it (not the outgoing person, not the admin tier, not a deputy scoped to another duty family),
// a stale one is flagged and still pending (never auto-accepted) — until the incoming person accepts it on
// coverage.html. Off by default = 404 (today).
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');
const { person, api, day } = require('./fixtures/iam');

runJourney('I6 shift handover pending until the incoming person accepts', async ({ app, world, browser, j, login }) => {
  const H = app.rdb.pgHandle();
  const out = await person(app, 'i6_out', ['editor'], world.siteA);
  const inc = await person(app, 'i6_in', ['editor'], world.siteA);
  const dep = await person(app, 'i6_dep', ['editor'], world.siteA);
  const siteAdmin = await person(app, 'i6_admin', ['admin'], world.siteA);

  const octx = await j.newContext(browser); const op = await octx.newPage();
  await login(op, out, '/coverage.html');
  assert.strictEqual((await api(op, 'GET', '/api/shift-handovers')).status, 404, 'off by default (today)');
  await world.setConfig({ shift_handover_enabled: '1' });

  // the incoming person's deputy is scoped to network on-call only → out of scope for site IT support
  const d = await world.call('POST', '/api/governance/roles/deputies', world.users.sa.token, { user_id: inc.id, deputy_id: dep.id, start_date: day(0), end_date: day(10), reason: 'covers network on-call', scope_site_ids: [world.siteA.id], scope_roles: ['network-oncall'] });
  assert.strictEqual(d.status, 201, JSON.stringify(d.j));

  const c = await api(op, 'POST', '/api/shift-handovers', { site_id: world.siteA.id, family: 'site-it-support', to_user: inc.id, shift_label: 'night ' + day(0), items: ['UPS alarm in the server room', 'core switch reboot planned 06:00'] });
  assert.strictEqual(c.status, 201, JSON.stringify(c.body));
  const id = c.body.handover.id;
  assert.strictEqual(c.body.handover.status, 'pending');

  const decide = async (page, who) => (await api(page, 'POST', `/api/shift-handovers/${id}/accept`)).status;
  assert.strictEqual(await decide(op, 'out'), 403, 'the outgoing person never accepts');
  const actx = await j.newContext(browser); const ap = await actx.newPage();
  await login(ap, siteAdmin, '/coverage.html');
  assert.strictEqual(await decide(ap, 'admin'), 403, 'the admin tier does not accept on their behalf');
  const dctx = await j.newContext(browser); const dp = await dctx.newPage();
  await login(dp, dep, '/coverage.html');
  assert.strictEqual(await decide(dp, 'deputy'), 403, 'deputy scoped to network-oncall: out of scope');

  // nobody accepted it for hours: flagged, still pending
  await H.prepare('UPDATE shift_handovers SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 10 * 36e5).toISOString(), id);
  const ictx = await j.newContext(browser); const ip = await ictx.newPage();
  await login(ip, inc, '/coverage.html');
  const listed = (await api(ip, 'GET', `/api/shift-handovers?site=${world.siteA.id}`)).body.handovers.find((h) => h.id === id);
  assert.deepStrictEqual([listed.status, listed.stale], ['pending', true]);
  const db0 = await H.prepare('SELECT status, accepted_at FROM shift_handovers WHERE id = ?').get(id);
  assert.deepStrictEqual([db0.status, db0.accepted_at], ['pending', null], 'never auto-accepted');

  // the incoming person accepts it on the page
  const btn = ip.locator(`#cvHoList button[data-ho="accept"][data-id="${id}"]`);
  await btn.waitFor({ timeout: 15000 });
  assert.match(await ip.locator('#cvHoList tr', { has: ip.locator(`button[data-ho="accept"][data-id="${id}"]`) }).textContent(), /pending too long/, 'the page flags it');
  await j.measure(ip, 'handover-pending');
  await btn.click();
  await ip.waitForFunction((x) => !document.querySelector(`#cvHoList button[data-ho="accept"][data-id="${x}"]`), id);
  const done = await H.prepare('SELECT status, accepted_by FROM shift_handovers WHERE id = ?').get(id);
  assert.deepStrictEqual([done.status, Number(done.accepted_by)], ['accepted', inc.id]);
  assert.strictEqual((await api(ip, 'POST', `/api/shift-handovers/${id}/refuse`, { reason: 'changed my mind' })).status, 409, 'decided once');
  await world.setConfig({ shift_handover_enabled: '0' });
});
