'use strict';
// A5 / A6 (P6) on the live router: decision motive + proposer ≠ confirmer + named pending approver; two-person soft
// delete (recoverable, in the ledger); decision cycle metric reconciled to its source rows; break-glass time-box;
// "My access" hub; identical RBAC answers for a password-minted and an SSO-minted session.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'p6-dec-'));
process.env.DASH_USER = process.env.DASH_USER || 'p6-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'p6-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'p6-key-0000000000000000000000';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfgMod, hounde, T = {}, ID = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfgMod = require('../services/reportConfig');
  for (let i = 0; i < 50; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'meeting_cadences'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  hounde = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name)).id;
  const mk = async (k, roles, site) => { const u = 'p6_' + k; try { await rdb.createUser({ username: u, full_name: 'Full ' + k, password: u + 'pass1234', roles, site_id: site }); } catch {} T[k] = (await rdb.login(u, u + 'pass1234')).token; ID[k] = Number((await rdb.db.prepare('SELECT id FROM users WHERE username=?').get(u)).id); };
  await mk('member', ['viewer', 'committee-member']); await mk('member2', ['viewer', 'committee-member']); await mk('chair', ['editor'], hounde);
  await mk('admin', ['admin']); await mk('editor', ['editor'], hounde); await mk('viewer', ['viewer'], hounde);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => { const b = body ? JSON.stringify(body) : undefined; return fetch(base + p, { method: m, headers: Object.assign(t ? { 'x-report-token': t } : {}, b ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) } : {}), body: b }); };
const J = async (r) => ({ status: r.status, body: await r.json() });
const setCfg = (patch) => cfgMod.setConfig(rdb.db, patch, 'p6-test');

async function decisionOnCadence(key, title) {
  const c = await J(await send('PUT', '/api/governance/cadences', T.member, { key, name: key, kind: 'site_weekly', site_id: hounde, chair_id: ID.chair, secretary_id: ID.editor }));
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const s = await J(await send('POST', `/api/governance/cadences/${c.body.cadence.id}/sessions`, T.chair, { scheduled_at: new Date().toISOString() }));
  assert.equal((await send('POST', `/api/governance/sessions/${s.body.session.id}/start`, T.chair)).status, 200);
  const d = await J(await send('POST', `/api/governance/sessions/${s.body.session.id}/decisions`, T.chair, { title }));
  assert.equal(d.status, 200, JSON.stringify(d.body));
  return { cadence: c.body.cadence, decision: d.body.decision };
}

test('A5 motive: off = today (no reason); on = every status change needs a reason (400), then passes', async () => {
  const { decision: d } = await decisionOnCadence('p6-motive', 'Buy a spare core switch');
  assert.equal((await send('PUT', `/api/governance/decisions/${d.id}`, T.member, { status: 'in_progress' })).status, 200, 'switch off');
  await setCfg({ decision_motive_required: '1' });
  try {
    const r = await J(await send('PUT', `/api/governance/decisions/${d.id}`, T.member, { status: 'open' }));
    assert.equal(r.status, 400); assert.equal(r.body.code, 'REASON_REQUIRED');
    assert.equal((await send('PUT', `/api/governance/decisions/${d.id}`, T.member, { status: 'open', reason: 'budget not released' })).status, 200);
    const h = await J(await send('GET', `/api/governance/decisions/${d.id}/history`, T.member));
    assert.equal(h.body.motive_required, true);
    assert.equal(h.body.events.at(-1).note, 'budget not released');
  } finally { await setCfg({ decision_motive_required: '0' }); }
});

test('A5 SoD + pending approver: the proposer is named, the cadence chair / secretary shown, and the proposer cannot confirm', async () => {
  await setCfg({ decision_lifecycle_enforced: '1' });
  try {
    const { decision: d } = await decisionOnCadence('p6-sod', 'Retire the old firewall');
    const p = await J(await send('PUT', `/api/governance/decisions/${d.id}`, T.chair, { status: 'done' }));
    assert.equal(p.status, 200); assert.equal(p.body.decision.status, 'awaiting_confirmation');
    // (a committee-member WITHOUT a site reads only group decisions — scopeIds; the admin tier reads them all)
    const list = await J(await send('GET', '/api/governance/decisions?status=awaiting_confirmation', T.admin));
    const row = list.body.decisions.find((x) => x.id === d.id);
    assert.equal(row.pending_approver.chair.name, 'Full chair'); assert.equal(row.pending_approver.secretary.name, 'Full editor');
    assert.equal(row.pending_approver.proposed_by.id, ID.chair); assert.equal(row.pending_approver.confirmed_by, 'committee');
    assert.ok(row.pending_approver.proposed_at);
    // the proposer later gains the committee role: still refused (server-side SoD)
    await rdb.setUserRoles(ID.chair, ['editor', 'committee-member']);
    const self = await J(await send('PUT', `/api/governance/decisions/${d.id}`, T.chair, { status: 'done' }));
    assert.equal(self.status, 403, JSON.stringify(self.body)); assert.equal(self.body.code, 'SELF_CONFIRM');
    const ok = await J(await send('PUT', `/api/governance/decisions/${d.id}`, T.member, { status: 'done' }));
    assert.equal(ok.status, 200); assert.equal(ok.body.decision.status, 'done');
  } finally { await rdb.setUserRoles(ID.chair, ['editor']); await setCfg({ decision_lifecycle_enforced: '0' }); }
});

test('A5 decision cycle metric reconciles to the source rows (decisions.created_at → first ledger move to done)', async () => {
  const reg = require('../services/metricRegistry').current();
  const r = await reg.resolve('governance.decision_cycle_days', { deps: { rdb } });
  assert.equal(reg.get('governance.decision_cycle_days').status.startsWith('draft'), true, 'not published, not certified');
  // independent recomputation from the raw tables
  const decs = await rdb.db.prepare('SELECT id, created_at FROM decisions').all();
  const done = await rdb.db.prepare("SELECT entity_id, MIN(at) AS at FROM ppm_events WHERE entity='decision' AND new_value='done' GROUP BY entity_id").all();
  const from = r.window.from, to = r.window.to;
  const days = [];
  for (const e of done) { const d = decs.find((x) => Number(x.id) === Number(e.entity_id)); if (!d) continue; const day = String(e.at).slice(0, 10); if (day < from || day > to) continue; days.push(Math.round((Date.parse(e.at) - new Date(d.created_at).getTime()) / 864e5 * 10) / 10); }
  assert.ok(days.length >= 1, 'at least the decision confirmed above');
  assert.equal(r.record.n, days.length);
  assert.equal(r.value, Math.round(days.reduce((a, b) => a + b, 0) / days.length * 10) / 10);
  // a site with no adopted decision → UNKNOWN (null), never 0
  const none = await reg.resolve('governance.decision_cycle_days', { site: 999999, deps: { rdb } });
  assert.equal(none.value, null); assert.equal(none.data_state, 'not_measured');
});

test('A5 two-person soft delete: reason + second person; requester refused; recoverable; in the ledger', async () => {
  await setCfg({ soft_delete_enabled: '1', soft_delete_two_person: '1' });
  try {
    const g = await J(await send('PUT', '/api/governance/portfolio/programme', T.member, { key: 'p6-prog', name: 'P6 programme' }));
    assert.equal(g.status, 200, JSON.stringify(g.body)); const id = g.body.id || (g.body.programme && g.body.programme.id) || g.body.row && g.body.row.id;
    const pid = id != null ? id : (await rdb.db.prepare("SELECT id FROM portfolio_programmes WHERE key='p6-prog'").get()).id;
    const url = `/api/governance/portfolio/programme/${pid}`;
    const noReason = await J(await send('DELETE', url, T.member));
    assert.equal(noReason.status, 400); assert.equal(noReason.body.code, 'REASON_REQUIRED');
    const raw1 = await send('DELETE', url, T.member, { reason: 'duplicate of the group programme' }); const txt1 = await raw1.text(); assert.equal(raw1.status, 202, txt1); const req1 = { status: raw1.status, body: JSON.parse(txt1) };
    assert.equal(req1.status, 202); assert.equal(req1.body.pending, true);
    assert.ok(!(await rdb.db.prepare('SELECT deleted_at FROM portfolio_programmes WHERE id=?').get(pid)).deleted_at, 'not deleted yet');
    const pend = await J(await send('GET', '/api/governance/delete-requests', T.member2));
    assert.ok(pend.body.requests.some((r) => r.kind === 'programme' && r.id === Number(pid) && r.requested_by === ID.member));
    assert.equal((await send('GET', '/api/governance/delete-requests', T.viewer)).status, 403);
    const self = await J(await send('DELETE', url, T.member, { reason: 'please, it is a duplicate' }));
    assert.equal(self.status, 409); assert.equal(self.body.code, 'SECOND_PERSON_REQUIRED');
    const ok = await J(await send('DELETE', url, T.member2));
    assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.soft, true);
    const row = await rdb.db.prepare('SELECT deleted_at, deleted_by, delete_reason FROM portfolio_programmes WHERE id=?').get(pid);
    assert.ok(row.deleted_at); assert.equal(Number(row.deleted_by), ID.member2); assert.match(row.delete_reason, /duplicate of the group programme/);
    const ledger = await rdb.db.prepare("SELECT action, actor_id FROM ppm_events WHERE entity='delete_request:programme' AND entity_id=? ORDER BY id").all(pid);
    assert.deepEqual(ledger.map((e) => [e.action, Number(e.actor_id)]), [['requested', ID.member], ['confirmed', ID.member2]]);
    assert.equal((await J(await send('GET', '/api/governance/delete-requests', T.member2))).body.requests.filter((r) => r.id === Number(pid)).length, 0);
    assert.equal((await send('POST', `${url}/restore`, T.admin, {})).status, 200, 'recoverable');
  } finally { await setCfg({ soft_delete_enabled: '0', soft_delete_two_person: '0' }); }
});

test('A5 two-person off (soft delete on) = today: one DELETE stamps, no reason needed', async () => {
  await setCfg({ soft_delete_enabled: '1' });
  try {
    const g = await J(await send('PUT', '/api/governance/portfolio/programme', T.member, { key: 'p6-prog2', name: 'P6 programme 2' }));
    assert.equal(g.status, 200);
    const pid = (await rdb.db.prepare("SELECT id FROM portfolio_programmes WHERE key='p6-prog2'").get()).id;
    const r = await J(await send('DELETE', `/api/governance/portfolio/programme/${pid}`, T.member));
    assert.equal(r.status, 200); assert.equal(r.body.soft, true);
  } finally { await setCfg({ soft_delete_enabled: '0' }); }
});

test('A6 break-glass time-box: reason required, session capped in minutes, reason on the risk event; off = 24 h', async () => {
  const ss = require('../services/ssoSettings');
  await setCfg({ sso_mode: 'available', sso_breakglass_user: 'p6_admin' }); ss._invalidate && ss._invalidate();
  try {
    const off = await J(await fetch(base + '/api/reports/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'p6_admin', password: 'p6_adminpass1234' }) }));
    assert.equal(off.status, 200, 'switch off = today');
    await setCfg({ breakglass_timebox_enabled: '1', breakglass_session_minutes: '30' });
    const refused = await J(await fetch(base + '/api/reports/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'p6_admin', password: 'p6_adminpass1234' }) }));
    assert.equal(refused.status, 400); assert.equal(refused.body.code, 'REASON_REQUIRED');
    const before = Date.now();
    const r = await fetch(base + '/api/reports/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'p6_admin', password: 'p6_adminpass1234', reason: 'Entra outage since 08:00' }) });
    assert.equal(r.status, 200);
    const token = /report_token=([^;]+)/.exec(String(r.headers.get('set-cookie')))[1];
    const exp = Date.parse((await rdb.db.prepare('SELECT expires_at FROM sessions WHERE token=?').get(token)).expires_at);
    assert.ok(exp <= before + 31 * 60000 && exp >= before + 25 * 60000, `capped at 30 min (${new Date(exp).toISOString()})`);
    const ev = await rdb.db.prepare("SELECT details FROM system_log WHERE action='breakglass_login' ORDER BY id DESC LIMIT 1").get();
    assert.match(String(ev.details), /Entra outage since 08:00/);
  } finally { await setCfg({ sso_mode: '', sso_breakglass_user: '', breakglass_timebox_enabled: '0', breakglass_session_minutes: '60' }); ss._invalidate && ss._invalidate(); }
});

test('A6 "My access" hub: links only — sessions for super_admin, deputies for all, emergency when enabled', async () => {
  const me = await J(await send('GET', '/api/access/me', T.editor));
  assert.equal(me.status, 200); assert.equal(me.body.hub.sessions_href, null); assert.equal(me.body.hub.deputies_href, 'policies.html#gpRoles'); assert.equal(me.body.hub.emergency, false);
  const html = _fs.readFileSync(_path.join(__dirname, '..', 'public', 'access.html'), 'utf8');
  for (const id of ['axHub', 'axHubSessionsLink', 'axHubDeputiesLink', 'axHubEmergencyLink']) assert.ok(html.includes(`id="${id}"`), id);
});

test('A6 RBAC identical under SSO: a password session and an SSO-minted session get the same answers on guarded routes', async () => {
  const walker = require('../tools/agent/authz-walk');
  const routes = walker.walkRoutes(require('../services/routerStack').routerStack(require('../server').app))
    .filter((r) => r.method === 'GET' && r.path.startsWith('/api/') && !r.path.includes(':') && !/export|\.pptx|\.xlsx|\.pdf|\.csv|sync|send|download|stream|events/i.test(r.path));
  const sample = [...new Set(routes.map((r) => r.path))].filter((p) => /^\/api\/(governance|access|reports|meetings|inspection|tracker|assets|admin|workspace)\b/.test(p)).slice(0, 60);
  assert.ok(sample.length >= 20, `sample ${sample.length}`);
  for (const who of ['editor', 'viewer', 'member', 'admin']) {
    const sso = (await rdb.createSessionForUser(ID[who])).token;
    const diffs = [];
    for (const p of sample) {
      const a = (await send('GET', p, T[who])).status, b = (await send('GET', p, sso)).status;
      if (a === 429 || b === 429) continue;   // a route-level rate limiter answered, not the RBAC gate
      if (a !== b) diffs.push(`${p}: password ${a} vs sso ${b}`);
    }
    assert.deepEqual(diffs, [], who);
  }
});
