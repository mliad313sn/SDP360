'use strict';
// External UAT 2026-10-29 — PMO and users seats: minutes are sent only after acceptance and carry the
// acceptance stamp; open session actions come back in the next agenda and in the site obligations;
// the chair moves a decision's status (content stays committee); the requester confirms an RFI;
// the named department head signs their PV; a reader never creates a weekly report.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'uat-gov-'));
process.env.DASH_USER = process.env.DASH_USER || 'uat-gov-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'uat-gov-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'uat-gov-key-0000000000000000000000';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, hounde, T = {}, ID = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 50; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'meeting_cadences'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  hounde = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name)).id;
  const mk = async (k, roles, site, full) => { const u = 'ug_' + k; try { await rdb.createUser({ username: u, full_name: full || u, password: u + 'pass1234', roles, site_id: site }); } catch {} T[k] = (await rdb.login(u, u + 'pass1234')).token; ID[k] = Number((await rdb.db.prepare('SELECT id FROM users WHERE username=?').get(u)).id); };
  await mk('member', ['viewer', 'committee-member']); await mk('chair', ['editor'], hounde); await mk('second', ['editor'], hounde);
  await mk('viewer', ['viewer'], hounde); await mk('head', ['viewer'], hounde, 'Awa Ouédraogo');
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
const J = async (r) => ({ status: r.status, body: await r.json() });

test('minutes: refused before acceptance, stamped with the acceptor; actions carried; chair updates a decision status', async () => {
  const c = await J(await send('PUT', '/api/governance/cadences', T.member, { key: 'ug-weekly', name: 'UG weekly', kind: 'site_weekly', site_id: hounde, chair_id: ID.chair, participants: ['chair@example.com'] }));
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const s = await J(await send('POST', `/api/governance/cadences/${c.body.cadence.id}/sessions`, T.chair, { scheduled_at: new Date().toISOString() }));
  const sid = s.body.session.id;
  assert.equal((await send('POST', `/api/governance/sessions/${sid}/start`, T.chair)).status, 200);
  const d = await J(await send('POST', `/api/governance/sessions/${sid}/decisions`, T.chair, { title: 'Replace the plant switch', owner: 'IT lead' }));
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal((await send('POST', `/api/governance/sessions/${sid}/actions`, T.chair, { title: 'Raise the purchase order', owner: 'Plant', due_date: '2020-01-01' })).status, 200);
  assert.equal((await send('POST', `/api/governance/sessions/${sid}/close`, T.chair)).status, 200);
  const early = await J(await send('POST', `/api/governance/sessions/${sid}/minutes/send`, T.chair, {}));
  assert.equal(early.status, 409); assert.equal(early.body.code, 'NOT_ACCEPTED');
  { const ac = await J(await send('POST', `/api/governance/sessions/${sid}/accept`, T.member)); assert.equal(ac.status, 200, 'accept ' + JSON.stringify(ac.body)); }
  const html = await (await send('GET', `/api/governance/sessions/${sid}/minutes.html`, T.chair)).text();
  assert.match(html, /Minutes accepted<\/b> by ug_member/);
  // the next session's agenda brings the open action back
  const s2 = await J(await send('POST', `/api/governance/cadences/${c.body.cadence.id}/sessions`, T.chair, { scheduled_at: new Date().toISOString() }));
  assert.match(JSON.stringify(s2.body.session.agenda || s2.body.session.items || s2.body.session), /Raise the purchase order/);
  // and the site obligations list it
  const ob = await J(await send('GET', `/api/obligations?site=${hounde}`, T.chair));
  assert.ok(ob.body.items.some((x) => x.register === 'session_action' && /purchase order/.test(x.title) && x.overdue), JSON.stringify(ob.body.items.slice(0, 3)));
  // the chair moves the decision's status, not its content; a reader does neither
  assert.equal((await send('PUT', `/api/governance/decisions/${d.body.decision.id}`, T.chair, { status: 'in_progress' })).status, 200);
  assert.equal((await send('PUT', `/api/governance/decisions/${d.body.decision.id}`, T.chair, { title: 'Something else' })).status, 403);
  assert.equal((await send('PUT', `/api/governance/decisions/${d.body.decision.id}`, T.viewer, { status: 'done' })).status, 403);
});

test('RFI: only the requester confirms a delivered request; the committee cannot set "verified" itself', async () => {
  const r = await J(await send('POST', '/api/governance/rfi', T.viewer, { kind: 'governance', title: 'Monthly committee pack', problem: 'We assemble it by hand' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const id = r.body.rfi.id;
  assert.equal((await send('PUT', `/api/governance/rfi/${id}`, T.member, { status: 'verified' })).status, 400);
  assert.equal((await send('POST', `/api/governance/rfi/${id}/verify`, T.viewer)).status, 409, 'not delivered yet');
  assert.equal((await send('PUT', `/api/governance/rfi/${id}`, T.member, { status: 'delivered' })).status, 200);
  assert.equal((await send('POST', `/api/governance/rfi/${id}/verify`, T.chair)).status, 403, 'not the requester');
  const v = await J(await send('POST', `/api/governance/rfi/${id}/verify`, T.viewer));
  assert.equal(v.status, 200); assert.equal(v.body.rfi.status, 'verified');
});

test('PV: the department head named on it signs it; another reader cannot; the signer is kept', async () => {
  const mdb = require('../meetings-db');
  const m = await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'uat-sign', meeting_date: '2026-10-15', status: 'draft', department_head: 'Awa Ouedraogo' } }, null, 1);
  const id = m.id || m.meeting_id || (m.header && m.header.id);
  assert.equal((await send('POST', `/api/meetings/${id}/sign`, T.viewer, { which: 'dept_head' })).status, 403);
  const ok = await J(await send('POST', `/api/meetings/${id}/sign`, T.head, { which: 'dept_head' }));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(String(ok.body.dept_head_signed_by), /ug_head/); assert.equal(ok.body.dept_head_signed_on_behalf, null);
  assert.equal((await send('POST', `/api/meetings/${id}/sign`, T.head, { which: 'site_it' })).status, 403, 'only the IT side signs for IT');
});

test('weekly report: a reader opens an existing report but never creates one', async () => {
  const r = await J(await send('POST', '/api/reports/ensure', T.viewer, { site_id: hounde, year: 2031, week: 7 }));
  assert.equal(r.status, 404);
  assert.equal((await send('POST', '/api/reports/ensure', T.chair, { site_id: hounde, year: 2031, week: 7 })).status, 200);
  assert.equal((await send('POST', '/api/reports/ensure', T.viewer, { site_id: hounde, year: 2031, week: 7 })).status, 200);
});
