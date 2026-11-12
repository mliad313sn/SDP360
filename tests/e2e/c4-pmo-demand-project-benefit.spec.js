'use strict';
// C4 (E-Q09, agent committee — automated, synthetic org, NOT user acceptance) — a PMO committee member takes a
// site's demand (RFI) through triage → accepted → project, adds an expected benefit, records the realised value
// with evidence, is refused verifying it himself, and a second committee member verifies it; the project page's
// Benefits tab shows the verified benefit. Capacity conflict: `capacity_enabled` is NOT built in this code base —
// the journey asserts the switch and any capacity route are absent and records it (see PERSONA-JOURNEYS.md).
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');
const { person, api } = require('./fixtures/iam');

runJourney('C4 PMO turns a demand into a project and checks its benefit (capacity conflict recorded as not built)', async ({ app, base, world, browser, j, login }) => {
  const requester = await person(app, 'c4req', ['viewer'], world.siteA);
  const pmo = await person(app, 'c4pmo', ['viewer', 'committee-member'], null);
  const cio = await person(app, 'c4cio', ['viewer', 'committee-member'], null);

  // capacity: not built — recorded, never faked
  assert.equal(Object.prototype.hasOwnProperty.call(require('../../services/reportConfig').DEFAULTS, 'capacity_enabled'), false, 'capacity_enabled switch does not exist yet (update C4 when it is built)');

  const rfi = (await world.call('POST', '/api/governance/rfi', requester.token, { kind: 'integration', title: 'C4 WAN redundancy at Houndé', problem: 'single ISP link; outages stop the mill reporting' })).j.rfi;
  assert.ok(rfi && rfi.id, 'the requester files a demand');

  const page = await (await j.newContext(browser, { viewport: { width: 1440, height: 900 } })).newPage();
  await login(page, pmo, '/portfolio.html');
  assert.equal((await api(page, 'POST', `/api/governance/rfi/${rfi.id}/to-project`, { objective_id: 1, key: 'x' })).status, 409, 'a submitted demand is not a project yet');
  assert.equal((await api(page, 'PUT', `/api/governance/rfi/${rfi.id}`, { status: 'triaged' })).status, 200);
  assert.equal((await api(page, 'PUT', `/api/governance/rfi/${rfi.id}`, { status: 'accepted', decision: 'go — C4 committee' })).status, 200);
  const prog = (await api(page, 'PUT', '/api/governance/portfolio/programme', { key: 'c4-net', name: 'C4 network resilience' })).body.id;
  const obj = (await api(page, 'PUT', '/api/governance/portfolio/objective', { programme_id: prog, key: 'c4-o1', name: 'Two links per mine' })).body.id;
  const conv = await api(page, 'POST', `/api/governance/rfi/${rfi.id}/to-project`, { objective_id: obj, key: 'C4-1', owner: 'e2e_c4pmo' });
  assert.equal(conv.status, 200, JSON.stringify(conv.body));
  const pid = conv.body.project_id;
  assert.equal((await api(page, 'POST', `/api/governance/rfi/${rfi.id}/to-project`, { objective_id: obj, key: 'C4-2' })).status, 409, 'at most one project per demand');

  const ben = await api(page, 'PUT', '/api/governance/portfolio/benefit', { project_id: pid, description: 'C4 fewer unplanned WAN outages', measure: 'unplanned outage hours', unit: 'hours / month', baseline_value: 12, target_value: 4, owner: 'Site GM', review_date: '2026-01-15' });
  assert.equal(ben.status, 200, JSON.stringify(ben.body));
  const bid = ben.body.id;
  const real = await api(page, 'POST', `/api/governance/portfolio/benefit/${bid}/realised`, { realised_value: 5, evidence_link: 'https://intranet.example/wan/kpi', note: 'six-month average' });
  assert.equal(real.status, 200, JSON.stringify(real.body));
  assert.equal(real.body.benefit.state, 'awaiting_verification');
  const self = await api(page, 'POST', `/api/governance/portfolio/benefit/${bid}/verify`);
  assert.equal(self.status, 403, 'the person who entered the value cannot verify it');
  const ok = await world.call('POST', `/api/governance/portfolio/benefit/${bid}/verify`, cio.token);
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  assert.equal(ok.j.benefit.state, 'verified');

  await page.goto(base + '/project.html?id=' + pid);
  await page.click('#tab-benefits');
  await page.waitForFunction(() => /C4 fewer unplanned WAN outages/.test(document.getElementById('benefits').textContent), null, { timeout: 15000 });
  const txt = await page.textContent('#benefits');
  assert.match(txt, /verified/i, 'the Benefits tab shows the verification');
  await j.measure(page, 'project');
  assert.deepStrictEqual(j.rec.page_errors, [], 'no page error');
});
