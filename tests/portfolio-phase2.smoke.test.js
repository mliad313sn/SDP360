'use strict';
// PORTFOLIO LOT 6 over HTTP, fictitious data only. Six PROPOSED switches, '0' = today (every route 404s).
//   dependencies: a loop across projects is refused (409), an external dependency without an owner is flagged, an
//   unreadable predecessor is refused, another site's project is invisible under the site scope; demand: FTE numeric
//   only, capacity unknown → NA, configured → RAG; effort + residual risk round trip; documents: content checked
//   against the type, a hostile title never reaches the file system, money documents restricted, site scope; scenario
//   read-only; external API: switch + scope gated, non-sensitive projects only, no amount, no person's name.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-p2-'));
process.env.DASH_USER = process.env.DASH_USER || 'p2-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'p2-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'p2-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, A, B, T = {}, P = {}, KEY, KEY_NOSCOPE;
const SW = ['ppm_structured_dependencies_enabled', 'ppm_resource_demand_enabled', 'ppm_effort_scoring_enabled', 'ppm_documents_enabled', 'ppm_scenarios_enabled', 'ext_api_portfolio_enabled'];

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_project_documents'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  A = sites.find((s) => /hounde/i.test(s.name)).id; B = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('p2_pmo', ['viewer', 'committee-member']);
  T.viewA = await mk('p2_viewa', ['viewer'], A);
  T.admin = await mk('p2_admin', ['admin']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  await cfg.setConfig(rdb.db, Object.fromEntries(SW.map((k) => [k, '0'])), 'smoke');
  const prog = (await put('programme', T.pmo, { key: 'p2-prog', name: 'P2' })).j.id;
  const obj = (await put('objective', T.pmo, { programme_id: prog, key: 'p2-o', name: 'O' })).j.id;
  for (const [k, site, extra] of [['A', A, { budget: 1000, currency: 'USD' }], ['B', B, {}], ['C', A, {}], ['S', A, {}]]) {
    const r = await put('project', T.pmo, { objective_id: obj, key: 'P2-' + k, name: 'Project ' + k, site_id: site, owner: 'Owner ' + k, sponsor: 'Sponsor ' + k, start_date: '2027-01-01', end_date: '2027-06-30', status: 'active', ...extra });
    assert.equal(r.status, 200, r.txt); P[k] = r.j.id;
  }
  P.risk = (await put('risk', T.pmo, { project_id: P.A, title: 'Vendor late', probability: 3, impact: 3 })).j.id;
  await rdb.db.prepare('UPDATE portfolio_projects SET sensitive=1 WHERE id=?').run(P.S);
  const mkKey = async (scopes) => (await send('POST', '/api/engagement/consumers', T.admin, { name: 'BI ' + scopes.join(','), scopes, quota_per_day: 5000 })).j.key;
  KEY = await mkKey(['metrics:read', 'portfolio:read']); KEY_NOSCOPE = await mkKey(['metrics:read']);
});
after(() => server && server.close());
const send = async (m, p, t, body, headers) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body !== undefined && !headers ? { 'content-type': 'application/json' } : {}, headers || {}), body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)) }); const buf = Buffer.from(await r.arrayBuffer()); const txt = buf.toString('utf8'); let j = null; try { j = JSON.parse(txt); } catch (_) {} return { status: r.status, j, txt, buf, h: r.headers }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const ext = async (p, key) => { const r = await fetch(base + p, { headers: { 'x-api-key': key } }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (_) {} return { status: r.status, j, txt }; };

test('switches off (= today): every Phase 2 route 404s, the flags read false, the external API has no portfolio set', async () => {
  for (const p of [`/api/governance/ppm/project/${P.A}/dependencies`, `/api/governance/ppm/project/${P.A}/risk-exposure`, `/api/governance/ppm/project/${P.A}/demand`, `/api/governance/ppm/project/${P.A}/effort`, `/api/governance/ppm/project/${P.A}/documents`, '/api/governance/ppm/portfolio/dependencies', '/api/governance/ppm/portfolio/capacity', '/api/governance/ppm/portfolio/effort', '/api/governance/ppm/portfolio/risk-exposure'])
    assert.equal((await send('GET', p, T.pmo)).status, 404, p);
  assert.equal((await send('POST', '/api/governance/ppm/portfolio/scenario', T.pmo, {})).status, 404);
  const f = (await send('GET', '/api/governance/ppm/features', T.pmo)).j;
  for (const k of ['structured_dependencies', 'resource_demand', 'documents', 'effort_scoring', 'scenarios']) assert.equal(f[k], false, k);
  assert.equal((await ext('/ext/v1/portfolio/projects', KEY)).status, 404);
  assert.ok(!(await ext('/ext/odata/', KEY)).j.value.some((s) => /^Portfolio/.test(s.name)));
  assert.ok(!(await ext('/ext/odata/$metadata', KEY)).txt.includes('PortfolioProjects'));
});

test('dependencies: a loop across projects is refused, an external dependency without an owner is flagged', async () => {
  await cfg.setConfig(rdb.db, { ppm_structured_dependencies_enabled: '1' }, 'smoke');
  assert.equal((await send('POST', `/api/governance/ppm/project/${P.A}/dependencies`, T.pmo, { predecessor_project_id: P.B, owner: 'PMO', target_date: '2027-02-01' })).status, 200);
  assert.equal((await send('POST', `/api/governance/ppm/project/${P.B}/dependencies`, T.pmo, { predecessor_project_id: P.C, owner: 'PMO', target_date: '2027-02-01' })).status, 200);
  const loop = await send('POST', `/api/governance/ppm/project/${P.C}/dependencies`, T.pmo, { predecessor_project_id: P.A, owner: 'PMO' });
  assert.equal(loop.status, 409, loop.txt); assert.equal(loop.j.code, 'DEP_CYCLE');
  const self = await send('POST', `/api/governance/ppm/project/${P.A}/dependencies`, T.pmo, { predecessor_project_id: P.A });
  assert.equal(self.status, 400); assert.equal(self.j.code, 'DEP_SELF');
  const ex = await send('POST', `/api/governance/ppm/project/${P.A}/dependencies`, T.pmo, { external_category: 'power', description: 'Grid connection' });
  assert.equal(ex.status, 200, ex.txt);
  const item = ex.j.items.find((i) => i.external_category === 'power');
  assert.ok(item.flags.includes('DEP_EXTERNAL_NO_OWNER'));
  const upd = await send('PUT', `/api/governance/ppm/project/${P.A}/dependencies/${item.id}`, T.pmo, { external_category: 'power', description: 'Grid connection', owner: 'Utility desk', target_date: '2027-03-01' });
  assert.equal(upd.status, 200, upd.txt); assert.deepEqual(upd.j.items.find((i) => i.id === item.id).flags, [], 'owner + date given → no flag');
  assert.equal((await send('PUT', `/api/governance/ppm/project/${P.B}/dependencies/${item.id}`, T.pmo, { external_category: 'power' })).status, 404, 'a row of another project');
  const tmp = await send('POST', `/api/governance/ppm/project/${P.C}/dependencies`, T.pmo, { external_category: 'procurement', owner: 'Buyer' });
  assert.equal((await send('DELETE', `/api/governance/ppm/project/${P.C}/dependencies/${tmp.j.id}`, T.pmo)).status, 200);
  assert.ok(!(await send('GET', `/api/governance/ppm/project/${P.C}/dependencies`, T.pmo)).j.items.some((i) => i.id === tmp.j.id), 'soft-deleted row no longer read');
  const pv = (await send('GET', '/api/governance/ppm/portfolio/dependencies', T.pmo)).j;
  assert.equal(pv.cycles.length, 0); assert.equal(pv.by_code.DEP_EXTERNAL_NO_OWNER, undefined, 'fixed by the update');
  const bad = await send('POST', `/api/governance/ppm/project/${P.A}/dependencies`, T.pmo, { predecessor_project_id: 999999 });
  assert.equal(bad.status, 404, 'an unknown / unreadable predecessor is refused');
  assert.equal((await send('POST', `/api/governance/ppm/project/${P.A}/dependencies`, T.viewA, { external_category: 'power' })).status, 403, 'plan-write rule: a viewer cannot write');
});

test('site scope: another site\'s project and its dependencies are invisible', async () => {
  await cfg.setConfig(rdb.db, { portfolio_site_scope_reads: '1' }, 'smoke');
  try {
    assert.equal((await send('GET', `/api/governance/ppm/project/${P.B}/dependencies`, T.viewA)).status, 404);
    const pv = (await send('GET', '/api/governance/ppm/portfolio/dependencies', T.viewA)).j;
    assert.ok(!pv.items.some((i) => i.project_id === P.B), 'no row of project B');
    const a = (await send('GET', `/api/governance/ppm/project/${P.A}/dependencies`, T.viewA)).j;
    const toB = a.items.find((i) => i.predecessor_readable === false);
    assert.equal(toB.predecessor_label, null, 'no name of a project the reader cannot read');
    assert.equal(toB.predecessor_project_id, null, 'P11 N-R5-4: no id of a project the reader cannot read either');
    assert.ok(!JSON.stringify(a).includes(`"predecessor_project_id":${P.B}`));
  } finally { await cfg.setConfig(rdb.db, { portfolio_site_scope_reads: '0' }, 'smoke'); }
});

test('risk exposure: 4 levels, residual + due date round trip, rollup', async () => {
  const r0 = (await send('GET', `/api/governance/ppm/project/${P.A}/risk-exposure`, T.pmo)).j;
  assert.equal(r0.level, 'critical'); assert.equal(r0.mapping.status, 'PROPOSED');
  const s = await send('PUT', `/api/governance/ppm/project/${P.A}/risks/${P.risk}/residual`, T.pmo, { residual_probability: 1, residual_impact: 2, due_date: '2026-01-01' });
  assert.equal(s.status, 200, s.txt); assert.equal(s.j.level, 'low'); assert.equal(s.j.overdue, 1);
  assert.equal((await send('PUT', `/api/governance/ppm/project/${P.A}/risks/${P.risk}/residual`, T.pmo, { residual_probability: 7 })).status, 400);
  assert.equal((await send('PUT', `/api/governance/ppm/project/${P.B}/risks/${P.risk}/residual`, T.pmo, {})).status, 404, 'a risk of another project');
  const pf = (await send('GET', '/api/governance/portfolio', T.pmo)).j;
  assert.ok(pf.risks.every((r) => !('residual_probability' in r) && !('due_date' in r)), 'existing payloads keep today\'s shape');
});

test('demand: FTE numeric only; capacity unknown → NA, configured → RAG with PROPOSED thresholds', async () => {
  await cfg.setConfig(rdb.db, { ppm_resource_demand_enabled: '1', ppm_capacity_fte: '' }, 'smoke');
  const bad = await send('POST', `/api/governance/ppm/project/${P.A}/demand`, T.pmo, { skill: 'Network engineer', avg_fte: 'medium' });
  assert.equal(bad.status, 400); assert.equal(bad.j.code, 'FTE_NUMERIC');
  assert.equal((await send('POST', `/api/governance/ppm/project/${P.A}/demand`, T.pmo, { skill: 'Network engineer', avg_fte: 0.6, peak_fte: 1, start_month: '2027-01', finish_month: '2027-02', sourcing: 'internal' })).status, 200);
  assert.equal((await send('POST', `/api/governance/ppm/project/${P.C}/demand`, T.pmo, { skill: 'network engineer', avg_fte: 0.5, start_month: '2027-02', finish_month: '2027-02' })).status, 200);
  const extra = await send('POST', `/api/governance/ppm/project/${P.B}/demand`, T.pmo, { skill: 'Electrician', avg_fte: 1 });
  const ed = await send('PUT', `/api/governance/ppm/project/${P.B}/demand/${extra.j.id}`, T.pmo, { skill: 'Electrician', avg_fte: 2, peak_fte: 1 });
  assert.equal(ed.status, 400); assert.equal(ed.j.code, 'FTE_PEAK');
  assert.equal((await send('PUT', `/api/governance/ppm/project/${P.B}/demand/${extra.j.id}`, T.pmo, { skill: 'Electrician', avg_fte: 0.2 })).status, 200);
  assert.equal((await send('DELETE', `/api/governance/ppm/project/${P.B}/demand/${extra.j.id}`, T.pmo)).status, 200);
  assert.equal((await send('GET', `/api/governance/ppm/project/${P.B}/demand`, T.pmo)).j.lines.length, 0);
  let c = (await send('GET', '/api/governance/ppm/portfolio/capacity', T.pmo)).j;
  assert.equal(c.capacity_configured, false); assert.ok(c.cells.every((x) => x.rag === 'NA' && x.utilisation_pct === null));
  await cfg.setConfig(rdb.db, { ppm_capacity_fte: '{"Network engineer": 1}' }, 'smoke');
  c = (await send('GET', '/api/governance/ppm/portfolio/capacity', T.pmo)).j;
  assert.equal(c.cells.find((x) => x.month === '2027-02').rag, 'RED'); assert.equal(c.cells.find((x) => x.month === '2027-01').rag, 'GREEN');
});

test('effort scoring: partial → null, full → score + band, mismatch never applied', async () => {
  await cfg.setConfig(rdb.db, { ppm_effort_scoring_enabled: '1' }, 'smoke');
  assert.equal((await send('GET', `/api/governance/ppm/project/${P.A}/effort`, T.pmo)).j.score, null);
  const f = { technical_complexity: 5, integration_complexity: 5, procurement_complexity: 4, site_impact: 4, stakeholder_count: 3, cross_site_coverage: 3, change_impact: 4 };
  const s = await send('PUT', `/api/governance/ppm/project/${P.A}/effort`, T.pmo, { factors: f });
  assert.equal(s.status, 200, s.txt); assert.equal(s.j.score, 80); assert.equal(s.j.band, 'very_large');
  assert.equal((await send('PUT', `/api/governance/ppm/project/${P.A}/effort`, T.pmo, { factors: { technical_complexity: 9 } })).status, 400);
  assert.ok((await send('GET', '/api/governance/ppm/portfolio/effort', T.pmo)).j.rows.some((r) => r.project_id === P.A && r.score === 80));
});

test('documents: typed upload, content check, hostile title, versions, money documents, site scope', async () => {
  await cfg.setConfig(rdb.db, { ppm_documents_enabled: '1' }, 'smoke');
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 1)]);
  const up = (id, q, buf, mime, t = T.pmo) => send('POST', `/api/governance/ppm/project/${id}/documents${q}`, t, buf, { 'content-type': mime });
  const a = await send('POST', `/api/governance/ppm/project/${P.A}/documents?doc_type=design&title=${encodeURIComponent('../../../etc/passwd')}`, T.pmo, pdf, { 'content-type': 'application/pdf' });
  assert.equal(a.status, 200, a.txt); assert.equal(a.j.document.version, 1); assert.equal('blob_ref' in a.j.document, false);
  assert.equal((await up(P.A, '?doc_type=design&title=' + encodeURIComponent('../../../etc/passwd'), pdf, 'application/pdf')).j.document.version, 2, 'same type + title = new version');
  const row = await rdb.db.prepare('SELECT blob_ref FROM ppm_project_documents WHERE id=?').get(a.j.document.id);
  assert.match(row.blob_ref, new RegExp(`^ppm-doc/p${P.A}/[0-9a-f-]{36}\\.pdf$`), 'server-chosen name, no client path');
  assert.equal((await up(P.A, '?doc_type=design&title=Fake', Buffer.from('MZ\x90\x00binary'), 'application/pdf')).status, 415);
  assert.equal((await up(P.A, '?doc_type=design&title=Exe', pdf, 'application/x-msdownload')).status, 415);
  assert.equal((await up(P.A, '?doc_type=nope&title=Exe', pdf, 'application/pdf')).status, 400);
  const dl = await send('GET', `/api/governance/ppm/project/${P.A}/documents/${a.j.document.id}/download`, T.pmo);
  assert.equal(dl.status, 200); assert.ok(dl.buf.equals(pdf)); assert.equal(dl.h.get('x-content-type-options'), 'nosniff');
  assert.ok(!/[\\/]/.test(dl.h.get('content-disposition').split('filename=')[1]), 'no path in the file name');
  assert.equal((await send('GET', `/api/governance/ppm/project/${P.B}/documents/${a.j.document.id}/download`, T.pmo)).status, 404, 'a document of another project');
  const q = await up(P.A, '?doc_type=vendor_quotation&title=Quote', pdf, 'application/pdf');
  assert.equal(q.status, 200, q.txt);
  assert.equal((await up(P.A, '?doc_type=vendor_quotation&title=Quote2', pdf, 'application/pdf', T.viewA)).status, 403);
  const list = (await send('GET', `/api/governance/ppm/project/${P.A}/documents`, T.viewA)).j;
  const ql = list.documents.find((d) => d.doc_type === 'vendor_quotation');
  assert.equal(ql.restricted, true); assert.equal(ql.download, false);
  assert.equal(ql.title, null, 'P11 R5-6: the title of a money document is masked for a non-amount reader'); assert.equal(ql.title_masked, true);
  assert.equal((await send('GET', `/api/governance/ppm/project/${P.A}/documents`, T.pmo)).j.documents.find((d) => d.doc_type === 'vendor_quotation').title, 'Quote', 'an amount reader sees it');
  assert.ok(list.documents.every((d) => !Object.keys(d).some((k) => /budget|amount|cost|currency|blob/.test(k))), 'money-free metadata');
  assert.equal((await send('GET', `/api/governance/ppm/project/${P.A}/documents/${q.j.document.id}/download`, T.viewA)).status, 403);
  await cfg.setConfig(rdb.db, { portfolio_site_scope_reads: '1' }, 'smoke');
  try { assert.equal((await send('GET', `/api/governance/ppm/project/${P.B}/documents`, T.viewA)).status, 404); } finally { await cfg.setConfig(rdb.db, { portfolio_site_scope_reads: '0' }, 'smoke'); }
  assert.equal((await send('DELETE', `/api/governance/ppm/project/${P.A}/documents/${a.j.document.id}`, T.viewA)).status, 403);
  assert.equal((await send('DELETE', `/api/governance/ppm/project/${P.A}/documents/${a.j.document.id}`, T.pmo)).status, 200);
  assert.equal((await send('GET', `/api/governance/ppm/project/${P.A}/documents/${a.j.document.id}/download`, T.pmo)).status, 404, 'soft-deleted');
});

test('scenario: read-only; shifting a dependent after its predecessor removes a conflict; nothing is written', async () => {
  await cfg.setConfig(rdb.db, { ppm_scenarios_enabled: '1' }, 'smoke');
  const before = await rdb.db.prepare('SELECT id, start_date, end_date FROM portfolio_projects ORDER BY id').all();
  const r = await send('POST', '/api/governance/ppm/portfolio/scenario', T.pmo, { shifts: [{ project_id: P.A, months: 7 }] });
  assert.equal(r.status, 200, r.txt); assert.equal(r.j.read_only, true);
  assert.equal(r.j.baseline.dependency_conflicts, 2, 'A waits for B and B for C, all on the same dates'); assert.equal(r.j.delta.dependency_conflicts, -1);
  assert.equal((await send('POST', '/api/governance/ppm/portfolio/scenario', T.pmo, { shifts: [{ project_id: 999999, months: 1 }] })).status, 400);
  assert.deepStrictEqual(await rdb.db.prepare('SELECT id, start_date, end_date FROM portfolio_projects ORDER BY id').all(), before);
});

test('external API: switch + scope gated, non-sensitive only, no amount, no person name', async () => {
  await cfg.setConfig(rdb.db, { ext_api_portfolio_enabled: '1' }, 'smoke');
  assert.equal((await ext('/ext/v1/portfolio/projects', KEY_NOSCOPE)).status, 403);
  const r = await ext('/ext/v1/portfolio/projects', KEY);
  assert.equal(r.status, 200, r.txt);
  const ids = r.j.projects.map((p) => p.Id);
  assert.ok(ids.includes(P.A) && !ids.includes(P.S), 'sensitive project never exported');
  assert.ok(!/Owner A|Sponsor A|1000|USD|budget|currency/i.test(r.txt), 'no amount, no person name');
  assert.equal(r.j.projects.find((p) => p.Id === P.A).RiskExposure, 'low');
  const d = await ext('/ext/odata/PortfolioDependencyLinks', KEY); assert.equal(d.status, 200, d.txt);
  const dm = await ext('/ext/odata/PortfolioDemands', KEY); assert.equal(dm.status, 200, dm.txt); assert.ok(dm.j.value.some((x) => x.Skill === 'Network engineer'));
  assert.equal((await ext('/ext/v1/portfolio/dependencies', KEY)).status, 200); assert.equal((await ext('/ext/v1/portfolio/demand', KEY)).status, 200);
  assert.ok(!/PMO|Grid connection/.test(d.txt), 'no owner / free-text description exported');
  assert.equal((await ext('/ext/odata/PortfolioProjects?$select=Budget', KEY)).status, 400, 'no money property exists');
  assert.ok((await ext('/ext/odata/$metadata', KEY)).txt.includes('PortfolioProjects'));
  assert.equal((await ext('/ext/v1/portfolio/nope', KEY)).status, 404);
});
