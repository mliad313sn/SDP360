'use strict';
// PORTFOLIO LOT 4 over HTTP, fictitious data only. Switches ppm_decision_agenda_enabled / ppm_alert_actions_enabled
// (PROPOSED, '0' = today).
//   off : every Lot 4 route 404s; the decision register payload is unchanged (no project link columns)
//   agenda on : a required-but-unrecorded project heads the agenda; the committee records a decision about it (existing
//               DEC register, source_kind 'project'); outcome needs a decision date; a viewer may not write
//   alerts on : the six kinds over the readable portfolio; a money-hidden reader never sees 'unfunded'; promotion
//               creates ONE commitment per alert key (idempotent), sends no notification, and the commitment follows the
//               existing escalation matrix (A02 when serious and overdue)
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-l4-'));
process.env.DASH_USER = process.env.DASH_USER || 'l4-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'l4-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'l4-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, T = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'decisions' AND column_name = 'project_id'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const mk = async (u, roles) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('l4_pmo', ['viewer', 'committee-member']);
  T.viewer = await mk('l4_viewer', ['viewer']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  await sw({ ppm_intake_register_enabled: '1', ppm_decision_agenda_enabled: '0', ppm_alert_actions_enabled: '0' });
  const prog = (await put('programme', T.pmo, { key: 'l4-prog', name: 'L4' })).j.id;
  const obj = (await put('objective', T.pmo, { programme_id: prog, key: 'l4-o', name: 'O' })).j.id;
  const P = (key, o) => ({ objective_id: obj, key, name: 'Project ' + key, owner: 'Site IT', start_date: '2027-03-01', end_date: '2027-09-30', status: 'active',
    decision_required: 'no', risk_exposure: 'low', delivery_lead: 'Team', budget_status: 'approved', ...o });
  for (const [k, o] of [['D1', { decision_required: 'yes', risk_exposure: 'critical' }], ['D2', { decision_required: 'tbc', budget_status: 'not_budgeted' }], ['D3', {}]]) {
    const r = await put('project', T.pmo, P(k, o)); assert.equal(r.status, 200, r.txt); T[k] = r.j.id;
  }
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (_) {} return { status: r.status, j, txt }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (o) => cfg.setConfig(rdb.db, o, 'smoke');
const count = async (sql) => Number((await rdb.pgHandle().prepare(sql).get()).n);

test('switches off (= today): every Lot 4 route 404s, the feature flags read false', async () => {
  for (const [m, p] of [['GET', '/api/governance/portfolio/decision-agenda'], ['POST', `/api/governance/portfolio/project/${T.D1}/decisions`], ['PUT', '/api/governance/portfolio/decisions/1/record'],
    ['GET', '/api/governance/portfolio/alerts'], ['POST', '/api/governance/portfolio/alerts/promote']]) assert.equal((await send(m, p, T.pmo, m === 'GET' ? null : {})).status, 404, p);
  const f = (await send('GET', '/api/governance/ppm/features', T.pmo)).j;
  assert.equal(f.decision_agenda, false); assert.equal(f.alert_actions, false);
});

test('decision agenda: not-recorded first, the committee records a decision about the project, outcome needs a date', async () => {
  await sw({ ppm_decision_agenda_enabled: '1' });
  let g = await send('GET', '/api/governance/portfolio/decision-agenda', T.pmo);
  assert.equal(g.status, 200, g.txt);
  assert.deepStrictEqual(g.j.rows.map((r) => r.project_id), [T.D1, T.D2]);
  assert.equal(g.j.rows[0].not_recorded, true); assert.equal(g.j.can_record, true);
  assert.equal((await send('POST', `/api/governance/portfolio/project/${T.D1}/decisions`, T.viewer, { title: 'x' })).status, 403);
  const c = await send('POST', `/api/governance/portfolio/project/${T.D1}/decisions`, T.pmo, { title: 'Go / no go', authority: 'IT committee', due_date: '2026-01-15', owner: 'CIO' });
  assert.equal(c.status, 200, c.txt);
  assert.match(c.j.decision.ref, /^DEC-\d{4}-\d{3}$/); assert.equal(c.j.decision.source_kind, 'project'); assert.equal(c.j.decision.project_id, T.D1);
  T.dec = c.j.decision.id;
  g = await send('GET', '/api/governance/portfolio/decision-agenda', T.pmo);
  const r1 = g.j.rows.find((r) => r.project_id === T.D1);
  assert.equal(r1.not_recorded, false); assert.equal(r1.overdue, 1); assert.equal(r1.decisions[0].authority, 'IT committee');
  assert.equal((await send('PUT', `/api/governance/portfolio/decisions/${T.dec}/record`, T.pmo, { outcome: 'approved' })).status, 400, 'an outcome needs a decision date');
  assert.equal((await send('PUT', `/api/governance/portfolio/decisions/${T.dec}/record`, T.pmo, { outcome: 'maybe', decided_at: '2026-01-10' })).status, 400);
  assert.equal((await send('PUT', `/api/governance/portfolio/decisions/${T.dec}/record`, T.viewer, { outcome: 'approved', decided_at: '2026-01-10' })).status, 403);
  const rec = await send('PUT', `/api/governance/portfolio/decisions/${T.dec}/record`, T.pmo, { outcome: 'approved', decided_at: '2026-01-10' });
  assert.equal(rec.status, 200, rec.txt); assert.deepStrictEqual([rec.j.decision.outcome, rec.j.decision.decided_at, rec.j.decision.status], ['approved', '2026-01-10', 'open'], 'status stays the lifecycle\'s');
  const hist = await send('GET', `/api/governance/decisions/${T.dec}/history`, T.pmo);
  assert.ok(hist.j.events.some((e) => e.field === 'outcome' && e.new_value === 'approved'), 'old → new kept in the ledger');
  const list = await send('GET', '/api/governance/decisions', T.pmo);
  assert.ok(list.j.decisions.every((d) => !('project_id' in d) && !('outcome' in d)), 'the register payload is unchanged');
});

test('alerts: the six kinds, money hidden for a viewer, promotion idempotent, no notification sent, escalation matrix applies', async () => {
  await sw({ ppm_alert_actions_enabled: '1' });
  const a = await send('GET', '/api/governance/portfolio/alerts', T.pmo);
  assert.equal(a.status, 200, a.txt);
  const kinds = a.j.items.map((i) => i.kind + ':' + i.project_id).sort();
  assert.ok(kinds.includes('critical_risk:' + T.D1)); assert.ok(kinds.includes('unfunded:' + T.D2)); assert.ok(kinds.includes('decision_bottleneck:' + T.D1), 'overdue linked decision');
  assert.equal(a.j.outbound.external_armed, false);
  const v = await send('GET', '/api/governance/portfolio/alerts', T.viewer);
  assert.equal(v.status, 200); assert.ok(!v.j.items.some((i) => i.kind === 'unfunded')); assert.equal(v.j.coverage.unfunded, 'MONEY_HIDDEN'); assert.ok(!v.txt.includes('not_budgeted'));
  const key = a.j.items.find((i) => i.kind === 'critical_risk').key;
  assert.equal((await send('POST', '/api/governance/portfolio/alerts/promote', T.viewer, { key, owner: 'Ana' })).status, 403);
  assert.equal((await send('POST', '/api/governance/portfolio/alerts/promote', T.pmo, { key })).status, 400, 'owner required');
  assert.equal((await send('POST', '/api/governance/portfolio/alerts/promote', T.pmo, { key: 'critical_risk:project:999999', owner: 'Ana' })).status, 404);
  const notes0 = await count('SELECT COUNT(*) AS n FROM notifications');
  const p1 = await send('POST', '/api/governance/portfolio/alerts/promote', T.pmo, { key, owner: 'Ana', due_date: '2026-01-01' });
  assert.equal(p1.status, 200, p1.txt); assert.equal(p1.j.created, true);
  const p2 = await send('POST', '/api/governance/portfolio/alerts/promote', T.pmo, { key, owner: 'Bob', due_date: '2026-02-01' });
  assert.equal(p2.j.created, false); assert.equal(p2.j.commitment.id, p1.j.commitment.id, 'one commitment per alert key');
  assert.equal(await count(`SELECT COUNT(*) AS n FROM commitment_source_links WHERE source_system='ppm_alert' AND source_id='${key}'`), 1);
  assert.equal(await count('SELECT COUNT(*) AS n FROM notifications'), notes0, 'promotion sends no notification');
  const st = await rdb.pgHandle().prepare('SELECT commitment_uid, severity FROM ppm_alert_state WHERE item_key=?').get(key);
  assert.equal(st.commitment_uid, p1.j.commitment.uid); assert.equal(st.severity, 'critical');
  const after = await send('GET', '/api/governance/portfolio/alerts', T.pmo);
  assert.equal(after.j.items.find((i) => i.key === key).status, 'promoted');
  const esc = await require('../routes/commitments').createStore(rdb).escalate({ asOf: '2026-11-20T00:00:00Z' });
  assert.ok(esc.raised.some((x) => x.kind === 'A02' && x.commitment_id === p1.j.commitment.id), 'a critical overdue promoted alert follows the A02 escalation');
  await sw({ ppm_alert_actions_enabled: '0', ppm_decision_agenda_enabled: '0' });
  assert.equal((await send('GET', '/api/governance/portfolio/alerts', T.pmo)).status, 404);
});
