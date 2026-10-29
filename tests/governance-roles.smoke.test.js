'use strict';
const R = require('../services/governanceRoles');
// ADR-006 (committee #34 #36 #38) end to end: roles, deputies and the escalation matrix are DATA.
//   • who may change them (super_admin for authority, admin tier for deputies), every change in a
//     hash-chained append-only history;
//   • a deputy acts IN THE NAME of an absent receiver (event acting_for) and never verifies the work of the
//     person they replace;
//   • an account-less receiver only under handoffs.proxy_accept, with a note on every step;
//   • an overdue handoff reaches the matrix target (and their deputy), the next level once, and a rule
//     whose role nobody holds is reported as a gap (job result + oversight register).
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'roles-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'gr-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'gr-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'gr-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, hounde, mana, P = {}, ID = {}, depts;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'deputies'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /^mana$/i.test(s.name)).id;
  const mk = async (k, roles, site) => { const u = 'gr_' + k; try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); } catch {} P[k] = (await rdb.login(u, u + 'pass1234')).token; ID[k] = Number((await rdb.db.prepare('SELECT id FROM users WHERE username=?').get(u)).id); };
  await mk('itlead', ['editor'], hounde);      // requester
  await mk('plant', ['viewer'], hounde);       // receiver, goes on leave
  await mk('deputy', ['viewer'], hounde);      // stands in for plant
  await mk('coord', ['editor'], hounde);       // coordinator recording for an account-less department head
  await mk('target', ['editor'], hounde);      // site escalation target
  await mk('targetdep', ['editor'], hounde);   // the target's deputy
  await mk('group', ['admin']);                // group service manager (second level)
  await mk('mana', ['editor'], mana);
  await mk('viewer', ['viewer'], hounde);
  await mk('committee', ['viewer', 'committee-member'], hounde);
  await mk('admin', ['admin']);
  await mk('super', ['super_admin']); await mk('super2', ['super_admin']);
  depts = (await rdb.listDepartments()).map((d) => d.name);
  await require('../services/reportConfig').setConfig(rdb.db, { handoffs_enabled: '1' }, 'test');
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const json = async (r) => ({ status: r.status, body: await r.json() });
const today = () => new Date().toISOString().slice(0, 10);
const plus = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const mkBody = (o) => ({ title: 'Replace the badge reader at the plant gate', site_id: hounde, from_department: depts[0], to_department: depts[1], receiver: 'gr_plant', due_date: '2099-12-31', ...o });
const go = async (t, id, to, version, reason) => json(await send('POST', `/api/handoffs/${id}/transition`, t, { to, version, reason }));

test('who may change roles, deputies and the matrix', async () => {
  // security review: a committee member reads the roles but not everybody's site list
  const cm = await json(await send('GET', '/api/governance/roles', P.committee));
  assert.equal(cm.status, 200); assert.ok(cm.body.people.length > 0);
  assert.ok(cm.body.people.every((x) => x.sites === undefined), 'names only for the committee');
  assert.ok((await json(await send('GET', '/api/governance/roles', P.admin))).body.people.some((x) => Array.isArray(x.sites)));
  assert.equal((await send('GET', '/api/governance/roles', P.viewer)).status, 403);
  const v = (await json(await send('GET', '/api/governance/roles', P.admin))).body;
  assert.equal(v.ok, true); assert.equal(v.can_write_roles, false); assert.equal(v.can_write_deputies, true);
  assert.ok(v.roles['handoffs.escalation_target']);
  assert.ok(v.gaps.some((g) => g.kind === 'role' && g.site_id === hounde && g.role === 'handoffs.escalation_target'), 'empty tables = every required role is a gap');
  const asg = { role: 'handoffs.escalation_target', site_id: hounde, user_id: ID.target, effective_from: today(), reason: 'site IT lead receives overdue handoffs' };
  assert.equal((await send('POST', '/api/governance/roles/assignments', P.admin, asg)).status, 403, 'authority is a super_admin decision');
  assert.equal((await send('POST', '/api/governance/roles/assignments', P.super, { ...asg, role: 'nope' })).status, 400);
  assert.equal((await send('POST', '/api/governance/roles/assignments', P.super, { ...asg, reason: '' })).status, 400, 'a reason is required');
  assert.equal((await send('POST', '/api/governance/roles/assignments', P.super, asg)).status, 201);
  assert.equal((await send('POST', '/api/governance/roles/deputies', P.viewer, { user_id: ID.plant, deputy_id: ID.deputy, start_date: today(), end_date: plus(10), reason: 'annual leave' })).status, 403);
  assert.equal((await send('POST', '/api/governance/roles/deputies', P.admin, { user_id: ID.plant, deputy_id: ID.plant, start_date: today(), end_date: plus(10), reason: 'annual leave' })).status, 400, 'not your own deputy');
  assert.equal((await send('POST', '/api/governance/roles/deputies', P.admin, { user_id: ID.plant, deputy_id: ID.mana, start_date: today(), end_date: plus(10), reason: 'annual leave' })).status, 400, 'a deputy works on the same site');
  assert.equal((await send('POST', '/api/governance/roles/deputies', P.admin, { user_id: ID.plant, deputy_id: ID.deputy, start_date: today(), end_date: plus(400), reason: 'annual leave' })).status, 400, 'bounded duration');
  assert.equal((await send('POST', '/api/governance/roles/deputies', P.admin, { user_id: ID.plant, deputy_id: ID.admin, start_date: today(), end_date: plus(10), reason: 'annual leave' })).status, 403, 'an administrator never names themselves');
  assert.equal((await send('POST', '/api/governance/roles/deputies', P.admin, { user_id: ID.group, deputy_id: ID.super, start_date: today(), end_date: plus(10), reason: 'annual leave' })).status, 403, 'an administrator\'s deputy is a super_admin decision');
  const d = await json(await send('POST', '/api/governance/roles/deputies', P.admin, { user_id: ID.plant, deputy_id: ID.deputy, start_date: today(), end_date: plus(10), reason: 'annual leave' }));
  assert.equal(d.status, 201); ID.dep = d.body.id;
  const ev = (await json(await send('GET', '/api/governance/roles/events', P.admin))).body.events;
  assert.ok(ev.some((e) => e.action === 'assigned') && ev.some((e) => e.action === 'named'), 'history written');
  await assert.rejects(async () => rdb.db.prepare("UPDATE governance_role_events SET action='x'").run(), /append-only/);
  const chain = (await json(await send('GET', '/api/governance/audit-chain', P.admin))).body;
  assert.equal(chain.tables.find((t) => t.table === 'governance_role_events').ok, true, 'hash-chained');
});

test('a deputy acts in the name of the absent receiver, never verifies the work of the person they replace', async () => {
  const c = await json(await send('POST', '/api/handoffs', P.itlead, mkBody()));
  assert.equal(c.status, 201); let h = c.body.handoff;
  // the deputy sees it (list + detail) although they are neither requester nor receiver
  const list = (await json(await send('GET', '/api/handoffs', P.deputy))).body.handoffs;
  assert.ok(list.some((x) => x.id === h.id));
  const det = (await json(await send('GET', `/api/handoffs/${h.id}`, P.deputy))).body.handoff;
  assert.ok(det.allowed.some((a) => a.to === 'accepted')); assert.equal(det.acting_for, `deputy_for:${ID.plant}`);
  let r = await go(P.deputy, h.id, 'accepted', h.version); assert.equal(r.status, 200); h = r.body.handoff;
  const e = h.events.find((x) => x.to_status === 'accepted');
  assert.equal(e.actor_id, ID.deputy); assert.equal(e.details.acting_for, `deputy_for:${ID.plant}`);
  h = (await go(P.plant, h.id, 'delivered', h.version)).body.handoff;
  // the requester names the deputy as THEIR deputy too: verifying the absent receiver's work is still refused
  const d2 = await json(await send('POST', '/api/governance/roles/deputies', P.admin, { user_id: ID.itlead, deputy_id: ID.deputy, start_date: today(), end_date: plus(5), reason: 'training week' }));
  assert.equal(d2.status, 201);
  r = await go(P.deputy, h.id, 'verified', h.version); assert.equal(r.status, 403); assert.match(String(r.body.error), /stand in for the person who delivered/);
  assert.equal((await send('POST', `/api/governance/roles/deputies/${d2.body.id}/revoke`, P.admin, { reason: 'training cancelled' })).status, 200);
  // once the leave ends (revoked), the deputy is a bystander again
  assert.equal((await send('POST', `/api/governance/roles/deputies/${ID.dep}/revoke`, P.admin, { reason: 'back from leave' })).status, 200);
  assert.equal((await send('GET', `/api/handoffs/${h.id}`, P.deputy)).status, 200, 'same site: still visible as a colleague');
  const after = (await json(await send('GET', `/api/handoffs/${h.id}`, P.deputy))).body.handoff;
  assert.equal(after.allowed.length, 0, 'no longer acts for anyone');
});

test('account-less receiver only under handoffs.proxy_accept, with a note on every step', async () => {
  const body = mkBody({ receiver: 'gr_coord', receiver_contact: 'Chef maintenance (sans compte)' });
  let r = await json(await send('POST', '/api/handoffs', P.itlead, body));
  assert.equal(r.status, 403, 'policy off by default = the behaviour until now');
  const pr = await send('PUT', '/api/governance/policies', P.super, { scope: `site:${hounde}`, key: 'handoffs.proxy_accept', value: true, reason: 'department heads at Hounde have no account' });
  assert.equal(pr.status, 202, 'relaxing a protected rule is a two-person proposal');
  const prop = (await pr.json()).pending;
  assert.equal((await send('POST', `/api/governance/policies/proposals/${prop.id}/approve`, P.super2, { reason: 'agreed for the plant departments' })).status, 200);
  r = await json(await send('POST', '/api/handoffs', P.itlead, body));
  assert.equal(r.status, 201); let h = r.body.handoff;
  assert.equal(h.receiver_contact, 'Chef maintenance (sans compte)');
  assert.equal((await go(P.coord, h.id, 'accepted', h.version)).status, 400, 'a note is required on behalf of the contact');
  r = await go(P.coord, h.id, 'accepted', h.version, 'agreed by phone with the maintenance head, 10:30'); assert.equal(r.status, 200);
  const e = r.body.handoff.events.find((x) => x.to_status === 'accepted');
  assert.equal(e.details.on_behalf_of_contact, 'Chef maintenance (sans compte)');
  assert.equal(r.body.handoff.requested_by, ID.itlead);
  // Mana keeps the default: refused there
  const m = await json(await send('POST', '/api/handoffs', P.mana, { ...body, site_id: mana, receiver: 'gr_mana' }));
  assert.equal(m.status, 403);
});

test('an overdue handoff reaches the matrix target and their deputy, the next level once, gaps reported', async () => {
  const route = require('../services/escalationRouting');
  const store = require('../routes/handoffs').createStore(rdb);
  const roles = require('../routes/governanceRoles').createStore(rdb);
  const GP = require('../services/governancePolicy');
  const sent = [];
  const run = () => route.routeHandoffEscalations({ hoStore: store, rolesStore: roles, policyFor: (siteId) => GP.forContext({ siteId }), notify: async (n) => { sent.push(n); }, notifyEnabled: true });
  const c = await json(await send('POST', '/api/handoffs', P.itlead, mkBody({ title: 'Overdue cabling job' })));
  const hid = c.body.handoff.id;
  await rdb.db.prepare('UPDATE handoffs SET due_date=? WHERE id=?').run(plus(-5), hid);
  // level 1: site target after 0 days; the target is away → their deputy is told too
  assert.equal((await send('POST', '/api/governance/roles/matrix', P.super, { register: 'handoffs', severity: '*', site_id: hounde, after_days: 0, role: 'handoffs.escalation_target', reason: 'site level first' })).status, 201);
  assert.equal((await send('POST', '/api/governance/roles/deputies', P.admin, { user_id: ID.target, deputy_id: ID.targetdep, start_date: today(), end_date: plus(3), reason: 'site visit to Mana' })).status, 403, 'a role holder\'s deputy is a super_admin decision');
  assert.equal((await send('POST', '/api/governance/roles/deputies', P.super, { user_id: ID.target, deputy_id: ID.targetdep, start_date: today(), end_date: plus(3), reason: 'site visit to Mana' })).status, 201);
  let out = await run();
  const mine = () => sent.filter((n) => n.sourceRef === String(hid)).map((n) => n.userId).sort((a, b) => a - b);
  assert.ok(out.escalated >= 1);
  assert.deepEqual(mine(), [ID.target, ID.targetdep].sort((a, b) => a - b));
  let h = (await json(await send('GET', `/api/handoffs/${hid}`, P.itlead))).body.handoff;
  const ev = h.events.find((x) => x.action === 'escalated_overdue');
  assert.equal(ev.details.escalated_to_role, 'handoffs.escalation_target'); assert.deepEqual(ev.details.escalated_to.slice().sort((a, b) => a - b), [ID.target, ID.targetdep].sort((a, b) => a - b));
  // level 2 after 3 days, platform-wide: the group manager is told once, not at every run
  assert.equal((await send('POST', '/api/governance/roles/matrix', P.super, { register: 'handoffs', severity: '*', site_id: null, after_days: 3, role: 'handoffs.group_escalation', reason: 'group after three days' })).status, 201);
  await send('POST', '/api/governance/roles/assignments', P.super, { role: 'handoffs.group_escalation', site_id: null, user_id: ID.group, effective_from: today(), reason: 'group service manager' });
  sent.length = 0; out = await run();
  // the site row (after 0) is preferred over a platform row: the second level must be a SITE row too
  assert.equal(mine().length, 0, 'site rules win over platform rules');
  assert.equal((await send('POST', '/api/governance/roles/matrix', P.super, { register: 'handoffs', severity: '*', site_id: hounde, after_days: 3, role: 'handoffs.group_escalation', reason: 'group after three days at Hounde' })).status, 201);
  sent.length = 0; out = await run();
  assert.deepEqual(mine(), [ID.group]); assert.ok(out.levels >= 1);
  sent.length = 0; await run(); assert.equal(mine().length, 0, 'each level once');
  h = (await json(await send('GET', `/api/handoffs/${hid}`, P.itlead))).body.handoff;
  assert.equal(h.events.filter((x) => x.action === 'escalation_level').length, 1);
  // a rule whose role nobody holds: reported, and listed in the oversight register
  assert.equal((await send('POST', '/api/governance/roles/matrix', P.super, { register: 'handoffs', severity: '*', site_id: mana, after_days: 0, role: 'handoffs.escalation_target', reason: 'Mana has no target yet' })).status, 201);
  const mc = await json(await send('POST', '/api/handoffs', P.mana, { ...mkBody({ site_id: mana, receiver: 'gr_group', title: 'Mana overdue job' }) }));
  assert.equal(mc.status, 201);
  await rdb.db.prepare('UPDATE handoffs SET due_date=? WHERE id=?').run(plus(-2), mc.body.handoff.id);
  out = await run();
  assert.ok(out.gaps.some((g) => g.site_id === mana && g.role === 'handoffs.escalation_target'));
  const ov = (await json(await send('GET', '/api/governance/oversight', P.admin))).body;
  assert.ok(ov.role_gaps.some((g) => g.kind === 'matrix' && g.site_id === mana));
  const csv = await (await send('GET', '/api/governance/oversight?format=csv', P.admin)).text();
  assert.match(csv, /role_gap/);
});

test('calendar: a shutdown day keeps an overdue handoff inside its grace; admin tier only; history kept', async () => {
  const GP = require('../services/governancePolicy');
  assert.equal((await send('POST', '/api/governance/roles/calendar', P.viewer, { day: plus(-1), site_id: mana, label: 'Plant shutdown' })).status, 403);
  assert.equal((await send('POST', '/api/governance/roles/calendar', P.admin, { day: 'tomorrow', site_id: mana, label: 'Plant shutdown' })).status, 400);
  const store = require('../routes/handoffs').createStore(rdb);
  const c = await json(await send('POST', '/api/handoffs', P.mana, { ...mkBody({ site_id: mana, receiver: 'gr_group', title: 'Calendar job' }) }));
  await rdb.db.prepare('UPDATE handoffs SET due_date=? WHERE id=?').run(plus(-1), c.body.handoff.id);
  // grace of 0 working days: yesterday's due date is overdue today — unless today is a Mana shutdown day
  const r = await json(await send('POST', '/api/governance/roles/calendar', P.admin, { day: today(), site_id: mana, label: 'Plant shutdown', kind: 'shutdown', reason: 'mill relining week' }));
  assert.equal(r.status, 201);
  assert.equal((await send('POST', '/api/governance/roles/calendar', P.admin, { day: today(), site_id: mana, label: 'Plant shutdown', reason: 'mill relining week' })).status, 409, 'once per day and site');
  // security review: a reason, a real site, platform-wide days for super_admin only, a yearly cap for the admin tier
  assert.equal((await send('POST', '/api/governance/roles/calendar', P.admin, { day: plus(1), site_id: mana, label: 'Plant shutdown' })).status, 400, 'reason required');
  assert.equal((await send('POST', '/api/governance/roles/calendar', P.admin, { day: plus(1), site_id: 'abc', label: 'Plant shutdown', reason: 'mill relining week' })).status, 400, 'not a site id');
  assert.equal((await send('POST', '/api/governance/roles/calendar', P.admin, { day: plus(1), site_id: 999999, label: 'Plant shutdown', reason: 'mill relining week' })).status, 400, 'unknown site');
  assert.equal((await send('POST', '/api/governance/roles/calendar', P.admin, { day: plus(1), site_id: null, label: 'National day', reason: 'public holiday' })).status, 403, 'platform-wide = super_admin');
  const y = '2031'; let last;
  for (let i = 1; i <= R.CALENDAR_MAX_DAYS_PER_YEAR + 1; i++) last = (await send('POST', '/api/governance/roles/calendar', P.admin, { day: `${y}-03-${String(i).padStart(2, '0')}`, site_id: hounde, label: 'Long shutdown', reason: 'planned shutdown' })).status;
  assert.equal(last, 409, 'yearly cap for the admin tier');
  assert.equal((await send('POST', '/api/governance/roles/calendar', P.super, { day: `${y}-04-01`, site_id: hounde, label: 'Long shutdown', reason: 'planned shutdown, approved' })).status, 201, 'super_admin may go beyond');
  let out = await store.escalateOverdue({ policyFor: (siteId) => GP.forContext({ siteId }) });
  assert.ok(!out.some((h) => h.id === c.body.handoff.id), 'a shutdown day does not count');
  assert.equal((await send('POST', `/api/governance/roles/calendar/${r.body.id}/remove`, P.admin, { reason: 'shutdown cancelled' })).status, 200);
  out = await store.escalateOverdue({ policyFor: (siteId) => GP.forContext({ siteId }) });
  assert.ok(out.some((h) => h.id === c.body.handoff.id), 'once removed, the day counts again');
  const ev = (await json(await send('GET', '/api/governance/roles/events', P.admin))).body.events;
  assert.ok(ev.some((e) => e.entity === 'calendar' && e.action === 'removed'));
});

test('commitments: the holder of commitments.reviewer verifies an unnamed commitment; nobody else on the site', async () => {
  await require('../services/reportConfig').setConfig(rdb.db, { commitments_enabled: '1' }, 'test');
  const c = await json(await send('POST', '/api/commitments', P.itlead, { kind: 'corrective_action', title: 'Replace the gate UPS battery', site_id: hounde, source: { system: 'governance', id: 'g-1' } }));
  let cid = c.body.commitment && c.body.commitment.id;
  if (c.status !== 201) {   // an editor cannot create from an unverifiable source (committee #47): the admin does
    const a = await json(await send('POST', '/api/commitments', P.admin, { kind: 'corrective_action', title: 'Replace the gate UPS battery', site_id: hounde, source: { system: 'governance', id: 'g-1' } }));
    assert.equal(a.status, 201, JSON.stringify(a.body)); cid = a.body.commitment.id;
  }
  await rdb.db.prepare("UPDATE commitments SET status='awaiting_verification', reviewer=NULL WHERE id=?").run(cid);
  const allowed = async (t) => ((await json(await send('GET', `/api/commitments/${cid}`, t))).body.commitment.allowed || []).map((x) => x.to || x);
  assert.ok(!(await allowed(P.target)).includes('verified_closed'), 'no role yet');
  assert.equal((await send('POST', '/api/governance/roles/assignments', P.super, { role: 'commitments.reviewer', site_id: hounde, user_id: ID.target, effective_from: today(), reason: 'site IT lead verifies closures' })).status, 201);
  assert.ok((await allowed(P.target)).includes('verified_closed'), 'the role holder verifies');
  assert.ok(!(await allowed(P.coord)).includes('verified_closed'), 'another editor of the site does not');
});

test('meetings: the minutes acceptor role and the chair\'s deputy, never accepting what the person they replace recorded', async () => {
  const c = await json(await send('PUT', '/api/governance/cadences', P.super, { key: 'hgo-roles', name: 'HGO roles', kind: 'site_weekly', site_id: hounde, chair_id: ID.itlead }));
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const s = await json(await send('POST', `/api/governance/cadences/${c.body.cadence.id}/sessions`, P.itlead, { scheduled_at: new Date().toISOString() }));
  const sid = s.body.session.id;
  assert.equal((await send('POST', `/api/governance/sessions/${sid}/start`, P.itlead)).status, 200);
  assert.equal((await send('POST', `/api/governance/sessions/${sid}/close`, P.itlead)).status, 200);
  const can = async (t) => (await json(await send('GET', `/api/governance/sessions/${sid}`, t))).body;
  assert.equal((await can(P.target)).can_decide, false, 'a site editor does not accept minutes');
  assert.equal((await send('POST', '/api/governance/roles/assignments', P.super, { role: 'meetings.minutes_acceptor', site_id: hounde, user_id: ID.target, effective_from: today(), reason: 'second pair of eyes for the site minutes' })).status, 201);
  const v = await can(P.target); assert.equal(v.can_decide, true); assert.ok(v.session.allowed.includes('accept'));
  // the chair's deputy may run the session but not accept minutes the chair recorded
  assert.equal((await send('POST', '/api/governance/roles/deputies', P.super, { user_id: ID.itlead, deputy_id: ID.coord, start_date: today(), end_date: plus(3), reason: 'chair on leave' })).status, 201);
  const d = await can(P.coord); assert.equal(d.can_run, true); assert.ok(!d.session.allowed.includes('accept'), 'stands in for the recorder');
  assert.equal((await send('POST', `/api/governance/sessions/${sid}/accept`, P.coord)).status, 403);
  assert.equal((await send('POST', `/api/governance/sessions/${sid}/accept`, P.target)).status, 200);
});
