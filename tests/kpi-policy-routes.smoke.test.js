'use strict';
// C-31 — KPI Policy Builder through the real server and PostgreSQL store (migration 065): who may draft, the author
// cannot adopt their own policy, an adopted version is immutable (route AND database trigger), effective-dated
// supersession, the shadow test is read-only, and kpi_policy_enforced = '0' leaves the screens on today's rule.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'kpi-policy-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'kp-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'kp-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'kp-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const E = require('../services/kpiPolicyEngine');
let server, base, rdb, T = {}, U = {}, hounde;
const KEY = 'helpdesk.resolution_sla_pct';
before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'kpi_policies'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  const h = sites.find((s) => /hounde/i.test(s.name)); hounde = h.id;
  const grp = String(h.zoho_group || 'Hounde IT Agents').split(',')[0].trim();
  // a month of tickets at Hounde: 12 closed, 2 late by the flag, 1 cancelled (flag set), 1 open
  const ins = rdb.db.prepare('INSERT INTO request_records (request_id, request_status, pending_status, overdue_status, tech_group, site, created_time, due_by_time, resolved_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 12; i++) await ins.run('kp-' + i, 'Closed', 0, i < 2 ? 1 : 0, grp, 'HOUNDE', '2026-08-0' + (1 + (i % 9)) + 'T09:00:00.000Z', '2026-08-20T00:00:00.000Z', i === 5 ? '2026-08-25T00:00:00.000Z' : '2026-08-10T00:00:00.000Z');
  await ins.run('kp-c', 'Cancelled', 0, 1, grp, 'HOUNDE', '2026-08-05T09:00:00.000Z', null, null);
  await ins.run('kp-o', 'Open', 1, 0, grp, 'HOUNDE', '2026-08-05T09:00:00.000Z', null, null);
  const mk = async (k, roles, site) => { const u = 'kp_' + k; try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); } catch {} const l = await rdb.login(u, u + 'pass1234'); T[k] = l.token; U[k] = l.user.id; };
  await mk('alice', ['viewer', 'kpi-committee']); await mk('bob', ['viewer', 'kpi-committee']); await mk('super', ['super_admin']);
  await mk('admin', ['admin']); await mk('viewer', ['viewer'], hounde);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const J = async (m, p, t, body) => { const r = await send(m, p, t, body); return { status: r.status, body: await r.json() }; };

test('seed: today’s rules are PROPOSED (imported from code), nothing adopted; enforced = 0 → screens keep today', async () => {
  const r = await J('GET', '/api/kpi-policies?metric=' + KEY, T.viewer);
  assert.equal(r.status, 200); assert.equal(r.body.enforced, false); assert.equal(r.body.can_edit, false);
  const ps = r.body.policies;
  assert.equal(ps.length, 2);
  assert.ok(ps.every((p) => p.status === 'proposed' && p.origin === 'imported_from_code' && p.adopted_by == null && /not yet adopted/.test(p.rationale)));
  const eff = await J('GET', '/api/kpi-policies/effective/' + KEY, T.viewer);
  assert.deepEqual([eff.body.enforced, eff.body.policy, eff.body.page_opts], [false, null, null]);
  assert.equal((await J('GET', '/api/kpi-policies/catalogue', T.viewer)).body.catalogue.datasets.helpdesk_tickets.special.includes('sla_met'), true);
  // nothing adopted yet → the shadow baseline is TODAY'S CODE (helpdesk_sla_definition, server rule, independent of the engine)
  const def = JSON.parse(JSON.stringify(E.IMPORTED_DEFINITIONS[KEY][0].definition)); def.numerator[0].cancelled_never_missed = false;
  const sh = await J('POST', '/api/kpi-policies/shadow', T.alice, { definition: def, metric_key: KEY, as_of: '2026-08-20' });
  assert.equal(sh.status, 200, JSON.stringify(sh.body)); assert.match(sh.body.baseline, /today’s code \(helpdesk_sla_definition = flag\)/);
  const h = sh.body.sites.find((x) => x.site_id === hounde);
  assert.equal(h.baseline.n, 13); assert.equal(h.baseline.value, Math.round((1 - 3 / 13) * 1000) / 10, 'server flag rule: the flagged cancelled ticket counts as missed');
  assert.equal(h.proposed.value, h.baseline.value, 'the same rule expressed as a policy gives the same figure'); assert.equal(h.delta, 0);
});

test('governance: only the committee drafts; only the author proposes; the author cannot adopt; another member adopts; adopted = immutable', async () => {
  const def = JSON.parse(JSON.stringify(E.IMPORTED_DEFINITIONS[KEY][1].definition));
  def.denominator.push({ block: 'field_not_in', field: 'request_status', values: ['Cancelled'] });
  assert.equal((await send('POST', '/api/kpi-policies', T.viewer, { metric_key: KEY, title: 'X draft', definition: def })).status, 403, 'viewer cannot draft');
  assert.equal((await send('POST', '/api/kpi-policies', T.admin, { metric_key: KEY, title: 'X draft', definition: def })).status, 403, 'admin tier alone is not the committee');
  const bad = await J('POST', '/api/kpi-policies', T.alice, { metric_key: KEY, title: 'bad', definition: { ...def, denominator: [] } });
  assert.equal(bad.status, 400); assert.ok(bad.body.errors.some((e) => e.code === 'ratio_without_denominator'));
  assert.equal((await send('POST', '/api/kpi-policies', T.alice, { metric_key: 'no.such', title: 'x draft', definition: def })).status, 400);
  const c = await J('POST', '/api/kpi-policies', T.alice, { metric_key: KEY, title: 'Cancelled out of the denominator', definition: def, rationale: 'ITIL: a cancelled ticket was never served' });
  assert.equal(c.status, 201); const id = c.body.id;
  assert.equal((await send('PUT', `/api/kpi-policies/${id}`, T.bob, { title: 'Cancelled tickets out' })).status, 200, 'any committee member edits a draft');
  assert.equal((await send('POST', `/api/kpi-policies/${id}/propose`, T.bob)).status, 403, 'only the author proposes');
  assert.equal((await send('POST', `/api/kpi-policies/${id}/decide`, T.bob, { decision: 'adopt', committee_ref: 'KPI-2026-11' })).status, 409, 'a draft cannot be adopted');
  assert.equal((await send('POST', `/api/kpi-policies/${id}/propose`, T.alice)).status, 200);
  const view = await J('GET', `/api/kpi-policies/${id}`, T.alice);
  assert.equal(view.body.may_adopt.ok, false, 'the author is told she may not adopt');
  assert.ok(view.body.committee.some((m) => m.id === U.bob));
  const self = await J('POST', `/api/kpi-policies/${id}/decide`, T.alice, { decision: 'adopt', committee_ref: 'KPI-2026-11' });
  assert.equal(self.status, 403, 'the author cannot adopt her own policy'); assert.match(self.body.error, /separation of duties/);
  assert.equal((await send('POST', `/api/kpi-policies/${id}/decide`, T.bob, { decision: 'adopt' })).status, 400, 'a committee reference is required');
  assert.equal((await send('POST', `/api/kpi-policies/${id}/decide`, T.viewer, { decision: 'adopt', committee_ref: 'KPI-2026-11' })).status, 403);
  assert.equal((await J('GET', `/api/kpi-policies/${id}`, T.bob)).body.may_adopt.ok, true);
  assert.equal((await send('POST', `/api/kpi-policies/${id}/decide`, T.bob, { decision: 'adopt', committee_ref: 'KPI-2026-11 PV §3', minutes: 'adopted unanimously', effective_from: '2026-08-01' })).status, 200);
  const p = (await J('GET', `/api/kpi-policies/${id}`, T.viewer)).body;
  assert.equal(p.policy.status, 'adopted'); assert.equal(p.policy.adopted_by, U.bob); assert.equal(p.policy.effective_from, '2026-08-01');
  assert.deepEqual(p.history.decisions.map((d) => [d.decision, d.decided_by, d.committee_ref]), [['adopt', U.bob, 'KPI-2026-11 PV §3']]);
  assert.deepEqual(p.history.events.map((e) => e.action), ['created', 'edited', 'proposed', 'adopted']);
  // immutable: the route refuses, and so does the database
  assert.equal((await send('PUT', `/api/kpi-policies/${id}`, T.super, { title: 'changed' })).status, 409);
  await assert.rejects(rdb.db.prepare("UPDATE kpi_policies SET definition_json='{}' WHERE id=?").run(id), /immutable/);
  await assert.rejects(rdb.db.prepare('DELETE FROM kpi_policies WHERE id=?').run(id), /cannot be deleted/);
  await assert.rejects(rdb.db.prepare("UPDATE kpi_policy_decisions SET committee_ref='forged' WHERE policy_id=?").run(id), /append-only/);
  // a seeded proposal (author = the software) is adopted later by a human, effective after: the first is closed, not edited
  const seeded = (await J('GET', '/api/kpi-policies?metric=' + KEY, T.bob)).body.policies.find((x) => x.version === 1);
  assert.equal((await send('POST', `/api/kpi-policies/${seeded.id}/decide`, T.super, { decision: 'adopt', committee_ref: 'KPI-2026-12', effective_from: '2026-07-01' })).status, 409, 'cannot start before the version in force');
  assert.equal((await send('POST', `/api/kpi-policies/${seeded.id}/decide`, T.super, { decision: 'adopt', committee_ref: 'KPI-2026-12', effective_from: '2026-10-01' })).status, 200);
  const all = (await J('GET', '/api/kpi-policies?metric=' + KEY, T.viewer)).body.policies;
  assert.equal(all.find((x) => x.id === id).effective_to, '2026-10-01', 'superseded at the new start');
  const store = require('../services/kpiPolicyStore').makeKpiPolicyStore(rdb.pgHandle());
  assert.equal((await store.inForce(KEY, '2026-08-15')).id, id, 'history reads the version in force on the day');
  assert.equal((await store.inForce(KEY, '2026-10-15')).id, seeded.id);
  assert.equal(await store.inForce(KEY, '2026-07-15'), null);
  const d = await J('GET', `/api/kpi-policies/${id}/diff?against=${seeded.id}`, T.viewer);
  assert.deepEqual(d.body.changes.map((x) => x.path).sort(), ['denominator', 'numerator']);
});

test('enforced = 0 leaves the Helpdesk tile on today’s rule even with an adopted policy; = 1 hands the page the adopted options', async () => {
  const rc = require('../services/reportConfig');
  const off = await J('GET', '/api/kpi-policies/effective/' + KEY, T.viewer);
  assert.equal(off.body.enforced, false); assert.equal(off.body.page_opts, null, 'switch off → the page keeps HD_SLA_DEFINITION');
  await rc.setConfig(rdb.db, { kpi_policy_enforced: '1' }, 'test');
  try {
    const on = await J('GET', '/api/kpi-policies/effective/' + KEY, T.viewer);
    assert.equal(on.body.enforced, true); assert.ok(on.body.policy);
    assert.deepEqual(on.body.page_opts, { definition: 'flag', excludeCancelled: false, minN: 10, rounding: 1 }, 'the version in force today (seed v1 adopted from 2026-10-01)');
  } finally { await rc.setConfig(rdb.db, { kpi_policy_enforced: '0' }, 'test'); }
  // the Helpdesk page reads it only through HD_SLA_POLICY, which stays {} unless enforced
  const idx = _fs.readFileSync(_path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(idx, /resolutionSla\(rows,\{definition:HD_SLA_DEFINITION,\.\.\.HD_SLA_POLICY\}\)/);
  assert.match(idx, /ep&&ep\.enforced&&ep\.page_opts/);
});

test('shadow test on real data: per-site difference vs today’s code, read-only; reject goes back to draft', async () => {
  const before = Number((await rdb.db.prepare('SELECT COUNT(*) AS n FROM kpi_policies').get()).n);
  const def = JSON.parse(JSON.stringify(E.IMPORTED_DEFINITIONS[KEY][0].definition));
  def.denominator.push({ block: 'field_not_in', field: 'request_status', values: ['Cancelled'] });
  assert.equal((await send('POST', '/api/kpi-policies/shadow', T.viewer, { definition: def, metric_key: KEY })).status, 403);
  const r = await J('POST', '/api/kpi-policies/shadow', T.alice, { definition: def, metric_key: 'other.metric', as_of: '2026-08-20' });
  assert.equal(r.status, 400, 'no baseline for an unknown metric');
  const s = await J('POST', '/api/kpi-policies/shadow', T.alice, { definition: def, metric_key: KEY, as_of: '2026-08-20', against: (await J('GET', '/api/kpi-policies?metric=' + KEY, T.alice)).body.policies.find((x) => x.version === 1).id });
  assert.equal(s.status, 200, JSON.stringify(s.body)); assert.equal(s.body.read_only, true);
  const h = s.body.sites.find((x) => x.site_id === hounde);
  assert.equal(h.baseline.n, 13, 'flag rule: 12 closed + 1 cancelled in the denominator'); assert.equal(h.proposed.n, 12, 'cancelled out');
  assert.equal(h.baseline.value, Math.round((1 - 2 / 13) * 1000) / 10); assert.equal(h.proposed.value, Math.round((1 - 2 / 12) * 1000) / 10);
  assert.ok(s.body.diff.some((x) => x.path === 'denominator'));
  // against today's code (no adopted version for a fresh metric definition → code baseline)
  const pv = await J('POST', '/api/kpi-policies/preview', T.alice, { definition: def, as_of: '2026-08-20' });
  assert.equal(pv.status, 200); assert.equal(pv.body.sites.find((x) => x.site_id === hounde).n, 12);
  const sample = await J('POST', '/api/kpi-policies/preview', T.alice, { definition: def, sample_rows: [{ pending_status: 0, request_status: 'Closed', overdue_status: 0 }] });
  assert.equal(sample.body.result.value, 100); assert.equal(sample.body.result.rag, 'NOT_COMPARABLE', '1 ticket < minimum sample 10');
  assert.equal(Number((await rdb.db.prepare('SELECT COUNT(*) AS n FROM kpi_policies').get()).n), before, 'shadow / preview wrote nothing');
  // reject → back to draft, decision kept
  const c = await J('POST', '/api/kpi-policies', T.bob, { metric_key: KEY, copy_of: (await J('GET', '/api/kpi-policies?metric=' + KEY, T.bob)).body.policies[0].id, title: 'Copy to reject' });
  assert.equal(c.status, 201);
  await send('POST', `/api/kpi-policies/${c.body.id}/propose`, T.bob);
  assert.equal((await send('POST', `/api/kpi-policies/${c.body.id}/decide`, T.alice, { decision: 'reject', committee_ref: 'KPI-2026-11' })).status, 200);
  const p = (await J('GET', `/api/kpi-policies/${c.body.id}`, T.bob)).body;
  assert.equal(p.policy.status, 'draft'); assert.equal(p.history.decisions[0].decision, 'reject');
});
