'use strict';
// AMDEC 2026-11-05 — agent-executed scenario campaign ("UAT simulée", NOT user acceptance).
// Organisation models × personas on a seeded multinational world (tests/_uat-world.js): who sees and
// writes what, on which site, in which country. Scenario ids refer to docs/audits/2026-11-05-amdec/SCENARIOS.md.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const W = require('./_uat-world');

let ctx, w, U, S, R, c;
before(async () => { ctx = await W.boot(); w = await W.seedWorld(ctx); ({ users: U, S, reports: R, call: c } = w); });
after(async () => { if (ctx) await ctx.close(); });

const listSites = async (k) => { const r = await c('GET', '/api/reports', U[k].token); assert.equal(r.status, 200, k + ' ' + r.text); return [...new Set(r.j.map((x) => x.site_name))].sort(); };
const pv = (k, code, dept) => c('POST', '/api/meetings/save', U[k].token, { state: { header: { site_code: code, department: dept || ('uat-' + k), meeting_date: '2026-09-10', status: 'draft' } } });
const ALL = ['Abidjan', 'Assafo', 'Dakar', 'Exploration', 'Hounde', 'Ity', 'Kalana', 'London Office', 'Massawa', 'Ouagadougou', 'Sabodala'];

test('ORG-a central Group IT (site-less admin): lists and reads every site of every country, writes anywhere', async () => {
  assert.deepStrictEqual(await listSites('central'), ALL);
  for (const s of ['Sabodala', 'Massawa', 'Ity', 'London Office']) assert.equal((await c('GET', '/api/reports/' + R[s], U.central.token)).status, 200, s);
  for (const code of ['SGO', 'HGO', 'SMI', 'DKR']) assert.equal((await pv('central', code)).status, 200, code);
});

test('ORG-b federated coordinators: Sabodala and Massawa (same country) are separate scopes', async () => {
  assert.deepStrictEqual(await listSites('edSGO'), ['Sabodala']);
  assert.deepStrictEqual(await listSites('edMAS'), ['Massawa']);
  assert.equal((await c('GET', '/api/reports/' + R.Massawa, U.edSGO.token)).status, 403);
  assert.equal((await c('GET', '/api/reports/' + R.Sabodala, U.edMAS.token)).status, 403);
  assert.equal((await c('PUT', `/api/reports/${R.Massawa}/lights`, U.edSGO.token, [])).status, 403);
});

test('ORG-c multi-site editor across Senegal, Burkina Faso and Côte d\'Ivoire: exactly its three sites in every module', async () => {
  assert.deepStrictEqual(await listSites('ms3'), ['Hounde', 'Ity', 'Sabodala']);
  for (const s of ['Sabodala', 'Hounde', 'Ity']) assert.equal((await c('GET', '/api/reports/' + R[s], U.ms3.token)).status, 200, s);
  for (const s of ['Massawa', 'London Office', 'Dakar']) assert.equal((await c('GET', '/api/reports/' + R[s], U.ms3.token)).status, 403, s);
  for (const code of ['SGO', 'HGO', 'SMI']) assert.equal((await pv('ms3', code)).status, 200, code);
  assert.equal((await pv('ms3', 'DKR')).status, 403);
  assert.deepStrictEqual((await c('GET', '/api/tracker/load', U.ms3.token)).j.scopes, ['SGO', 'HGO', 'ITY']);
  assert.deepStrictEqual((await c('GET', '/api/inspection/lookups', U.ms3.token)).j.scopes, ['SGO', 'HGO', 'SMI'],
    'the same site Ity is SMI in inspection and ITY in tracker — per-module namespaces');
  const aw = await c('GET', '/api/site-awareness/summary?site=' + S.Ity.id, U.ms3.token);
  assert.equal(aw.status, 200); assert.deepStrictEqual(aw.j.authorized_sites.map((x) => x.site_name), ['Sabodala', 'Hounde', 'Ity']);
});

test('ORG-d shared office service desk (Dakar + Abidjan + Ouagadougou, three countries): office PVs only', async () => {
  assert.deepStrictEqual(await listSites('desk'), ['Abidjan', 'Dakar', 'Ouagadougou']);
  for (const code of ['DKR', 'ABJ', 'OUA']) assert.equal((await pv('desk', code)).status, 200, code);
  for (const code of ['SGO', 'HGO']) assert.equal((await pv('desk', code)).status, 403, code);
  assert.equal((await c('GET', '/api/tracker/load', U.desk.token)).status, 403, 'no tracker-editor role: the tracker stays closed');
});

test('ORG-e1 onboarding a new site (Massawa): refused until a super_admin registers its codes; then the editor writes, others unchanged', async () => {
  const before0 = await pv('edMAS', 'MAS');
  assert.equal(before0.status, 403); assert.match(before0.text, /no site assigned for this module/);
  // D-02: the site admin card's onboarding checklist says what Massawa lacks before day one
  const ob0 = (await c('GET', '/api/governance/site-codes', U.central.token)).j.onboarding.find((x) => x.site === 'Massawa');
  for (const item of ['inspection code', 'meetings code', 'coordinator']) assert.ok(ob0.missing.includes(item), item + ' ' + JSON.stringify(ob0.missing));
  assert.equal(ob0.ready, false); assert.equal(ob0.country, 'SN'); assert.equal(ob0.zoho_group, 'Massawa IT Agents');
  assert.equal((await c('PUT', '/api/governance/site-codes/' + S.Massawa.id, U.edMAS.token, { module: 'meetings', code: 'MAS', reason: 'self-service attempt' })).status, 403, 'an editor cannot register codes');
  for (const mod of ['meetings', 'inspection']) {
    const r = await c('PUT', '/api/governance/site-codes/' + S.Massawa.id, U.sa.token, { module: mod, code: 'MAS', reason: 'UAT onboarding Massawa' });
    assert.equal(r.status, 200, r.text);
  }
  assert.equal((await c('PUT', '/api/governance/site-codes/' + S.Massawa.id, U.sa.token, { module: 'meetings', code: 'SGO', reason: 'clash attempt' })).status, 409, 'a code already used by Sabodala');
  const ob1 = (await c('GET', '/api/governance/site-codes', U.central.token)).j.onboarding.find((x) => x.site === 'Massawa');
  assert.ok(!ob1.missing.includes('meetings code') && !ob1.missing.includes('inspection code'), JSON.stringify(ob1.missing));
  assert.equal(ob1.codes.meetings, 'MAS', 'the checklist reads the registry once filled');
  assert.equal((await c('PUT', '/api/governance/site-codes', U.sa.token, { enabled: true, reason: 'UAT registry switched on' })).status, 200);
  try {
    assert.equal((await pv('edMAS', 'MAS')).status, 200);
    assert.deepStrictEqual((await c('GET', '/api/inspection/lookups', U.edMAS.token)).j.scopes, ['MAS']);
    assert.equal((await pv('edSGO', 'SGO', 'uat-after-registry')).status, 200, 'existing sites keep working');
    assert.equal((await pv('edMAS', 'SGO')).status, 403);
  } finally {
    await c('PUT', '/api/governance/site-codes', U.sa.token, { enabled: false, reason: 'UAT registry back off' });
  }
});

test('ORG-e2 Exploration writes PVs and inspections under EXP (hard-coded map); the fill dry-run proposes EXP and writes nothing (AM-03, D-02)', async () => {
  const p = await pv('edEXP', 'EXP');
  assert.equal(p.status, 200, p.text);
  const i = await c('POST', '/api/inspection/save', U.edEXP.token, { state: { meta: { f_site: 'Exploration (EXP)', f_date: '2026-09-10', f_area: 'Camp' }, items: {}, actions: [] } });
  assert.equal(i.status, 200, i.text);
  const d = await c('GET', '/api/governance/site-codes', U.cttee.token);
  assert.ok(d.j.diff.some((x) => x.site === 'Exploration' && x.module === 'meetings' && x.kind === 'missing_in_registry'));
  const plan = d.j.fill_plan;
  assert.equal(plan.dry_run, true);
  for (const mod of ['meetings', 'inspection'])
    assert.ok(plan.proposed.some((x) => x.site === 'Exploration' && x.module === mod && x.code === 'EXP'), mod + ' ' + JSON.stringify(plan.proposed));
  assert.ok(!plan.proposed.some((x) => x.code === 'TND' && x.module === 'tracker'), 'a shared code is never proposed: ' + JSON.stringify(plan.proposed.filter((x) => x.code === 'TND')));
  // Tanda already holds TND in the seeded registry; Assafo's hard-coded TND is skipped, never proposed
  assert.deepStrictEqual(plan.skipped.filter((x) => x.code === 'TND' && x.module === 'tracker').map((x) => [x.site, x.reason]), [['Assafo', 'shared_code']]);
  const again = await c('GET', '/api/governance/site-codes', U.cttee.token);
  assert.ok(again.j.diff.some((x) => x.site === 'Exploration' && x.module === 'meetings' && x.kind === 'missing_in_registry'), 'the dry run wrote nothing');
});

test('ORG-e3 two sites, one tracker code: Assafo and Tanda both resolve to TND — reported; with site_code_shared_block on, their saves are refused (AM-01, D-01)', async () => {
  assert.deepStrictEqual((await c('GET', '/api/tracker/load', U.edASF.token)).j.scopes, ['TND']);
  assert.deepStrictEqual((await c('GET', '/api/tracker/load', U.edTND.token)).j.scopes, ['TND']);
  const d = await c('GET', '/api/governance/site-codes', U.cttee.token);
  const shared = d.j.diff.filter((x) => x.kind === 'shared_code' && x.module === 'tracker');
  assert.deepStrictEqual(shared.map((x) => x.site).sort(), ['Assafo', 'Tanda'], JSON.stringify(shared));
  assert.deepStrictEqual(shared.find((x) => x.site === 'Assafo').shared_with, ['Tanda']);
  const RC = require('../services/reportConfig');
  const D = (await c('GET', '/api/tracker/load', U.edASF.token)).j.D;
  const save = (k) => c('POST', '/api/tracker/save', U[k].token, { D });
  // today (switch off): the save goes through — the merged write scope AM-01 describes; no banner
  assert.equal((await save('edASF')).status, 200);
  const m0 = (await c('GET', '/api/governance/site-codes/mine', U.edASF.token)).j;
  assert.equal(m0.block, false); assert.deepStrictEqual(m0.shared.tracker, [{ code: 'TND', sites: ['Assafo', 'Tanda'] }]);
  await RC.setConfig(ctx.rdb.db, { site_code_shared_block: '1' }, 'uat');
  try {
    for (const k of ['edASF', 'edTND']) {
      const r = await save(k);
      assert.equal(r.status, 409, k + ' ' + r.text);
      assert.equal(r.j.reason, 'site_code_shared'); assert.match(r.j.error, /tracker code TND/); assert.match(r.j.error, /Assafo, Tanda/);
    }
    assert.equal((await save('edSGO')).status, 200, 'a site with its own code saves as before');
    assert.equal((await c('GET', '/api/governance/site-codes/mine', U.edASF.token)).j.block, true, 'the page banner reads this');
    assert.equal((await c('GET', '/api/governance/site-codes/mine', U.edSGO.token)).j.shared.tracker.length, 0);
    // no owner is picked automatically: both editors still resolve to TND
    assert.deepStrictEqual((await c('GET', '/api/tracker/load', U.edTND.token)).j.scopes, ['TND']);
  } finally { await RC.setConfig(ctx.rdb.db, { site_code_shared_block: '0' }, 'uat'); }
});

test('ORG-e3b same guard for meetings and inspection: a second active site resolving to HGO blocks the Hounde editor while the switch is on (D-01)', async () => {
  const RC = require('../services/reportConfig');
  const dup = await ctx.rdb.db.prepare("INSERT INTO sites (name, zoho_group) VALUES ('HOUNDÉ (copy)', NULL) RETURNING id").get();
  const insp = () => c('POST', '/api/inspection/save', U.edHGO.token, { state: { meta: { f_site: 'Hounde (HGO)', f_date: '2026-09-11', f_area: 'Camp' }, items: {}, actions: [] } });
  try {
    await ctx.rdb.db.prepare("UPDATE sites SET name='HOUNDÉ' WHERE id=?").run(Number(dup.id));
    assert.equal((await pv('edHGO', 'HGO', 'uat-e3b')).status, 200, 'switch off: today');
    await RC.setConfig(ctx.rdb.db, { site_code_shared_block: '1' }, 'uat');
    const p = await pv('edHGO', 'HGO', 'uat-e3b');
    assert.equal(p.status, 409, p.text); assert.match(p.j.error, /meetings code HGO/);
    const i = await insp(); assert.equal(i.status, 409, i.text); assert.match(i.j.error, /inspection code HGO/);
    assert.equal((await pv('central', 'HGO', 'uat-e3b-admin')).status, 200, 'the admin tier writes under an explicit code, not a scope');
    assert.equal((await pv('edSGO', 'SGO', 'uat-e3b')).status, 200);
  } finally {
    await RC.setConfig(ctx.rdb.db, { site_code_shared_block: '0' }, 'uat');
    await ctx.rdb.db.prepare('UPDATE sites SET active=0 WHERE id=?').run(Number(dup.id));
  }
});

test('ORG-e4 UK office: country set through the hierarchy API (reason required, super_admin only); no module code → no PV', async () => {
  const id = S['London Office'].id;
  assert.equal((await c('PUT', `/api/governance/sites/${id}/hierarchy`, U.central.token, { country: 'GB', reason: 'admin attempt' })).status, 403);
  assert.equal((await c('PUT', `/api/governance/sites/${id}/hierarchy`, U.sa.token, { country: 'GB' })).status, 400, 'a reason is required');
  const ok = await c('PUT', `/api/governance/sites/${id}/hierarchy`, U.sa.token, { country: 'GB', business_unit: 'Corporate', reason: 'UAT London office' });
  assert.equal(ok.status, 200, ok.text); assert.equal(ok.j.country, 'GB');
  assert.equal((await pv('edLDN', 'LDN')).status, 403);
  assert.equal((await c('GET', '/api/reports/' + R['London Office'], U.edLDN.token)).status, 200, 'the weekly report works for an office without module codes');
});

test('ORG-f business-only accounts: site view only; a site-business user sees its own site, the group-business user every site', async () => {
  assert.equal((await c('GET', '/api/reports', U.bizHGO.token)).status, 403);
  assert.equal((await c('GET', '/api/site-awareness/summary?site=' + S.Hounde.id, U.bizHGO.token)).status, 200);
  assert.equal((await c('GET', '/api/site-awareness/summary?site=' + S.Sabodala.id, U.bizHGO.token)).status, 403);
  const g = await c('GET', '/api/site-awareness/summary?site=' + S.Sabodala.id, U.bizGRP.token);
  assert.equal(g.status, 200); assert.equal(g.j.is_group_view, true);
  assert.equal((await pv('bizHGO', 'HGO')).status, 403);
});

test('ORG-g readers: executive / scorecard-viewer / finance-viewer / viewer each get exactly their slice', async () => {
  const st = async (k, m, p, b) => (await c(m, p, U[k].token, b)).status;
  assert.deepStrictEqual(await listSites('exec'), ALL);
  assert.equal(await st('exec', 'GET', '/api/reports/review-data'), 200);
  assert.equal(await st('scv', 'GET', '/api/reports/review-data'), 200);
  assert.equal(await st('scv', 'GET', '/api/metrics/requests'), 200);
  assert.equal(await st('scv', 'GET', '/api/reports/' + R.Sabodala), 403);
  assert.equal(await st('scv', 'GET', '/api/assets/finance/summary'), 403);
  assert.equal(await st('fin', 'GET', '/api/assets/finance/summary'), 200);
  assert.equal(await st('fin', 'GET', '/api/reports/review-data'), 403);
  assert.equal(await st('central', 'GET', '/api/reports/review-data'), 403, 'IT Review is executive-only (2026-08-31)');
  assert.deepStrictEqual(await listSites('viewer'), []);
  assert.equal(await st('viewer', 'POST', '/api/reports/ensure', { site_id: S.Sabodala.id, year: 2026, week: 38 }), 403);
  assert.equal(await st('viewerSGO', 'GET', '/api/reports/' + R.Sabodala), 200);
  assert.equal(await st('viewerSGO', 'PUT', `/api/reports/${R.Sabodala}/lights`, []), 403, 'a site reader never writes');
});

test('ORG-h field technician: own site only, no PV, no weekly-report write', async () => {
  assert.deepStrictEqual(await listSites('tech'), ['Hounde']);
  assert.equal((await pv('tech', 'HGO')).status, 403);
  assert.equal((await c('PUT', `/api/reports/${R.Hounde}/lights`, U.tech.token, [])).status, 403);
  assert.deepStrictEqual((await c('GET', '/api/inspection/lookups', U.tech.token)).j.scopes, ['HGO']);
});

test('ORG-i KPI committee: the kpi-committee role (C-31) exists and is kept when a user is created', async () => {
  const rdb = ctx.rdb;
  assert.ok(rdb.FEATURE_ROLES_KNOWN.includes('kpi-committee'));
  await rdb.createUser({ username: 'uat_kpi', full_name: 'UAT KPI', password: 'Uat!kpi-' + Date.now(), roles: ['viewer', 'kpi-committee'], site_id: null });
  const u = (await rdb.listUsers()).find((x) => x.username === 'uat_kpi');
  assert.ok((u.roles || []).includes('kpi-committee'), JSON.stringify(u.roles));
});

test('ORG-j deactivated account cannot sign in; Group IT admin has no Site Awareness view (limit AM-11)', async () => {
  assert.equal(await ctx.rdb.login(U.gone.username, U.gone.password), null);
  assert.equal((await c('GET', '/api/site-awareness/summary?site=' + S.Hounde.id, U.central.token)).status, 403);
});
