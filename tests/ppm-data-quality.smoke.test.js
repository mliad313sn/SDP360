'use strict';
// PORTFOLIO LOT 2 over HTTP, fictitious data only. ppm_data_quality_enabled (shadow) and ppm_dq_gate_enforced
// (proposal → approval refusal) — both PROPOSED, '0' = today.
//   both off : no `dq` key anywhere, catalogue unchanged, a project with a blocking error still moves to approval
//   DQ on    : project read carries score / checks / checklist / PROPOSED policy; portfolio carries per-project + site
//              scores; a money-hidden reader gets the budget checks left out; the gate is NOT enforced
//   gate on  : proposal → approval refused (409 GATE_DATA_QUALITY) on a blocking error, shown in the dry run too
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-dq-'));
process.env.DASH_USER = process.env.DASH_USER || 'dq-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'dq-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'dq-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, obj, T = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_lookup_values'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const mk = async (u, roles) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('dq_pmo', ['viewer', 'committee-member']);
  T.viewer = await mk('dq_viewer', ['viewer']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  await sw({ ppm_intake_register_enabled: '1', ppm_data_quality_enabled: '0', ppm_dq_gate_enforced: '0' });
  const prog = (await put('programme', T.pmo, { key: 'dq-prog', name: 'DQ' })).j.id;
  obj = (await put('objective', T.pmo, { programme_id: prog, key: 'dq-o', name: 'O' })).j.id;
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; const txt = await r.text(); try { j = JSON.parse(txt); } catch (_) {} return { status: r.status, j, txt }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (o) => cfg.setConfig(rdb.db, o, 'smoke');
const detail = async (id, t = T.pmo) => (await send('GET', `/api/governance/portfolio/project/${id}`, t)).j;
const CHARTER = 'Objective, scope and benefits of the project, long enough.';
const complete = (key) => ({ objective_id: obj, key, name: 'Complete ' + key, owner: 'Site IT', sponsor: 'Plant manager', charter: CHARTER, start_date: '2027-03-01', end_date: '2027-09-30',
  budget: 1000, currency: 'USD', status: 'planned', business_need: { problem: 'single link' }, expected_value: 'fewer outages', priority: 'high', budget_status: 'requested',
  decision_required: 'no', delivery_effort: 'large', avg_fte: 0.5, peak_fte: 1, risk_exposure: 'high', delivery_lead: 'Network team', value_states: { dependencies: 'none_known' } });
let full, noOwner;

test('both switches off (= today): no dq key, catalogue unchanged, a blocking error does not stop the move', async () => {
  full = (await put('project', T.pmo, complete('DQ-FULL'))).j.id;
  await put('risk', T.pmo, { project_id: full, title: 'Vendor lead time', probability: 2, impact: 2, kind: 'risk' });
  const c = await put('project', T.pmo, { ...complete('DQ-NOOWN'), owner: null });
  assert.equal(c.status, 200, c.txt); noOwner = c.j.id;
  const d = await detail(full);
  assert.ok(!('dq' in d), 'project read: no dq');
  const pf = (await send('GET', '/api/governance/portfolio', T.pmo)).j;
  assert.ok(!('dq' in pf), 'portfolio: no dq');
  const cat = (await send('GET', '/api/governance/intake/catalogue', T.pmo)).j;
  assert.ok(!('dq_guide' in cat));
  assert.ok(!(await detail(noOwner)).allowed_stages.find((g) => g.to === 'approval').refusal, 'no dq refusal in the dry run');
  const f = (await send('GET', '/api/governance/ppm/features', T.pmo)).j;
  assert.equal(f.data_quality, false); assert.equal(f.dq_gate_enforced, false);
  T.offKeys = Object.keys(d).sort();
});

test('DQ on (shadow): project score, checks, checklist, PROPOSED policy; portfolio + site scores; money-hidden reader', async () => {
  await sw({ ppm_data_quality_enabled: '1' });
  const d = await detail(full);
  assert.equal(d.dq.score, 100, JSON.stringify(d.dq.checks.filter((c) => c.complete !== true))); assert.equal(d.dq.rag, 'GREEN'); assert.equal(d.dq.required, 18);
  assert.equal(d.dq.checks.length, 19); assert.equal(d.dq.checklist.length, 16); assert.equal(d.dq.policy.status, 'PROPOSED'); assert.equal(d.dq.gate_enforced, false);
  const n = await detail(noOwner);
  assert.deepStrictEqual(n.dq.blocking, ['it_owner_missing']); assert.equal(n.dq.rag, 'RED');
  assert.ok(!n.allowed_stages.find((g) => g.to === 'approval').refusal, 'shadow: no refusal');
  const pf = (await send('GET', '/api/governance/portfolio', T.pmo)).j;
  assert.equal(pf.dq.projects[full].score, 100); assert.equal(pf.dq.projects[noOwner].rag, 'RED');
  assert.ok(Array.isArray(pf.dq.sites) && pf.dq.sites.length >= 1); assert.equal(pf.dq.policy.status, 'PROPOSED');
  const site = pf.dq.sites.find((s) => s.site_id === null);
  assert.equal(site.required, site.scored_projects * 18, 'Σ required over scored projects');
  // viewer: no money → budget checks left out, never revealed
  const v = await detail(full, T.viewer);
  assert.equal(v.money_hidden, true); assert.equal(v.dq.scope, 'without_budget'); assert.equal(v.dq.required, 16);
  assert.ok(!v.dq.checks.some((c) => c.field === 'budget'));
  const pv = (await send('GET', '/api/governance/portfolio', T.viewer)).j;
  assert.equal(pv.dq.projects[full].scope, 'without_budget');
  const cat = (await send('GET', '/api/governance/intake/catalogue', T.pmo)).j;
  assert.equal(cat.dq_guide.proposed, true); assert.ok(cat.dq_guide.fields.find((f) => f.key === 'name'));
  // the moved-out switch restores today's keys exactly
  await sw({ ppm_data_quality_enabled: '0' });
  assert.deepStrictEqual(Object.keys(await detail(full)).sort(), T.offKeys);
  await sw({ ppm_data_quality_enabled: '1' });
});

test('gate enforced: proposal → approval refused on a blocking error (also in the dry run), allowed once fixed', async () => {
  await sw({ ppm_dq_gate_enforced: '1' });
  const n = await detail(noOwner);
  assert.equal(n.allowed_stages.find((g) => g.to === 'approval').refusal.code, 'GATE_DATA_QUALITY');
  const mv = await send('POST', `/api/governance/portfolio/project/${noOwner}/stage`, T.pmo, { to: 'approval' });
  assert.equal(mv.status, 409, mv.txt); assert.equal(mv.j.code, 'GATE_DATA_QUALITY'); assert.deepStrictEqual(mv.j.blocking, ['it_owner_missing']);
  const ok = await send('POST', `/api/governance/portfolio/project/${full}/stage`, T.pmo, { to: 'approval' });
  assert.equal(ok.status, 200, ok.txt);
  // enforcement works with the shadow switch off too (separate switches)
  await sw({ ppm_data_quality_enabled: '0' });
  assert.equal((await send('POST', `/api/governance/portfolio/project/${noOwner}/stage`, T.pmo, { to: 'approval' })).status, 409);
  // gate off again: the same project moves
  await sw({ ppm_dq_gate_enforced: '0' });
  const mv2 = await send('POST', `/api/governance/portfolio/project/${noOwner}/stage`, T.pmo, { to: 'approval' });
  assert.equal(mv2.status, 200, mv2.txt);
});
