'use strict';
// C-23 (G52) I4 — qualification evidence gates a capability. With qualification_check_enabled = '1' and a
// requirement on field capture (both set in this throwaway database only), a field technician is refused with
// the reason (missing → not verified), an admin records the evidence on access.html, neither the holder nor the
// recorder may verify it, a THIRD person verifies it on the Qualifications tab → the capture is allowed; once the
// evidence has expired the capture is refused again, with "expired" as the reason. Off by default = today.
// The gate caches report_config for 30 s in a live server (a switch flip takes up to 30 s to bite); the journey
// sets that cache to 0 ms so each step reads the setting it just wrote.
process.env.SDP_QUAL_CFG_TTL_MS = '0';
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');
const { person, api, day } = require('./fixtures/iam');

runJourney('I4 qualification recorded verified by a third person then expired', async ({ app, world, browser, j, login }) => {
  const tech = await person(app, 'i4_tech', ['field-tech'], world.siteA);
  const recorder = await person(app, 'i4_recorder', ['admin'], world.siteA);
  const verifier = await person(app, 'i4_verifier', ['admin'], world.siteA);

  const tctx = await j.newContext(browser); const tp = await tctx.newPage();
  await login(tp, tech, '/access.html');
  const upload = () => api(tp, 'POST', '/api/field/uploads', {});
  const check = async () => (await api(tp, 'GET', '/api/qualifications/check?cap=field.capture')).body;
  assert.notStrictEqual((await upload()).status, 403, 'switch off (today): no qualification gate');

  await world.setConfig({ qualification_check_enabled: '1', qualification_requirements: JSON.stringify({ 'field.capture': ['site-induction'] }) });
  const missing = await upload();
  assert.strictEqual(missing.status, 403); assert.match(missing.body.error, /missing site-induction.*records evidence only/);
  assert.deepStrictEqual([(await check()).allow, (await check()).reason_code], [false, 'qualification_missing']);

  // the recorder enters the evidence through the page
  const rctx = await j.newContext(browser); const rp = await rctx.newPage();
  await login(rp, recorder, '/access.html');
  await rp.click('[data-tab="qual"]');
  await rp.waitForSelector('#axQualForm:not([hidden])');
  await rp.fill('#axQUser', String(tech.id));
  await rp.selectOption('#axQKind', 'site-induction');
  await rp.fill('#axQIssuer', 'HSE site A');
  await rp.fill('#axQIssued', day(-30)); await rp.fill('#axQExp', day(300));
  await rp.fill('#axQRef', 'IND-E2E-001');
  await rp.click('#axQualForm button[type="submit"]');
  await rp.waitForSelector('#axQuals tr:has-text("IND-E2E-001")');
  const rec = (await api(rp, 'GET', `/api/qualifications?user_id=${tech.id}`)).body.records.find((r) => r.evidence_ref === 'IND-E2E-001');
  assert.ok(rec && rec.state === 'unverified', JSON.stringify(rec));
  assert.strictEqual(await rp.locator(`#axQuals button[data-qact="verify"][data-id="${rec.id}"]`).count(), 0, 'no Verify button for the recorder');
  assert.match((await api(rp, 'POST', `/api/qualifications/${rec.id}/verify`, {})).body.error, /recorded this evidence/);
  assert.strictEqual((await api(tp, 'POST', `/api/qualifications/${rec.id}/verify`, {})).status, 403, 'the holder never verifies');
  const unverified = await upload();
  assert.strictEqual(unverified.status, 403); assert.match(unverified.body.error, /not yet verified site-induction/);
  await j.measure(rp, 'qualification-recorded');

  // a third person verifies it on the Qualifications tab
  const vctx = await j.newContext(browser); const vp = await vctx.newPage();
  await login(vp, verifier, '/access.html');
  await vp.click('[data-tab="qual"]');
  await vp.locator(`#axQuals button[data-qact="verify"][data-id="${rec.id}"]`).click();
  await vp.waitForFunction((id) => !document.querySelector(`#axQuals button[data-qact="verify"][data-id="${id}"]`), rec.id);
  const verified = await app.rdb.pgHandle().prepare('SELECT status, verified_by FROM qualification_records WHERE id = ?').get(rec.id);
  assert.deepStrictEqual([verified.status, Number(verified.verified_by)], ['verified', verifier.id]);
  assert.notStrictEqual((await upload()).status, 403, 'verified → capture allowed');
  assert.strictEqual((await check()).allow, true);

  // time passes: the evidence expires → refused again, with the reason
  await app.rdb.pgHandle().prepare('UPDATE qualification_records SET expires_on = ? WHERE id = ?').run(day(-1), rec.id);
  const expired = await upload();
  assert.strictEqual(expired.status, 403); assert.match(expired.body.error, /expired site-induction/);
  assert.deepStrictEqual([(await check()).allow, (await check()).reason_code], [false, 'qualification_expired']);
  await world.setConfig({ qualification_check_enabled: '0', qualification_requirements: '{}' });
  assert.notStrictEqual((await upload()).status, 403, 'switch back off: today again');
});
