'use strict';
const fetch = require('./_http-fetch');   // core-http shim (see tests/_http-fetch.js)
// Step 8 — /api/cockpit/* and /api/portfolio/*: a meeting from cadence to minutes, rights, requests to the committee,
// portfolio tree and governance, Roadmap Manager copy.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'cockpit-routes-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'ck-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'ck-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ck-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';
process.env.METRICS_CACHE_TTL_MS = '0';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, tok = {};
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const get = (p, t) => fetch(base + p, { headers: H(t) });
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: H(t), body: body ? JSON.stringify(body) : undefined });
const json = async (r) => ({ status: r.status, body: await r.json() });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const mk = async (u, roles, extra = {}) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pass-0000', roles, ...extra });
    tok[u] = (await rdb.login(u, u + '-pass-0000')).token;
  };
  await mk('ck-viewer', ['viewer']);
  await mk('ck-chair', ['viewer', 'meeting-chair']);
  await mk('ck-owner', ['viewer']);
  await mk('ck-committee', ['viewer', 'committee-member']);
  await mk('ck-pm', ['viewer', 'portfolio-manager']);
  await mk('ck-sa', ['super_admin']);
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('a meeting from its cadence to its minutes', async () => {
  assert.equal((await fetch(base + '/api/cockpit/cadences')).status, 401);
  assert.equal((await send('POST', '/api/cockpit/cadences', tok['ck-viewer'], { id: 'hebdo', title: 'Hebdo', type: 'it-weekly' })).status, 403);
  const c = await json(await send('POST', '/api/cockpit/cadences', tok['ck-chair'], { id: 'hebdo', title: 'Hebdo IT', type: 'it-weekly' }));
  assert.equal(c.status, 201);
  assert.ok(c.body.draft.agenda.length >= 4, 'agenda template of the type');
  const draft = { ...c.body.draft, participants: [{ name: 'Awa', email: 'awa@example.org' }] };
  assert.equal((await send('PUT', '/api/cockpit/cadences/hebdo/draft', tok['ck-chair'], { definition: draft })).status, 200);
  assert.equal((await send('POST', '/api/cockpit/sessions', tok['ck-chair'], { cadence_id: 'hebdo' })).status, 404, 'publish the cadence first');
  assert.equal((await json(await send('POST', '/api/cockpit/cadences/hebdo/publish', tok['ck-chair']))).body.version, 1);
  const prev = await json(await get('/api/cockpit/cadences/hebdo/agenda?date=2026-10-20', tok['ck-chair']));
  assert.equal(prev.status, 200);
  assert.ok(prev.body.sections.every(s => !s.error && !(s.data && s.data.error)), JSON.stringify(prev.body.sections.filter(s => s.error || (s.data && s.data.error))));

  const s = await json(await send('POST', '/api/cockpit/sessions', tok['ck-chair'], { cadence_id: 'hebdo', held_on: '2026-10-20' }));
  assert.equal(s.status, 201); assert.equal(s.body.status, 'planned');
  const sid = s.body.id;
  assert.equal((await send('POST', `/api/cockpit/sessions/${sid}/decisions`, tok['ck-chair'], { text: 'x' })).status, 409, 'not started');
  assert.equal((await send('POST', `/api/cockpit/sessions/${sid}/start`, tok['ck-viewer'])).status, 403);
  const started = await json(await send('POST', `/api/cockpit/sessions/${sid}/start`, tok['ck-chair']));
  assert.equal(started.body.session.status, 'live');
  assert.ok(started.body.session.agenda.sections.length >= 4, 'agenda frozen in the session');
  assert.equal((await send('POST', `/api/cockpit/sessions/${sid}/start`, tok['ck-chair'])).status, 409);
  await send('POST', `/api/cockpit/sessions/${sid}/items/1/start`, tok['ck-chair']);
  await send('PUT', `/api/cockpit/sessions/${sid}/items/1/notes`, tok['ck-chair'], { notes: 'Trois actions closes <ok>' });
  const dec = await send('POST', `/api/cockpit/sessions/${sid}/decisions`, tok['ck-chair'], { item_seq: 1, text: 'Renforcer l’astreinte', owner: 'Awa' });
  assert.equal(dec.status, 201);
  const act = await json(await send('POST', `/api/cockpit/sessions/${sid}/actions`, tok['ck-chair'], { item_seq: 1, title: 'Appeler le FAI', owner: 'ck-owner', due_date: '2026-10-27', source_kind: 'incident', source_ref: 'INC-42' }));
  assert.equal(act.body.action.source_kind, 'incident');
  const items = await json(await send('POST', `/api/cockpit/sessions/${sid}/items/2/start`, tok['ck-chair']));
  assert.ok(items.body.items[0].ended_at && items.body.items[1].started_at, 'opening point 2 closes point 1');
  assert.equal((await get(`/api/cockpit/sessions/${sid}/minutes.html`, tok['ck-viewer'])).status, 404, 'no minutes before the close');
  const closed = await json(await send('POST', `/api/cockpit/sessions/${sid}/close`, tok['ck-chair']));
  assert.equal(closed.body.session.status, 'closed');
  const pv = await get(`/api/cockpit/sessions/${sid}/minutes.html`, tok['ck-viewer']);
  assert.equal(pv.status, 200);
  assert.match(pv.headers.get('content-security-policy') || '', /default-src 'none'/);
  const html = await pv.text();
  assert.ok(html.includes('Renforcer l’astreinte') && html.includes('Appeler le FAI') && html.includes('Trois actions closes &lt;ok&gt;') && html.includes('incident INC-42'));
  assert.equal((await send('POST', `/api/cockpit/sessions/${sid}/minutes/send`, tok['ck-viewer'])).status, 403);
  const sendR = await send('POST', `/api/cockpit/sessions/${sid}/minutes/send`, tok['ck-chair']);
  assert.ok([502].includes(sendR.status), 'no SMTP configured: the e-mail is not sent and the reason is given');
  const log = await rdb.listSystemLog({ category: 'cockpit' });
  assert.ok((log.rows || log).some(r => r.action === 'meeting_closed'), 'journalled');
});

test('follow-up: an action is updated by its owner or a chair, not by anyone', async () => {
  const list = await json(await get('/api/cockpit/actions?status=open', tok['ck-viewer']));
  const a = list.body.actions.find(x => x.title === 'Appeler le FAI');
  assert.ok(a);
  assert.equal((await send('POST', `/api/cockpit/actions/${a.id}`, tok['ck-viewer'], { status: 'done' })).status, 403);
  assert.equal((await send('POST', `/api/cockpit/actions/${a.id}`, tok['ck-owner'], { status: 'finished' })).status, 400);
  const done = await json(await send('POST', `/api/cockpit/actions/${a.id}`, tok['ck-owner'], { status: 'done' }));
  assert.equal(done.body.action.status, 'done'); assert.ok(done.body.action.done_at);
  const ag = await json(await get('/api/cockpit/cadences/hebdo/agenda?date=2026-10-27', tok['ck-chair']));
  const follow = ag.body.sections.find(s => s.kind === 'followup');
  assert.deepStrictEqual(follow.actions, [], 'a done action leaves the follow-up');
});

test('requests to the committee: anyone submits, the committee scores and decides', async () => {
  const r = await json(await send('POST', '/api/cockpit/rfis', tok['ck-viewer'], { title: 'Budget switchs Houndé', category: 'budget' }));
  assert.equal(r.status, 201);
  const id = r.body.rfi.id;
  assert.equal((await send('POST', `/api/cockpit/rfis/${id}/triage`, tok['ck-viewer'], { value: 5 })).status, 403);
  const t = await json(await send('POST', `/api/cockpit/rfis/${id}/triage`, tok['ck-committee'], { value: 4, urgency: 5, effort: 2 }));
  assert.equal(t.body.rfi.status, 'scored'); assert.equal(Number(t.body.rfi.score), 10);
  const d = await json(await send('POST', `/api/cockpit/rfis/${id}/decide`, tok['ck-committee'], { text: 'Accordé sur le budget T1' }));
  assert.equal(d.body.rfi.status, 'decided'); assert.ok(d.body.decision_id);
});

test('portfolio: managers write, everyone reads, tree rules, alerts, report, governance', async () => {
  assert.equal((await send('POST', '/api/portfolio/nodes', tok['ck-viewer'], { kind: 'programme', title: 'P' })).status, 403);
  const p = await json(await send('POST', '/api/portfolio/nodes', tok['ck-pm'], { kind: 'programme', title: 'Transformation ITSM' }));
  assert.equal(p.status, 201);
  const bad = await json(await send('POST', '/api/portfolio/nodes', tok['ck-pm'], { kind: 'milestone', title: 'Orphelin', parent_id: p.body.node.id }));
  assert.equal(bad.status, 400); assert.match(bad.body.details.join(' '), /milestone goes under project/);
  const o = await json(await send('POST', '/api/portfolio/nodes', tok['ck-pm'], { kind: 'objective', title: 'SLA ≥ 90 %', parent_id: p.body.node.id, evidence_metric: 'helpdesk.sla_res_pct', evidence_target: 90 }));
  const j = await json(await send('POST', '/api/portfolio/nodes', tok['ck-pm'], { kind: 'project', title: 'Refonte catalogue', parent_id: o.body.node.id, start_date: '2026-01-01', due_date: '2026-03-31' }));
  const m = await json(await send('POST', '/api/portfolio/nodes', tok['ck-pm'], { kind: 'milestone', title: 'Formulaires', parent_id: j.body.node.id, due_date: '2026-02-28' }));
  assert.equal(m.body.node.baseline_due, '2026-02-28', 'the first due date becomes the baseline');
  const moved = await json(await send('PUT', `/api/portfolio/nodes/${m.body.node.id}`, tok['ck-pm'], { due_date: '2026-03-20' }));
  assert.equal(moved.body.node.baseline_due, '2026-02-28');
  assert.equal((await send('PUT', `/api/portfolio/nodes/${p.body.node.id}`, tok['ck-pm'], { parent_id: m.body.node.id })).status, 400, 'no cycle / wrong level');
  const all = await json(await get('/api/portfolio', tok['ck-viewer']));
  const mm = all.body.nodes.find(n => n.id === m.body.node.id);
  assert.equal(mm.effective_status, 'late'); assert.equal(mm.drift_days, 20);
  assert.ok(all.body.alerts.some(a => a.kind === 'late' && a.id === mm.id));
  assert.ok(all.body.nodes.find(n => n.id === o.body.node.id).evidence, 'evidence read from the dictionary');
  assert.equal((await send('DELETE', `/api/portfolio/nodes/${j.body.node.id}`, tok['ck-pm'])).status, 409, 'has children');
  const rep = await get('/api/portfolio/report?month=2026-03', tok['ck-viewer']);
  assert.equal(rep.status, 200);
  assert.ok((await rep.text()).includes('Transformation ITSM'));
  const g = await json(await get('/api/portfolio/governance?from=2026-01-01&to=2026-12-31', tok['ck-viewer']));
  assert.equal(g.status, 200);
  assert.equal(g.body.evidence_coverage.with_evidence, 1);
  assert.ok(g.body.meetings.held >= 1, 'the closed meeting counts');
  assert.ok(Object.keys(g.body.adoption_by_role).length >= 1);
});

test('Roadmap Manager copy: super_admin only, repeatable (stable ids)', async () => {
  assert.equal((await send('POST', '/api/portfolio/import-roadmap', tok['ck-pm'])).status, 403);
  const r1 = await json(await send('POST', '/api/portfolio/import-roadmap', tok['ck-sa']));
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.ok(r1.body.created > 10);
  const r2 = await json(await send('POST', '/api/portfolio/import-roadmap', tok['ck-sa']));
  assert.equal(r2.body.created, 0); assert.equal(r2.body.updated, r1.body.nodes);
});
