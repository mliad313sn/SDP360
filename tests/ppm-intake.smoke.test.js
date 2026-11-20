'use strict';
// PORTFOLIO LOT 1 over HTTP, fictitious data only (ppm_intake_register_enabled, PROPOSED, '0' = today).
//   switch off: intake routes 404, project payloads carry NO intake key, intake fields in a body are ignored, no id
//   switch on : PRJ-YYYY-NNN at creation (concurrent creations never share a number, a purge never frees one, the id
//               is immutable even in SQL), intake fields round trip, value states, reference-list rules (retired value
//               kept on its project, refused on a new one), warnings, money rule on the budget metadata, authz
//               (lookup admin = admin tier only; project writes stay committee-only), backfill dry run / apply
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-intake-'));
process.env.DASH_USER = process.env.DASH_USER || 'in-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'in-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'in-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, A, obj, T = {};
const YEAR = new Date().toISOString().slice(0, 4);
const INTAKE_KEYS = require('../services/ppm/intakeFields').INTAKE_COLS;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_lookup_values'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  A = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('in_pmo', ['viewer', 'committee-member']);
  T.adm = await mk('in_adm', ['admin']);
  T.viewer = await mk('in_viewer', ['viewer']);
  T.fin = await mk('in_fin', ['viewer', 'finance-viewer']);
  T.editor = await mk('in_editor', ['editor'], A);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  await sw('0');
  const prog = (await put('programme', T.pmo, { key: 'in-prog', name: 'Intake' })).j.id;
  obj = (await put('objective', T.pmo, { programme_id: prog, key: 'in-o', name: 'O' })).j.id;
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; const txt = await r.text(); try { j = JSON.parse(txt); } catch (_) {} return { status: r.status, j, txt }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (v) => cfg.setConfig(rdb.db, { ppm_intake_register_enabled: v }, 'smoke');
const detail = async (id, t = T.pmo) => (await send('GET', `/api/governance/portfolio/project/${id}`, t)).j;
const listed = async (id, t = T.pmo) => (await send('GET', '/api/governance/portfolio', t)).j.projects.find((p) => p.id === id);

test('switch off (= today): intake routes 404, payloads carry no intake key, intake body fields ignored, no id', async () => {
  await sw('0');
  for (const [m, p, b] of [['GET', '/api/governance/intake/catalogue'], ['GET', '/api/governance/intake/lookups'], ['PUT', '/api/governance/intake/lookups/priority', { code: 'x' }],
    ['POST', '/api/governance/intake/lookups/priority/low/retire', {}], ['POST', '/api/governance/intake/lookups/priority/low/restore', {}], ['PUT', '/api/governance/intake/lookups/priority/order', { codes: ['low'] }]]) {
    assert.equal((await send(m, p, T.adm, b)).status, 404, `${m} ${p}`);
  }
  const c = await put('project', T.pmo, { objective_id: obj, key: 'IN-OFF', name: 'Off project', priority: 'high', avg_fte: 2, project_ref: 'PRJ-1999-001' });
  assert.equal(c.status, 200, c.txt); assert.ok(!c.j.warnings);
  const d = await detail(c.j.id);
  for (const k of INTAKE_KEYS.concat(['planned_duration_days'])) { assert.ok(!(k in d.project), `detail: no ${k}`); assert.ok(!(k in await listed(c.j.id)), `list: no ${k}`); }
  const raw = await rdb.db.prepare('SELECT project_ref, priority, avg_fte FROM portfolio_projects WHERE id=?').get(c.j.id);
  assert.deepStrictEqual({ ...raw, avg_fte: raw.avg_fte }, { project_ref: null, priority: null, avg_fte: null }, 'nothing written while off');
  assert.equal((await send('GET', '/api/governance/ppm/features', T.pmo)).j.intake_register, false);
  // the stage move keeps today's payload too
  const mv = await send('POST', `/api/governance/portfolio/project/${c.j.id}/stage`, T.pmo, { to: 'proposal' });
  if (mv.status === 200) for (const k of INTAKE_KEYS) assert.ok(!(k in mv.j.project), `stage: no ${k}`);
});

test('switch on: PRJ-YYYY-NNN at creation, concurrent creations never share a number, a purge never frees one', async () => {
  await sw('1');
  const many = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => put('project', T.pmo, { objective_id: obj, key: `IN-C${i}`, name: `Concurrent ${i}` })));
  for (const r of many) assert.equal(r.status, 200, r.txt);
  const refs = [];
  for (const r of many) refs.push((await detail(r.j.id)).project.project_ref);
  for (const ref of refs) assert.match(ref, new RegExp(`^PRJ-${YEAR}-\\d{3}$`));
  assert.equal(new Set(refs).size, 6, 'six distinct ids');
  // hard delete one (soft delete off) then create: the freed number is NOT reused
  const top = Math.max(...refs.map((r) => Number(r.split('-').pop())));
  const victim = many.find((r, i) => Number(refs[i].split('-').pop()) === top).j.id;
  const del = await send('DELETE', `/api/governance/portfolio/project/${victim}`, T.pmo); assert.equal(del.status, 200, del.txt);
  const next = await put('project', T.pmo, { objective_id: obj, key: 'IN-AFTER', name: 'After purge' });
  assert.equal(Number((await detail(next.j.id)).project.project_ref.split('-').pop()), top + 1, 'never reused');
  // immutable even in SQL; key stays editable (existing projects keep their key)
  await assert.rejects(rdb.db.prepare('UPDATE portfolio_projects SET project_ref=? WHERE id=?').run('PRJ-1999-999', next.j.id), /immutable/);
  assert.equal((await put('project', T.pmo, { id: next.j.id, key: 'IN-AFTER-2', project_ref: 'PRJ-1999-998' })).status, 200);
  const d = await detail(next.j.id);
  assert.equal(d.project.key, 'IN-AFTER-2'); assert.match(d.project.project_ref, new RegExp(`^PRJ-${YEAR}-`));
});

test('switch on: intake fields round trip (detail + list), aliases, duration, warnings, value states', async () => {
  await sw('1');
  const body = { objective_id: obj, key: 'IN-1', name: 'Fictitious WAN failover', site_id: A, start_date: '2027-03-01', end_date: '2027-03-31',
    project_type: 'network_telecom', tags: ['ot', 'resilience'], priority: 'high', business_need: { current_situation: 'Single link', impact: 'Reporting stops', problem: 'No redundancy', required_outcome: 'Automatic failover' },
    expected_value: 'Under 2 h reporting downtime per quarter', business_sponsor: 'Plant manager', it_owner: 'Site IT', delivery_lead: 'Network team', indicative_quarter: '2027-Q1', schedule_confidence: 'medium',
    budget: 0, currency: 'USD', budget_status: 'requested', budget_reference: 'CAPEX-2027-001', decision_required: 'yes', delivery_effort: 'large', risk_exposure: 'high', avg_fte: 0.5, peak_fte: 1.2,
    required_skills: 'Network engineer', workload_notes: 'Shutdown window in March', value_states: { budget_approval_date: 'tbc', dependencies: 'none_known' } };
  const c = await put('project', T.pmo, body);
  assert.equal(c.status, 200, c.txt);
  assert.deepStrictEqual(c.j.warnings.map((w) => w.code), ['BUDGET_ZERO'], 'zero budget not "not budgeted" is a warning, never a refusal');
  const p = (await detail(c.j.id)).project;
  assert.equal(p.sponsor, 'Plant manager'); assert.equal(p.owner, 'Site IT');
  assert.deepStrictEqual(p.tags, ['ot', 'resilience']); assert.equal(p.business_need.problem, 'No redundancy'); assert.equal(p.avg_fte, 0.5); assert.equal(p.peak_fte, 1.2);
  assert.equal(p.budget, 0, 'zero stays a measured zero'); assert.equal(p.planned_duration_days, 31);
  assert.deepStrictEqual(p.value_states, { budget_approval_date: 'tbc', dependencies: 'none_known' });
  assert.equal((await listed(c.j.id)).priority, 'high');
  // a value clears its state; a state on a field holding a value is refused
  await put('project', T.pmo, { id: c.j.id, budget_approval_date: '2027-01-15' });
  assert.deepStrictEqual((await detail(c.j.id)).project.value_states, { dependencies: 'none_known' });
  const bad = await put('project', T.pmo, { id: c.j.id, value_states: { avg_fte: 'tbc' } });
  assert.equal(bad.status, 400); assert.equal(bad.j.code, 'VALUE_STATE_CONFLICT');
  // roles warning
  const w = await put('project', T.pmo, { id: c.j.id, delivery_lead: 'Site IT', sponsor: 'Site IT' });
  assert.ok(w.j.warnings.some((x) => x.code === 'ROLES_SAME_PERSON'));
  // validation
  for (const [b, code] of [[{ indicative_quarter: 'Q3' }, 'QUARTER_INVALID'], [{ priority: 'urgent' }, 'LOOKUP_VALUE'], [{ avg_fte: 3 }, 'FTE_PEAK_BELOW_AVERAGE'], [{ budget_approval_date: 'TBC' }, 'DATE_INVALID']]) {
    const r = await put('project', T.pmo, { id: c.j.id, ...b }); assert.equal(r.status, 400, JSON.stringify(b)); assert.equal(r.j.code, code);
  }
  // the budget metadata follows the money rule: a viewer reads the plan without it, finance reads it
  const v = (await detail(c.j.id, T.viewer)).project;
  for (const k of ['budget', 'budget_status', 'budget_reference', 'budget_approval_date']) assert.equal(v[k], undefined, `viewer: no ${k}`);
  assert.equal((await listed(c.j.id, T.viewer)).budget_status, undefined);
  assert.equal((await detail(c.j.id, T.fin)).project.budget_reference, 'CAPEX-2027-001');
});

test('switch on: reference lists — catalogue for everyone, admin tier maintains, retire keeps history, locked lists', async () => {
  await sw('1');
  const cat = await send('GET', '/api/governance/intake/catalogue', T.viewer);
  assert.equal(cat.status, 200); assert.ok(cat.j.fields.length >= 20); assert.equal(cat.j.can_admin_lookups, false);
  assert.ok(cat.j.lookups.priority.every((v) => v.proposed), 'priority meanings are PROPOSED');
  assert.ok(cat.j.lookups.priority.every((v) => !v.is_default), 'no default seeded');
  // authz: viewer, committee member, editor refused; admin tier allowed
  for (const t of [T.viewer, T.pmo, T.editor]) {
    assert.equal((await send('GET', '/api/governance/intake/lookups', t)).status, 403);
    assert.equal((await send('PUT', '/api/governance/intake/lookups/project_type', t, { code: 'ot', label_en: 'OT', label_fr: 'OT' })).status, 403);
    assert.equal((await send('POST', '/api/governance/intake/lookups/project_type/other/retire', t, {})).status, 403);
  }
  const add = await send('PUT', '/api/governance/intake/lookups/project_type', T.adm, { code: 'ot_systems', label_en: 'OT systems', label_fr: 'Systèmes OT', color: 'teal', is_default: 1 });
  assert.equal(add.status, 200, add.txt); assert.equal(add.j.value.is_default, true);
  assert.equal((await send('PUT', '/api/governance/intake/lookups/project_type', T.adm, { code: 'other', is_default: 1 })).j.value.is_default, true);
  const all = (await send('GET', '/api/governance/intake/lookups', T.adm)).j.lookups.project_type;
  assert.equal(all.filter((v) => v.is_default).length, 1, 'one default per list');
  assert.equal((await send('PUT', '/api/governance/intake/lookups/project_status', T.adm, { code: 'archived', label_en: 'A', label_fr: 'A' })).j.code, 'LOOKUP_LOCKED');
  assert.equal((await send('POST', '/api/governance/intake/lookups/decision_required/no/retire', T.adm, {})).j.code, 'LOOKUP_LOCKED');
  assert.equal((await send('PUT', '/api/governance/intake/lookups/nowhere', T.adm, { code: 'x' })).status, 404);
  // a project carries the value, then it is retired: the project keeps it, a new project cannot take it
  const p = await put('project', T.pmo, { objective_id: obj, key: 'IN-OT', name: 'OT', project_type: 'ot_systems' });
  assert.equal(p.status, 200, p.txt);
  const ret = await send('POST', '/api/governance/intake/lookups/project_type/ot_systems/retire', T.adm, {});
  assert.equal(ret.status, 200); assert.equal(ret.j.value.active, false); assert.equal(ret.j.referenced_by, 1);
  assert.equal((await detail(p.j.id)).project.project_type, 'ot_systems', 'history kept');
  assert.equal((await put('project', T.pmo, { id: p.j.id, name: 'OT renamed', project_type: 'ot_systems' })).status, 200, 'unchanged retired value stays editable');
  assert.equal((await put('project', T.pmo, { objective_id: obj, key: 'IN-OT2', name: 'OT2', project_type: 'ot_systems' })).j.code, 'LOOKUP_VALUE');
  assert.ok(!(await send('GET', '/api/governance/intake/catalogue', T.viewer)).j.lookups.project_type.some((v) => v.code === 'ot_systems'), 'hidden from new choices');
  assert.equal((await send('POST', '/api/governance/intake/lookups/project_type/ot_systems/restore', T.adm, {})).j.value.active, true);
  const ord = await send('PUT', '/api/governance/intake/lookups/priority/order', T.adm, { codes: ['low', 'medium', 'high', 'critical'] });
  assert.equal(ord.status, 200, ord.txt); assert.deepStrictEqual(ord.j.values.slice().sort((a, b) => a.sort_order - b.sort_order).map((v) => v.code), ['low', 'medium', 'high', 'critical']);
  assert.equal((await send('PUT', '/api/governance/intake/lookups/priority/order', T.adm, { codes: ['low', 'nope'] })).j.code, 'LOOKUP_ORDER');
});

test('switch on: project writes stay committee-only (not widened); RFI conversion copies the problem', async () => {
  await sw('1');
  assert.equal((await put('project', T.editor, { objective_id: obj, key: 'IN-ED', name: 'Editor try', site_id: A })).status, 403);
  assert.equal((await put('project', T.viewer, { objective_id: obj, key: 'IN-VW', name: 'Viewer try' })).status, 403);
  const rfi = await send('POST', '/api/governance/rfi', T.pmo, { kind: 'governance', title: 'Fictitious request', problem: 'The plant has no spare link.' });
  assert.equal(rfi.status, 200, rfi.txt);
  await send('PUT', `/api/governance/rfi/${rfi.j.rfi.id}`, T.pmo, { status: 'accepted' });
  const conv = await send('POST', `/api/governance/rfi/${rfi.j.rfi.id}/to-project`, T.pmo, { objective_id: obj, key: 'IN-RFI' });
  assert.equal(conv.status, 200, conv.txt);
  const p = (await detail(conv.j.project_id)).project;
  assert.match(p.project_ref, new RegExp(`^PRJ-${YEAR}-`)); assert.equal(p.business_need.problem, 'The plant has no spare link.');
});

test('backfill tool: dry run writes nothing; apply numbers the projects without an id from the shared counter', async () => {
  await sw('1');
  const B = require('../tools/ppm/backfill-project-ids');
  const pg = rdb.pgHandle();
  const client = { query: async (sql, params = []) => { const t = String(sql).trim().toUpperCase(); if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(t)) return { rows: [], rowCount: 0 };
    const q = String(sql).replace(/\$\d+/g, () => '?'); const st = pg.prepare(q);
    if (/^\s*(SELECT|INSERT[\s\S]*RETURNING)/i.test(sql)) return { rows: await st.all(...params), rowCount: 0 }; const r = await st.run(...params); return { rows: [], rowCount: Number(r && r.changes) }; } };
  const missing = (await client.query('SELECT id FROM portfolio_projects WHERE project_ref IS NULL')).rows.map((r) => Number(r.id));
  assert.ok(missing.length >= 1, 'the project created while the switch was off has no id');
  const plan = await B.plan(client);
  assert.deepStrictEqual(plan.map((r) => r.id).sort(), missing.slice().sort());
  assert.equal((await client.query('SELECT id FROM portfolio_projects WHERE project_ref IS NULL')).rows.length, missing.length, 'dry run wrote nothing');
  const done = await B.apply(client);
  assert.equal(done.length, missing.length);
  assert.equal((await client.query('SELECT id FROM portfolio_projects WHERE project_ref IS NULL')).rows.length, 0);
  const refs = (await client.query('SELECT project_ref FROM portfolio_projects')).rows.map((r) => r.project_ref);
  assert.equal(new Set(refs).size, refs.length, 'all ids unique');
  assert.deepStrictEqual(await B.apply(client), [], 'idempotent: a second run finds nothing to number');
  assert.equal(B.yearOf(new Date('2025-06-01T00:00:00Z')), 2025); assert.equal(B.yearOf('2024-02-02T10:00:00Z'), 2024);
});
