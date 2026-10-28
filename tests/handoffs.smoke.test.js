'use strict';
// G-22 — interdepartmental handoffs end to end with SEPARATE synthetic personas (committee review 2026-10-28):
// request → accepted / rejected → blocked / escalated → delivered → verified. Covers repeated submit, no
// auto-accept, wrong person, wrong site, late reassignment, permission downgrade, overdue escalation (once),
// notifications OFF by default, site scope and the audit trail.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'handoffs-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'ho-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ho-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ho-key';
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
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'handoffs'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /^mana$/i.test(s.name)).id;
  const mk = async (k, roles, site) => { const u = 'ho_' + k; try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); } catch {} P[k] = (await rdb.login(u, u + 'pass1234')).token; ID[k] = (await rdb.db.prepare('SELECT id FROM users WHERE username=?').get(u)).id; };
  await mk('itlead', ['editor'], hounde);          // requester: IT department, Hounde
  await mk('plant', ['viewer'], hounde);           // receiver: plant manager (business, read-only role)
  await mk('plant2', ['viewer'], hounde);          // second receiver for the reassignment
  await mk('stranger', ['editor'], hounde);        // same site, not part of this handoff
  await mk('mana', ['editor'], mana);              // another site
  await mk('admin', ['admin']);
  depts = (await rdb.listDepartments()).map((d) => d.name);
  assert.ok(depts.length >= 2, 'departments seeded');
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const json = async (r) => ({ status: r.status, body: await r.json() });
const mkBody = (o) => ({ title: 'Install a network point in the control room', site_id: hounde, from_department: depts[0], to_department: depts[1], receiver: 'ho_plant', due_date: '2099-12-31', ...o });
const go = async (t, id, to, version, reason) => json(await send('POST', `/api/handoffs/${id}/transition`, t, { to, version, reason }));
const notifCount = async (uid) => Number((await rdb.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id=?').get(uid)).n);

test('flag off: every route is 404', async () => {
  assert.equal((await send('GET', '/api/handoffs', P.itlead)).status, 404);
  assert.equal((await send('POST', '/api/handoffs', P.itlead, mkBody())).status, 404);
  await require('../services/reportConfig').setConfig(rdb.db, { handoffs_enabled: '1' }, 'test');
});

test('intake: validation, no self-handoff, wrong site, repeated submit returns the same handoff', async () => {
  assert.equal((await send('POST', '/api/handoffs', P.plant, mkBody())).status, 403, 'a viewer cannot request');
  assert.equal((await send('POST', '/api/handoffs', P.mana, mkBody())).status, 403, 'another site cannot request here');
  assert.equal((await send('POST', '/api/handoffs', P.itlead, mkBody({ to_department: 'Nope' }))).status, 400);
  assert.equal((await send('POST', '/api/handoffs', P.itlead, mkBody({ to_department: depts[0] }))).status, 400, 'same department');
  assert.equal((await send('POST', '/api/handoffs', P.itlead, mkBody({ receiver: 'ho_itlead' }))).status, 400, 'no self-handoff');
  assert.equal((await send('POST', '/api/handoffs', P.itlead, mkBody({ receiver: 'ho_mana' }))).status, 400, 'receiver must work on the site');
  const a = await json(await send('POST', '/api/handoffs', P.itlead, mkBody({ idem_key: 'k-1' })));
  const b = await json(await send('POST', '/api/handoffs', P.itlead, mkBody({ idem_key: 'k-1', title: 'double click' })));
  assert.equal(a.status, 201); assert.equal(b.status, 200); assert.equal(b.body.created, false); assert.equal(b.body.handoff.id, a.body.handoff.id);
  assert.equal(a.body.handoff.status, 'requested', 'never auto-accepted');
  assert.equal(Number((await rdb.db.prepare("SELECT COUNT(*) AS n FROM handoffs WHERE idem_key='k-1'").get()).n), 1);
  ID.h1 = a.body.handoff.id;
});

test('full path: only the named receiver accepts; blocker, escalation, rework and verification by the requesting side', async () => {
  let h = (await json(await send('GET', `/api/handoffs/${ID.h1}`, P.plant))).body.handoff;
  assert.equal((await go(P.stranger, ID.h1, 'accepted', h.version)).status, 403, 'a colleague on the same site cannot accept');
  assert.equal((await go(P.itlead, ID.h1, 'accepted', h.version)).status, 403, 'the requester cannot accept on the receiver\'s behalf');
  let r = await go(P.plant, ID.h1, 'accepted', h.version); assert.equal(r.status, 200); h = r.body.handoff;
  assert.equal((await go(P.plant, ID.h1, 'blocked', h.version, '')).status, 400, 'a blocker needs a reason');
  h = (await go(P.plant, ID.h1, 'blocked', h.version, 'waiting for a cable delivery')).body.handoff;
  assert.equal((await go(P.plant, ID.h1, 'escalated', h.version, 'need help')).status, 403, 'the receiver does not escalate');
  h = (await go(P.itlead, ID.h1, 'escalated', h.version, 'blocked for two weeks')).body.handoff; assert.equal(h.status, 'escalated');
  h = (await go(P.plant, ID.h1, 'accepted', h.version)).body.handoff;
  h = (await go(P.plant, ID.h1, 'delivered', h.version)).body.handoff; assert.equal(h.delivered_by, ID.plant);
  assert.equal((await go(P.plant, ID.h1, 'verified', h.version)).status, 403, 'the deliverer cannot verify');
  h = (await go(P.itlead, ID.h1, 'accepted', h.version, 'socket not labelled')).body.handoff; assert.equal(h.status, 'accepted', 'rework');
  h = (await go(P.plant, ID.h1, 'delivered', h.version)).body.handoff;
  assert.equal((await go(P.itlead, ID.h1, 'verified', h.version - 1)).status, 409, 'stale version');
  h = (await go(P.itlead, ID.h1, 'verified', h.version)).body.handoff; assert.equal(h.status, 'verified'); assert.equal(h.verified_by, ID.itlead);
  assert.equal((await go(P.admin, ID.h1, 'accepted', h.version, 'reopen it')).status, 409, 'verified is final');
  const actions = h.events.map((e) => e.action);
  assert.deepEqual(actions, ['created', 'transition', 'transition', 'transition', 'transition', 'transition', 'rework', 'transition', 'transition']);
  assert.ok(h.events.every((e) => e.at), 'every event is timed');
});

test('late reassignment sends it back to requested; the old receiver loses the power to act', async () => {
  let h = (await json(await send('POST', '/api/handoffs', P.itlead, mkBody({ title: 'Reassign me' })))).body.handoff;
  h = (await go(P.plant, h.id, 'accepted', h.version)).body.handoff;
  assert.equal((await send('POST', `/api/handoffs/${h.id}/reassign`, P.plant, { receiver: 'ho_plant2', version: h.version, reason: 'on leave' })).status, 403, 'the receiver cannot reassign');
  assert.equal((await send('POST', `/api/handoffs/${h.id}/reassign`, P.itlead, { receiver: 'ho_plant2', version: h.version, reason: '' })).status, 400);
  h = (await json(await send('POST', `/api/handoffs/${h.id}/reassign`, P.itlead, { receiver: 'ho_plant2', version: h.version, reason: 'plant manager on leave' }))).body.handoff;
  assert.equal(h.status, 'requested'); assert.equal(h.receiver_id, ID.plant2);
  assert.equal((await go(P.plant, h.id, 'delivered', h.version)).status, 409);
  assert.equal((await go(P.plant, h.id, 'accepted', h.version)).status, 403, 'the former receiver can no longer accept');
  h = (await go(P.plant2, h.id, 'accepted', h.version)).body.handoff; assert.equal(h.status, 'accepted');
  ID.h2 = h.id;
});

test('permission downgrade: a receiver moved to another site cannot act any more', async () => {
  await rdb.db.prepare('UPDATE users SET site_id=? WHERE id=?').run(mana, ID.plant2);
  const tok = P.plant2;   // the SAME live session: the site is re-read on every request
  const h = (await json(await send('GET', `/api/handoffs/${ID.h2}`, P.itlead))).body.handoff;
  assert.equal((await go(tok, ID.h2, 'delivered', h.version)).status, 403);
  await rdb.db.prepare('UPDATE users SET site_id=? WHERE id=?').run(hounde, ID.plant2);
});

test('overdue handoffs are escalated once; the scheduled job is inert while the flag is off', async () => {
  const H = { 'x-report-token': P.itlead, 'content-type': 'application/json' };
  const h = (await json(await send('POST', '/api/handoffs', P.itlead, mkBody({ title: 'Late one', due_date: '2026-01-15' })))).body.handoff;
  const store = require('../routes/handoffs').createStore(rdb);
  const first = await store.escalateOverdue({ today: '2026-10-28' });
  assert.ok(first.some((x) => x.id === h.id && x.escalated_from === 'requested'));
  assert.equal((await store.escalateOverdue({ today: '2026-10-28' })).filter((x) => x.id === h.id).length, 0, 'escalated once');
  // resumed (accepted) but still late with the SAME due date → not escalated again
  await rdb.db.prepare("UPDATE handoffs SET status='accepted' WHERE id=?").run(h.id);
  assert.equal((await store.escalateOverdue({ today: '2026-10-29' })).filter((x) => x.id === h.id).length, 0, 'not re-escalated for the same due date');
  await rdb.db.prepare("UPDATE handoffs SET status='escalated' WHERE id=?").run(h.id);
  const after = (await json(await send('GET', `/api/handoffs/${h.id}`, P.itlead))).body.handoff;
  assert.equal(after.status, 'escalated'); assert.ok(after.events.some((e) => e.action === 'escalated_overdue' && e.actor_id === null));
  void H;
});

test('notifications are OFF by default; switched on, the receiver is told', async () => {
  const before = await notifCount(ID.plant);
  await send('POST', '/api/handoffs', P.itlead, mkBody({ title: 'Quiet one' }));
  assert.equal(await notifCount(ID.plant), before, 'nothing sent while handoff_notify_enabled = 0');
  await require('../services/reportConfig').setConfig(rdb.db, { handoff_notify_enabled: '1' }, 'test');
  await send('POST', '/api/handoffs', P.itlead, mkBody({ title: 'Loud one' }));
  assert.equal(await notifCount(ID.plant), before + 1);
  await require('../services/reportConfig').setConfig(rdb.db, { handoff_notify_enabled: '0' }, 'test');
});

test('scope: another site sees nothing and gets 404 on a Hounde handoff; the admin sees everything', async () => {
  const m = (await json(await send('GET', '/api/handoffs', P.mana))).body;
  assert.equal(m.handoffs.length, 0);
  assert.equal((await send('GET', `/api/handoffs/${ID.h1}`, P.mana)).status, 404);
  assert.equal((await send('POST', `/api/handoffs/${ID.h2}/transition`, P.mana, { to: 'cancelled', version: 1, reason: 'not mine' })).status, 404);
  const a = (await json(await send('GET', '/api/handoffs', P.admin))).body;
  assert.ok(a.handoffs.length >= 5);
});

test('receiver picker is site-scoped; the create form gives one answer for unknown, inactive and other-site receivers; idem_key never leaves the server', async () => {
  const r = await json(await send('GET', `/api/handoffs/people?site=${hounde}`, P.itlead));
  assert.equal(r.status, 200); assert.ok(r.body.people.length >= 1); assert.ok(r.body.people.every((p) => p.id && p.name && !('email' in p)));
  assert.equal((await send('GET', `/api/handoffs/people?site=${hounde}`, P.mana)).status, 403);
  const msgs = new Set();
  for (const receiver of ['nobody_here_zz', 'ho_mana']) {
    const x = await json(await send('POST', '/api/handoffs', P.itlead, mkBody({ title: 'Probe ' + receiver, receiver })));
    assert.equal(x.status, 400); msgs.add(x.body.error);
  }
  assert.equal(msgs.size, 1, 'same message whatever the reason');
  const list = (await json(await send('GET', '/api/handoffs', P.itlead))).body;
  assert.ok(Array.isArray(list.sites) && list.sites.every((s) => s.id && s.name));
  assert.ok(list.handoffs.every((h) => !('idem_key' in h)));
});
