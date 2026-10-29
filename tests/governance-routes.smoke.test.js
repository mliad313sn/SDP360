'use strict';
const fetch = require('./_http-fetch');
// Step 8 — /api/governance on sqlite: gates (committee / chair / editor), prepared agenda, item stamping, decisions by chair vs editor,
// close → minutes.html, RFI submit by anyone + triage by committee, portfolio upsert + report, roadmap migration dry-run (super_admin).
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
let server, base, admin, editor, viewer, superT, member, rdb, hounde, editorId, otherEditor;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 50; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'meeting_cadences'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = (await rdb.listSites({ includeInactive: true }));
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; const mana = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, role, roles, site) => { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', role, roles, site_id: site }); } catch {} return (await rdb.login(u, u + 'pass1234')).token; };
  admin = await mk('gv_admin', 'admin', ['admin']); superT = await mk('gv_super', 'super_admin', ['super_admin']);
  member = await mk('gv_member', 'viewer', ['viewer', 'committee-member']);
  editor = await mk('gv_editor', 'editor', ['editor'], hounde); otherEditor = await mk('gv_other', 'editor', ['editor'], mana);
  viewer = await mk('gv_viewer', 'viewer', ['viewer'], hounde);
  editorId = (await rdb.db.prepare("SELECT id FROM users WHERE username='gv_editor'").get()).id;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const H = (t, extra) => ({ headers: Object.assign(t ? { 'x-report-token': t } : {}, extra || {}) });
const get = (p, t) => fetch(base + p, H(t));
const send = (m, p, t, body) => fetch(base + p, { method: m, ...H(t, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
let cadId, sessId;

test('overview + cadences: 401 anonymous, committee gate on PUT, sites listed, site cadence hidden from another site', async () => {
  assert.equal((await get('/api/governance/overview')).status, 401);
  const o = await (await get('/api/governance/overview', viewer)).json(); assert.equal(o.ok, true); assert.equal(o.committee, false); assert.equal(typeof o.cadences, 'number');
  assert.equal((await send('PUT', '/api/governance/cadences', editor, { key: 'hgo-weekly', name: 'HGO weekly' })).status, 403);
  assert.equal((await send('PUT', '/api/governance/cadences', member, { key: 'bad key', name: 'x' })).status, 400);
  const c = await (await send('PUT', '/api/governance/cadences', member, { key: 'hgo-weekly', name: 'HGO weekly', kind: 'site_weekly', site_id: hounde, chair_id: editorId, participants: ['chair@example.com'] })).json();
  assert.equal(c.ok, true); cadId = c.cadence.id;
  const l = await (await get('/api/governance/cadences', editor)).json(); assert.ok(l.cadences.some(x => x.id === cadId)); assert.ok(Array.isArray(l.sites) && l.sites.length >= 1);
  const other = await (await get('/api/governance/cadences', otherEditor)).json(); assert.ok(!other.cadences.some(x => x.id === cadId), 'HGO cadence invisible to the Mana editor');
});

test('prepare session: agenda generated with the kind sections, figures null-not-zero; runner gates', async () => {
  assert.equal((await send('POST', `/api/governance/cadences/${cadId}/sessions`, otherEditor, {})).status, 403);
  assert.equal((await send('POST', `/api/governance/cadences/${cadId}/sessions`, viewer, {})).status, 403);
  const r = await (await send('POST', `/api/governance/cadences/${cadId}/sessions`, editor, { scheduled_at: '2026-10-20T09:00:00Z' })).json();
  assert.equal(r.ok, true); sessId = r.session.id; const ag = r.session.agenda;
  assert.deepEqual(ag.items.map(i => i.kind), ['kpis', 'incidents', 'actions', 'decisions', 'next']);
  for (const m of ag.items[0].content) assert.ok(m.value === null || Number.isFinite(m.value));
  assert.equal(r.session.items.length, ag.items.length);
  const s = await (await get(`/api/governance/sessions/${sessId}`, editor)).json(); assert.equal(s.can_run, true); assert.equal(s.can_decide, true, 'the editor is the chair');
  assert.equal((await get(`/api/governance/sessions/${sessId}`, otherEditor)).status, 403);
});

test('live: start, stamp items, notes, decisions (chair ok, plain editor of the site 403, admin ok), actions, close → minutes', async () => {
  const st = await (await send('POST', `/api/governance/sessions/${sessId}/start`, editor)).json(); assert.equal(st.session.status, 'live'); assert.ok(st.session.started_at);
  const a = await (await send('POST', `/api/governance/sessions/${sessId}/items/s1-kpis/start`, editor, {})).json(); assert.ok(a.session.items.find(i => i.id === 's1-kpis').started_at);
  const n = await (await send('POST', `/api/governance/sessions/${sessId}/items/s1-kpis/notes`, editor, { notes: 'SLA discussed' })).json(); assert.equal(n.session.items.find(i => i.id === 's1-kpis').notes, 'SLA discussed');
  assert.equal((await send('POST', `/api/governance/sessions/${sessId}/items/s1-kpis/zap`, editor, {})).status, 400);
  // a second HGO editor (not chair) may run but not decide
  try { await rdb.createUser({ username: 'gv_editor2', full_name: 'E2', password: 'gv_editor2pass1234', role: 'editor', roles: ['editor'], site_id: hounde }); } catch {}
  const editor2 = (await rdb.login('gv_editor2', 'gv_editor2pass1234')).token;
  assert.equal((await send('POST', `/api/governance/sessions/${sessId}/items/s2-incidents/start`, editor2, {})).status, 200);
  assert.equal((await send('POST', `/api/governance/sessions/${sessId}/decisions`, editor2, { title: 'nope' })).status, 403);
  const d = await (await send('POST', `/api/governance/sessions/${sessId}/decisions`, editor, { title: 'Replace UPS', owner: 'Bob', due_date: '2026-11-15' })).json(); assert.match(d.decision.ref, /^DEC-\d{4}-001$/);
  const d2 = await (await send('POST', `/api/governance/sessions/${sessId}/decisions`, admin, { title: 'Second' })).json(); assert.match(d2.decision.ref, /-002$/);
  assert.equal((await send('POST', `/api/governance/sessions/${sessId}/actions`, editor, {})).status, 400);
  const ac = await (await send('POST', `/api/governance/sessions/${sessId}/actions`, editor, { title: 'Order UPS', owner: 'Bob', source_kind: 'decision', source_ref: d.decision.ref })).json(); assert.equal(ac.action.status, 'open');
  const upd = await (await send('PUT', `/api/governance/sessions/${sessId}/actions/${ac.action.id}`, editor, { status: 'done' })).json(); assert.ok(upd.actions[0].closed_at);
  const closed = await (await send('POST', `/api/governance/sessions/${sessId}/close`, editor)).json(); assert.equal(closed.session.status, 'closed'); assert.ok(closed.minutes_bytes > 500);
  const m = await get(`/api/governance/sessions/${sessId}/minutes.html`, viewer); assert.equal(m.status, 200); const html = await m.text(); assert.ok(html.includes(d.decision.ref)); assert.ok(html.includes('Order UPS')); assert.ok(html.includes('SLA discussed'));
  assert.equal((await send('POST', `/api/governance/sessions/${sessId}/start`, editor)).status, 409, 'a closed session cannot restart');
  const dec = await (await get('/api/governance/decisions?status=open', viewer)).json(); assert.ok(dec.decisions.some(x => x.ref === d.decision.ref));
  // UAT 2026-10-29 (PMO F8): the chair follows the decision's status between meetings; its content stays a committee edit
  assert.equal((await send('PUT', `/api/governance/decisions/${d.decision.id}`, editor, { title: 'rewritten' })).status, 403);
  assert.equal((await send('PUT', `/api/governance/decisions/${d.decision.id}`, editor, { status: 'done' })).status, 200);
  assert.equal((await (await send('PUT', `/api/governance/decisions/${d.decision.id}`, member, { status: 'done' })).json()).decision.status, 'done');
  assert.equal((await get('/api/governance/overview', admin)).status, 200);
});

test('RFI: anyone submits, committee triages, list sorted by score; portfolio upsert + report; roadmap dry-run is super_admin only', async () => {
  assert.equal((await send('POST', '/api/governance/rfi', viewer, { kind: 'nope', title: 't', problem: 'p' })).status, 400);
  const r1 = await (await send('POST', '/api/governance/rfi', viewer, { kind: 'widget', title: 'Small', problem: 'p', impact: 1, effort: 3 })).json(); assert.match(r1.rfi.ref, /^RFI-\d{4}-001$/); assert.equal(r1.rfi.site_id, hounde);
  const r2 = await (await send('POST', '/api/governance/rfi', editor, { kind: 'metric', title: 'Big', problem: 'p', impact: 3, effort: 1, data_risk: 1 })).json();
  assert.equal((await send('PUT', `/api/governance/rfi/${r1.rfi.id}`, viewer, { status: 'accepted' })).status, 403);
  const t = await (await send('PUT', `/api/governance/rfi/${r1.rfi.id}`, member, { status: 'accepted', decision: 'go', impact: 3 })).json(); assert.equal(t.rfi.status, 'accepted'); assert.ok(t.rfi.decided_at);
  const l = await (await get('/api/governance/rfi', viewer)).json(); assert.equal(l.rfi[0].ref, r2.rfi.ref, 'highest score first'); assert.ok(l.kinds.includes('tracker'));
  assert.equal((await send('PUT', '/api/governance/portfolio/programme', editor, { key: 'p', name: 'P' })).status, 403);
  assert.equal((await send('PUT', '/api/governance/portfolio/objective', member, { name: 'orphan' })).status, 400);
  const pr = await (await send('PUT', '/api/governance/portfolio/programme', member, { key: 'itsm', name: 'ITSM' })).json(); assert.ok(pr.id > 0);
  const ob = await (await send('PUT', '/api/governance/portfolio/objective', member, { programme_id: pr.id, key: 'o1', name: 'SLA', evidence_metric: 'helpdesk.resolution_sla_pct', evidence_target: 90, weight: 2 })).json();
  const pj = await (await send('PUT', '/api/governance/portfolio/project', member, { objective_id: ob.id, key: 'j1', name: 'J', start_date: '2026-01-01', end_date: '2026-03-31', baseline_end: '2026-02-28', status: 'active' })).json();
  await send('PUT', '/api/governance/portfolio/risk', member, { project_id: pj.id, title: 'Late vendor', probability: 3, impact: 3 });
  const v = await (await get('/api/governance/portfolio', viewer)).json(); assert.equal(v.committee, false); assert.equal(v.programmes.length, 1);
  const ov = v.objective_views.find(o => o.id === ob.id); assert.ok(ov.evidence_pct === null || Number.isFinite(ov.evidence_pct)); assert.ok(['metric', 'none', 'projects', 'manual'].includes(ov.evidence_source));
  const g = v.gantt.find(x => x.id === pj.id); assert.equal(g.slip_days, 31); assert.equal(g.late, true); assert.equal(g.objective_id, ob.id);
  assert.equal(v.summary[0].high_risks, 1); assert.equal(v.summary[0].late_projects, 1);
  const rep = await get('/api/governance/portfolio/report.html', viewer); assert.equal(rep.status, 200); const html = await rep.text(); assert.ok(html.includes('ITSM')); assert.ok(html.includes('Late vendor'));
  assert.equal((await send('DELETE', `/api/governance/portfolio/project/${pj.id}`, editor)).status, 403);
  assert.equal((await send('POST', '/api/governance/roadmap-migration', admin, {})).status, 403);
  const dry = await (await send('POST', '/api/governance/roadmap-migration', superT, {})).json(); assert.equal(dry.dry_run, true); assert.equal(dry.plan.programme.key, 'itsm-roadmap'); assert.equal(dry.plan.exists, false);
  assert.equal((await get('/api/governance/portfolio/report.html')).status, 401);
});

test('G-21 lifecycle end to end: planned → held → logged → accepted (four-eyes), frozen, reopen; cancel = exception; effective window', async () => {
  const memberId = (await rdb.db.prepare("SELECT id FROM users WHERE username='gv_member'").get()).id;
  const c = await (await send('PUT', '/api/governance/cadences', member, { key: 'hgo-lc', name: 'HGO lifecycle', kind: 'site_weekly', site_id: hounde, chair_id: editorId, secretary_id: memberId, effective_from: '2026-10-01', effective_to: '2099-12-31' })).json();
  assert.equal(c.cadence.effective_from, '2026-10-01');
  assert.equal((await send('PUT', '/api/governance/cadences', member, { key: 'hgo-lc2', name: 'x', effective_from: '01/10/2026' })).status, 400);
  assert.equal((await send('POST', `/api/governance/cadences/${c.cadence.id}/sessions`, editor, { scheduled_at: '2100-01-05T09:00:00Z' })).status, 400, 'outside the effective window');
  let s = (await (await send('POST', `/api/governance/cadences/${c.cadence.id}/sessions`, editor, { scheduled_at: '2026-10-27T09:00:00Z' })).json()).session;
  const id = s.id;
  assert.equal((await send('POST', `/api/governance/sessions/${id}/close`, editor)).status, 409, 'a session that never started is not held');
  assert.equal((await send('POST', `/api/governance/sessions/${id}/start`, editor)).status, 200);
  const closed = await (await send('POST', `/api/governance/sessions/${id}/close`, editor)).json();
  assert.equal(closed.session.stage, 'logged');
  assert.equal((await send('POST', `/api/governance/sessions/${id}/close`, editor)).status, 409, 'closing twice would rewrite the minutes');
  const own = await send('POST', `/api/governance/sessions/${id}/accept`, editor); assert.equal(own.status, 403); assert.equal((await own.json()).code, 'SOD');
  assert.equal((await send('POST', `/api/governance/sessions/${id}/accept`, viewer)).status, 403);
  s = (await (await send('POST', `/api/governance/sessions/${id}/accept`, member)).json()).session;
  assert.equal(s.stage, 'accepted');
  for (const [m, p, b] of [['PUT', `/api/governance/sessions/${id}`, { notes: 'late edit' }], ['POST', `/api/governance/sessions/${id}/actions`, { title: 'late action' }],
    ['POST', `/api/governance/sessions/${id}/decisions`, { title: 'late decision' }], ['POST', `/api/governance/sessions/${id}/items/kpis/notes`, { notes: 'x' }]]) {
    const r = await send(m, p, admin, b); assert.equal(r.status, 409, `${m} ${p}`); assert.equal((await r.json()).code, 'FROZEN');
  }
  assert.equal((await send('POST', `/api/governance/sessions/${id}/reopen`, member, { reason: 'decision text was wrong' })).status, 403);
  s = (await (await send('POST', `/api/governance/sessions/${id}/reopen`, admin, { reason: 'decision text was wrong' })).json()).session;
  assert.equal(s.stage, 'held'); assert.equal(s.minutes_accepted_at, null);
  // the previous acceptance is not lost: accept + reopen are appended (audit P2-11)
  const mh = (await (await get(`/api/governance/sessions/${id}`, admin)).json()).minutes_history;
  assert.deepEqual(mh.map((x) => x.action), ['accepted', 'reopened']); assert.equal(mh[1].reason, 'decision text was wrong');
  await assert.rejects(async () => rdb.db.prepare('DELETE FROM minutes_history').run(), /append-only/);

  // cancellation by a runner = pending exception; approved by the committee (not the canceller)
  const s2 = (await (await send('POST', `/api/governance/cadences/${c.cadence.id}/sessions`, editor, { scheduled_at: new Date(Date.now() + 7 * 864e5).toISOString() })).json()).session;
  assert.equal((await send('POST', `/api/governance/sessions/${s2.id}/cancel`, editor, { reason: '' })).status, 400);
  const can = (await (await send('POST', `/api/governance/sessions/${s2.id}/cancel`, editor, { reason: 'site shutdown for maintenance' })).json()).session;
  assert.equal(can.stage, 'cancelled'); assert.equal(can.exception_status, 'pending');
  assert.equal((await send('POST', `/api/governance/sessions/${s2.id}/exception/approve`, editor)).status, 403);
  assert.equal((await (await send('POST', `/api/governance/sessions/${s2.id}/exception/approve`, member)).json()).session.exception_status, 'approved');
  assert.equal((await send('POST', `/api/governance/sessions/${s2.id}/start`, editor)).status, 409, 'a cancelled session cannot start');

  // a planned session whose date passed is missed — the overview never counts it as held
  const past = await send('POST', `/api/governance/cadences/${c.cadence.id}/sessions`, editor, { scheduled_at: new Date(Date.now() - 5 * 864e5).toISOString() });
  assert.equal(past.status, 200, await past.text());
  const o = await (await get('/api/governance/overview', admin)).json();
  assert.ok(o.compliance_30d.missed >= 1, JSON.stringify(o.compliance_30d)); assert.ok(o.compliance_30d.excused >= 1);
  // a missed session is not quietly moved to a new date (it stays a no-show; a new session is planned)
  const missedId = (await past.json()).session.id;
  const rs = await send('PUT', `/api/governance/sessions/${missedId}`, editor, { scheduled_at: new Date(Date.now() + 864e5).toISOString() });
  assert.equal(rs.status, 409); assert.equal((await rs.json()).code, 'MISSED');
});

test('session actions: an action id from another session is never reachable through this one (IDOR)', async () => {
  const a1 = (await (await send('POST', `/api/governance/cadences/${cadId}/sessions`, editor, { scheduled_at: new Date(Date.now() + 864e5).toISOString() })).json()).session;
  const a2 = (await (await send('POST', `/api/governance/cadences/${cadId}/sessions`, editor, { scheduled_at: new Date(Date.now() + 2 * 864e5).toISOString() })).json()).session;
  await send('POST', `/api/governance/sessions/${a1.id}/start`, editor);
  const act = (await (await send('POST', `/api/governance/sessions/${a1.id}/actions`, editor, { title: 'Only in a1', owner: 'Bob' })).json()).action;
  const r = await send('PUT', `/api/governance/sessions/${a2.id}/actions/${act.id}`, editor, { status: 'done' });
  assert.equal(r.status, 404);
  const still = (await (await get(`/api/governance/sessions/${a1.id}`, editor)).json()).actions.find((x) => x.id === act.id);
  assert.equal(still.status, 'open', 'untouched');
  // a double tap re-sends the same idempotency key: one decision, one action (field P1-4)
  const body = { title: 'Replace the UPS battery', owner: 'Bob', idem_key: 'ui-dbl-1' };
  const [d1, d2] = await Promise.all([1, 2].map(async () => (await (await send('POST', `/api/governance/sessions/${a1.id}/decisions`, editor, body)).json()).decision));
  assert.equal(d1.ref, d2.ref);
  const x1 = (await (await send('POST', `/api/governance/sessions/${a1.id}/actions`, editor, { ...body, idem_key: 'ui-dbl-2' })).json()).action;
  const x2 = (await (await send('POST', `/api/governance/sessions/${a1.id}/actions`, editor, { ...body, idem_key: 'ui-dbl-2' })).json()).action;
  assert.equal(x1.id, x2.id);
  const s1 = await (await get(`/api/governance/sessions/${a1.id}`, editor)).json();
  assert.equal(s1.decisions.filter((d) => d.title === body.title).length, 1); assert.equal(s1.actions.filter((a) => a.title === body.title).length, 1);
});

test('people picker for chair / secretary: committee only, names and ids, filtered by site', async () => {
  assert.equal((await get('/api/governance/people', editor)).status, 403);
  const all = await (await get('/api/governance/people', member)).json();
  assert.ok(all.people.length >= 2 && all.people.every((p) => Number.isFinite(p.id) && p.name && !('email' in p)));
  const site = await (await get(`/api/governance/people?site=${hounde}`, member)).json();
  assert.ok(site.people.some((p) => p.id === editorId)); assert.ok(site.people.length <= all.people.length);
});
