'use strict';
// C1 (E-Q09, agent committee — automated, synthetic org, NOT user acceptance) — a site IT coordinator
// (editor + tracker-editor, own site) types this month's value in the Activity Tracker Input tab and the value is
// stored for HER site; then opens the site's department PV and stamps both signatures: the stamp is persisted by the
// server with the SERVER's clock (a browser clock set to 1999 never reaches the database).
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');
const { person, api } = require('./fixtures/iam');

runJourney('C1 coordinator enters a tracker value and signs a PV (server-time stamp)', async ({ app, world, browser, j, login }) => {
  const coord = await person(app, 'c1coord', ['editor', 'tracker-editor'], world.siteA);
  const ctx = await j.newContext(browser);
  const page = await ctx.newPage();

  // ── 1. tracker: the Input tab, the first editable numeric cell of the site's grid ─────────────────
  await login(page, coord, '/activity-tracker.html');
  await page.waitForSelector('.tt-tab', { timeout: 20000 });
  await page.click('.tt-tab:has-text("Input")');
  await page.waitForSelector('input.ip-cell', { timeout: 15000 });
  await j.measure(page, 'activity-tracker');
  const before = await api(page, 'GET', '/api/tracker/load');
  assert.equal(before.status, 200);
  const scope = before.body.scope;
  assert.ok(scope, 'the coordinator has a tracker scope (her site code)');
  const cell = page.locator('input.ip-cell:not([disabled])').first();
  await assert.doesNotReject(cell.waitFor({ timeout: 10000 }), 'an editable cell exists for this month');
  await cell.fill('7');
  await page.waitForFunction(() => /saved|synced/i.test((document.querySelector('.tt-sync, [class*="sync"]') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  let stored = null;
  for (let i = 0; i < 40 && stored === null; i++) {
    const r = await api(page, 'GET', '/api/tracker/load');
    const D = r.body.D || {};
    const yrs = D.inputs || {};
    for (const yr of Object.keys(yrs)) { const s = yrs[yr][scope] || {}; for (const ix of Object.keys(s)) { const arr = s[ix] || []; if (arr.some((x) => Number(x) === 7)) stored = { yr, ix }; } }
    if (stored === null) await page.waitForTimeout(250);
  }
  assert.ok(stored, 'the typed value 7 is stored under the coordinator\'s own site ' + scope);

  // ── 2. PV: stamp both signatures with the browser clock moved to 1999 ────────────────────────────
  const pv = await world.call('POST', '/api/meetings/save', coord.token, { state: { header: { site_code: 'HGO', department: 'maintenance', meeting_date: new Date().toISOString().slice(0, 10), intake_source: 'dept_meeting', status: 'draft', department_head: 'E2E head', site_it_lead: 'E2E coord' }, issues: [], actions: [] } });
  assert.equal(pv.status, 200, 'the coordinator can create a PV on her site: ' + JSON.stringify(pv.j));
  const pvId = pv.j.id;
  await page.addInitScript(() => { const real = Date.prototype.toISOString; Date.prototype.toISOString = function () { return '1999-01-01T00:00:00.000Z'; }; Date.prototype.__realIso = real; });
  await page.goto(app.base + '/meeting.html?id=' + pvId);
  await page.waitForSelector('#pvStampDeptHead', { timeout: 15000 });
  await j.measure(page, 'meeting');
  await page.click('#pvStampDeptHead');
  // the optimistic paint shows the browser's (1999) clock; wait until save() + reload() repaint the SERVER value
  await page.waitForFunction(([b, i]) => { const v = (document.getElementById(i) || {}).value; return v && !/^1999/.test(v) && !document.getElementById(b).disabled; }, ['pvStampDeptHead', 'hDeptHeadSigned'], { timeout: 15000 });
  await page.click('#pvStampItLead');
  // the optimistic paint shows the browser's (1999) clock; wait until save() + reload() repaint the SERVER value
  await page.waitForFunction(([b, i]) => { const v = (document.getElementById(i) || {}).value; return v && !/^1999/.test(v) && !document.getElementById(b).disabled; }, ['pvStampItLead', 'hItLeadSigned'], { timeout: 15000 });
  const rec = (await world.call('GET', '/api/meetings/' + pvId, coord.token)).j;
  const h = rec.header || rec;
  for (const k of ['dept_head_signed_at', 'site_it_signed_at']) {
    assert.ok(h[k], k + ' persisted');
    assert.ok(!/^1999/.test(String(h[k])), k + ' carries the server clock, not the browser\'s 1999');
    assert.ok(Math.abs(Date.parse(String(h[k]).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(h[k])) ? '' : 'Z')) - Date.now()) < 10 * 60 * 1000, k + ' is within 10 min of now');
  }
}, { timeout: 180000 });
