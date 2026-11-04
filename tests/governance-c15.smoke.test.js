'use strict';
const fetch = require('./_http-fetch');
// C-15 (G23) — governance cockpit: decision source links + engagement delays.
const _os = require('os'), _fs = require('fs'), _path = require('path');
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'gov-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'gov-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'gov-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'gov-smoke-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
// C-15 (G23) — decisions carry their source (session / PV) links; the cockpit shows engagement delays
// (days overdue + ageing) for open decisions and open session actions. Null = unknown, never 0.
let server, base, admin, member, editor, otherEditor, hounde, rdb;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 50; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'meeting_cadences'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = (await rdb.listSites({ includeInactive: true }));
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; const mana = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, role, roles, site) => { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', role, roles, site_id: site }); } catch {} return (await rdb.login(u, u + 'pass1234')).token; };
  admin = await mk('c15_admin', 'admin', ['admin']);
  member = await mk('c15_member', 'viewer', ['viewer', 'committee-member']);
  editor = await mk('c15_editor', 'editor', ['editor'], hounde); otherEditor = await mk('c15_other', 'editor', ['editor'], mana);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const H = (t, extra) => ({ headers: Object.assign(t ? { 'x-report-token': t } : {}, extra || {}) });
const get = (p, t) => fetch(base + p, H(t));
const send = (m, p, t, body) => fetch(base + p, { method: m, ...H(t, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
const past = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
let sessId, decLate, decPv, decNoDue;

test('setup: an HGO cadence, a session, three decisions and two actions', async () => {
  const c = await (await send('PUT', '/api/governance/cadences', member, { key: 'c15-hgo', name: 'C15 HGO weekly', kind: 'site_weekly', site_id: hounde })).json(); assert.equal(c.ok, true);
  const s = await (await send('POST', `/api/governance/cadences/${c.cadence.id}/sessions`, member, { scheduled_at: '2026-10-20T09:00:00Z' })).json(); assert.equal(s.ok, true); sessId = s.session.id;
  assert.equal((await send('POST', `/api/governance/sessions/${sessId}/start`, member)).status, 200);
  decLate = (await (await send('POST', `/api/governance/sessions/${sessId}/decisions`, admin, { title: 'Late one', due_date: past(12) })).json()).decision;
  decPv = (await (await send('POST', `/api/governance/sessions/${sessId}/decisions`, admin, { title: 'From a PV', source_kind: 'pv', source_ref: '42', due_date: past(-30) })).json()).decision;
  decNoDue = (await (await send('POST', `/api/governance/sessions/${sessId}/decisions`, admin, { title: 'No due date' })).json()).decision;
  assert.ok(decLate && decPv && decNoDue);
  assert.equal((await send('POST', `/api/governance/sessions/${sessId}/actions`, member, { title: 'Very late action', due_date: past(120) })).status, 200);
  assert.equal((await send('POST', `/api/governance/sessions/${sessId}/actions`, member, { title: 'Action no due' })).status, 200);
});

test('GET /decisions: every decision carries source_links to its session (and its PV when named)', async () => {
  const j = await (await get('/api/governance/decisions?status=open,in_progress', editor)).json(); assert.equal(j.ok, true);
  const by = (ref) => j.decisions.find((d) => d.ref === ref);
  for (const d of [decLate, decPv, decNoDue]) {
    const row = by(d.ref); assert.ok(row, d.ref);
    assert.ok(Array.isArray(row.source_links));
    assert.deepEqual(row.source_links[0], { kind: 'session', label: 'Session 2026-10-20 · C15 HGO weekly', href: `cockpit.html?session=${sessId}` });
  }
  assert.deepEqual(by(decPv.ref).source_links[1], { kind: 'pv', label: 'PV 42', href: 'meeting.html?id=42' });
});

test('GET /engagement-delays: 401 anonymous; days overdue + ageing; unknown due date is null, never 0; site scope', async () => {
  assert.equal((await get('/api/governance/engagement-delays')).status, 401);
  const j = await (await get('/api/governance/engagement-delays', editor)).json(); assert.equal(j.ok, true);
  const mine = j.items.filter((i) => i.session_id === sessId);
  const it = (t) => mine.find((i) => i.title === t);
  assert.equal(it('Late one').days_overdue, 12); assert.equal(it('Late one').kind, 'decision'); assert.equal(it('Late one').bucket, 'd8_30');
  assert.equal(it('Late one').href, `cockpit.html?session=${sessId}`);
  assert.equal(it('From a PV').days_overdue, 0); assert.equal(it('From a PV').bucket, 'on_time');
  assert.equal(it('No due date').days_overdue, null); assert.equal(it('No due date').bucket, 'unknown');
  assert.equal(it('Very late action').days_overdue, 120); assert.equal(it('Very late action').kind, 'action'); assert.equal(it('Very late action').bucket, 'd90_plus');
  assert.equal(it('Action no due').days_overdue, null);
  assert.ok(j.summary.max_days_overdue >= 120); assert.ok(j.summary.buckets.unknown >= 2); assert.ok(j.summary.overdue >= 2);
  assert.equal(j.compliance_href, 'meetings-compliance.html');
  const o = await (await get('/api/governance/engagement-delays', otherEditor)).json();
  assert.ok(!o.items.some((i) => i.session_id === sessId), 'HGO items invisible to the Mana editor');
});

test('cockpit.html renders the source links and the engagement-delays panel', async () => {
  const html = await (await get('/cockpit.html', editor)).text();
  assert.ok(html.includes('/api/governance/engagement-delays'), 'cockpit fetches the delays');
  assert.ok(html.includes('id="delays"'), 'delays panel present');
  assert.ok(html.includes('source_links'), 'decision table renders the source links');
  assert.ok(html.includes('meetings-compliance.html'), 'links to the 5 Engagements monitor');
});
