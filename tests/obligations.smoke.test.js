'use strict';
// Committee #39 — one read-only view of what a site owes (commitments + handoffs + actions + report
// follow-ups): site scope, an action linked to a commitment shown once, registers switched off reported.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'obligations-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'ob-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ob-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ob-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, hounde, mana, T = {}, actionId, actionId2;
before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'handoffs'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /^mana$/i.test(s.name)).id;
  const mk = async (k, roles, site) => { const u = 'ob_' + k; try { await rdb.createUser({ username: u, full_name: 'Person ' + k, password: u + 'pass1234', roles, site_id: site }); } catch {} T[k] = (await rdb.login(u, u + 'pass1234')).token; };
  await mk('edH', ['editor'], hounde); await mk('recv', ['viewer'], hounde); await mk('edM', ['editor'], mana); await mk('admin', ['admin']);
  const mdb = require('../meetings-db');
  const hm = await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'mining', meeting_date: '2026-10-05', status: 'draft' },
    actions: [{ description: 'Replace the plant switch', status: 'open', owner_it: 'ob_edH', target_date: '2026-10-10' }, { description: 'Label the patch panel', status: 'open', owner_it: 'ob_edH' }] }, null, null);
  const full = await mdb.getMeeting(hm.id); actionId = full.actions[0].id; actionId2 = full.actions[1].id;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const get = async (t, site) => { const r = await send('GET', `/api/obligations?site=${site}`, t); return { status: r.status, body: await r.json() }; };

test('flags off: only the actions are read, the other registers are reported as not read', async () => {
  const r = await get(T.edH, hounde);
  assert.equal(r.status, 200); assert.equal(r.body.registers.commitments, null); assert.equal(r.body.registers.handoffs, null);
  const mine = r.body.items.filter((x) => x.register === 'meetings_action');
  assert.equal(mine.length, 2); assert.ok(mine.find((x) => x.title === 'Replace the plant switch').overdue, 'past due = overdue');
  assert.equal((await get(T.edM, hounde)).status, 403, 'another site');
  assert.equal((await get(T.edH, 'x')).status, 400);
  assert.equal((await get(T.admin, hounde)).status, 200, 'admin tier: any site');
});

test('flags on: commitments and handoffs join, an action under a commitment is shown once', async () => {
  await require('../services/reportConfig').setConfig(rdb.db, { commitments_enabled: '1', handoffs_enabled: '1' }, 'test');
  const c = await send('POST', '/api/commitments', T.edH, { kind: 'corrective_action', title: 'Plant switch replacement', site_id: hounde, source: { system: 'meetings', id: String(actionId) } });
  assert.equal(c.status, 201, await c.text());
  const depts = (await rdb.listDepartments()).map((d) => d.name);
  const h = await send('POST', '/api/handoffs', T.edH, { title: 'Open the plant cabinet', site_id: hounde, from_department: depts[0], to_department: depts[1], receiver: 'ob_recv', due_date: '2099-01-01' });
  assert.equal(h.status, 201, await h.text());
  const r = await get(T.edH, hounde);
  assert.equal(r.body.registers.commitments, 'read'); assert.equal(r.body.registers.handoffs, 'read');
  const cm = r.body.items.find((x) => x.register === 'commitment');
  assert.ok(cm); assert.ok(cm.sources.some((s) => s.title === 'Replace the plant switch'), 'the action is listed under its commitment');
  assert.ok(!r.body.items.some((x) => x.register === 'meetings_action' && x.title === 'Replace the plant switch'), 'not twice');
  assert.ok(r.body.items.some((x) => x.register === 'meetings_action' && x.title === 'Label the patch panel'));
  const ho = r.body.items.find((x) => x.register === 'handoff');
  assert.equal(ho.owner, 'Person recv'); assert.equal(ho.link, `handoffs.html?id=${ho.id}`);
  assert.equal(r.body.totals.open, r.body.items.length);
  assert.ok(!(await get(T.edM, mana)).body.items.some((x) => x.register === 'handoff'), 'Mana sees nothing of Hounde');
  void actionId2;
});

test('handoffs.commitment_ledger: a new handoff is recorded as a commitment and shown once, under it', async () => {
  const depts = (await rdb.listDepartments()).map((d) => d.name);
  const body = { title: 'Move the plant printer', site_id: hounde, from_department: depts[0], to_department: depts[1], receiver: 'ob_recv', due_date: '2099-02-01' };
  let h = await (await send('POST', '/api/handoffs', T.edH, body)).json();
  assert.equal(h.handoff.commitment_id, null, 'switch off = separate registers, as before');
  const pol = await send('PUT', '/api/governance/policies', T.admin, { scope: `site:${hounde}`, key: 'handoffs.commitment_ledger', value: true, reason: 'one ledger for Hounde' });
  assert.equal(pol.status, 200);
  h = await (await send('POST', '/api/handoffs', T.edH, { ...body, title: 'Move the plant scanner' })).json();
  const cid = h.handoff.commitment_id; assert.ok(cid, 'linked to a commitment');
  const c = await (await send('GET', `/api/commitments/${cid}`, T.edH)).json();
  assert.equal(c.commitment.accountable_owner, 'ob_recv'); assert.match(c.commitment.title, /Move the plant scanner/);
  assert.ok(h.handoff.events.some((e) => e.action === 'ledger_linked'));
  const r = await get(T.edH, hounde);
  const cm = r.body.items.find((x) => x.register === 'commitment' && x.id === cid);
  assert.ok(cm.sources.some((s) => s.register === 'handoff' && s.title === 'Move the plant scanner'));
  assert.ok(!r.body.items.some((x) => x.register === 'handoff' && x.title === 'Move the plant scanner'), 'not twice');
  assert.ok(r.body.items.some((x) => x.register === 'handoff' && x.title === 'Move the plant printer'), 'the earlier one stays a handoff');
});
