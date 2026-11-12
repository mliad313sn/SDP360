'use strict';
// A1 — Finance verifier over HTTP (fictitious data only): switch off = 404; who may read / certify / revoke
// (finance-viewer never certifies, a verifier who cannot read amounts never certifies, the last editor never
// certifies his own figures); badge only while the certified figures are unchanged; ledger hash-chained and in the
// system log; certification visible in the asset exports; money benefits verified by the finance-verifier.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'fin-cert-'));
process.env.DASH_USER = process.env.DASH_USER || 'fincert-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'fincert-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'fincert-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const XLSX = require('xlsx');
let server, base, rdb, cfg, adb, A, pid, T = {}, U = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig'); adb = require('../assets-db');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'finance_certifications'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  A = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); const l = await rdb.login(u, u + 'pass1234'); U[u] = Number(l.user.id); return l.token; };
  T.viewer = await mk('fc_viewer', ['viewer'], A);
  T.editor = await mk('fc_editor', ['editor'], A);
  T.fviewer = await mk('fc_fviewer', ['viewer', 'finance-viewer']);
  T.verifierOnly = await mk('fc_vonly', ['viewer', 'finance-verifier']);
  T.verifier = await mk('fc_verifier', ['viewer', 'finance-viewer', 'finance-verifier']);
  T.verifier2 = await mk('fc_verifier2', ['viewer', 'finance-viewer', 'finance-verifier']);
  T.adminVerifier = await mk('fc_adminv', ['admin', 'finance-verifier']);
  T.admin = await mk('fc_admin', ['admin']);
  T.super = await mk('fc_super', ['super_admin']);
  T.pmo = await mk('fc_pmo', ['viewer', 'committee-member']);
  await adb.pgHandle().prepare(`INSERT INTO assets (asset_id, asset_name, site, product_type, purchase_cost, acquisition_date) VALUES ('FC-1','fictitious laptop','Hounde','Laptop','1,000,000.00','2025-01-10'), ('FC-2','fictitious desktop','Mana','Desktop','500,000.00','2025-03-01')`).run();
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const put = (k, b) => send('PUT', '/api/governance/portfolio/' + k, T.pmo, b);
  const prog = (await put('programme', { key: 'fc-prog', name: 'Finance' })).j.id;
  const obj = (await put('objective', { programme_id: prog, key: 'fc-o', name: 'O' })).j.id;
  pid = (await put('project', { objective_id: obj, key: 'FC-P1', name: 'Fictitious project', owner: 'fc_pmo', site_id: A })).j.id;
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; };
const raw = async (p, t) => { const r = await fetch(base + p, { headers: { 'x-report-token': t } }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) }; };
const period = new Date().toISOString().slice(0, 7);
const certBody = (o = {}) => ({ scope: 'asset_finance', scope_key: 'fleet', period, evidence: 'Tie-out of the fleet purchase cost to the GL (fictitious)', source: 'Pronto GL extract (fictitious)', evidence_link: 'https://intranet.example/fin/tieout', ...o });
const status = (t, q = {}) => send('GET', '/api/finance/status?' + new URLSearchParams({ scope: 'asset_finance', scope_key: 'fleet', period, ...q }), t);

test('switch off (default): every finance certification route answers 404, today unchanged', async () => {
  assert.equal(cfg.DEFAULTS.finance_certification_enabled, '0');
  await cfg.setConfig(rdb.db, { finance_certification_enabled: '0' }, 'smoke');
  assert.equal((await status(T.verifier)).status, 404);
  assert.equal((await send('POST', '/api/finance/certifications', T.verifier, certBody())).status, 404);
  const x = await raw('/api/assets/finance/export.xlsx', T.admin);
  assert.equal(x.status, 200); assert.ok(!XLSX.read(x.buf).SheetNames.includes('Finance certification'), 'no extra sheet while off');
});

test('read rule: viewer / editor refused (403), finance-viewer and admin read an UNCERTIFIED state', async () => {
  await cfg.setConfig(rdb.db, { finance_certification_enabled: '1' }, 'smoke');
  assert.equal((await status(T.viewer)).status, 403);
  assert.equal((await status(T.editor)).status, 403);
  const s = await status(T.fviewer);
  assert.equal(s.status, 200, JSON.stringify(s.j)); assert.equal(s.j.certified, false); assert.equal(s.j.state, 'uncertified');
  assert.match(s.j.badge.label, /^Non certifié/); assert.equal(s.j.can_certify, false);
  assert.equal((await status(T.admin)).j.state, 'uncertified');
});

test('who certifies: finance-viewer, admin, super_admin and editor never; a verifier without money read never', async () => {
  for (const t of [T.fviewer, T.admin, T.super, T.editor, T.viewer]) { const r = await send('POST', '/api/finance/certifications', t, certBody()); assert.equal(r.status, 403, JSON.stringify(r.j)); assert.equal(r.j.reason, 'VERIFIER_ROLE'); }
  const m = await send('POST', '/api/finance/certifications', T.verifierOnly, certBody());
  assert.equal(m.status, 403); assert.equal(m.j.reason, 'MONEY_SCOPE');
  const bad = await send('POST', '/api/finance/certifications', T.verifier, certBody({ evidence: '' }));
  assert.equal(bad.status, 400); assert.equal(bad.j.reason, 'EVIDENCE');
  assert.equal((await send('POST', '/api/finance/certifications', T.verifier, certBody({ evidence_link: 'javascript:alert(1)' }))).j.reason, 'EVIDENCE_LINK');
});

test('certify → badge "Certifié" with who / when; ledger chained; system log; export sheet names the certifier', async () => {
  const c = await send('POST', '/api/finance/certifications', T.verifier, certBody());
  assert.equal(c.status, 200, JSON.stringify(c.j)); T.c1 = c.j.certification.id;
  const s = await status(T.fviewer);
  assert.equal(s.j.state, 'verified'); assert.equal(s.j.certified, true); assert.match(s.j.badge.label, /^Certifié par fc_verifier le \d{4}-\d{2}-\d{2}/);
  assert.equal(s.j.certification.source, 'Pronto GL extract (fictitious)');
  const ev = await rdb.pgHandle().prepare("SELECT event, actor_name, row_hash FROM finance_certification_events WHERE certification_id = ?").all(T.c1);
  assert.equal(ev.length, 1); assert.equal(ev[0].event, 'certified'); assert.match(ev[0].row_hash, /^[0-9a-f]{64}$/);
  const chain = await require('../services/auditChain').verify(rdb.pgHandle());
  assert.equal(chain.tables.find((x) => x.table === 'finance_certification_events').ok, true);
  await assert.rejects(rdb.pgHandle().prepare("UPDATE finance_certification_events SET note='x' WHERE certification_id=?").run(T.c1), /append-only/);
  await new Promise((r) => setTimeout(r, 200));
  const log = await rdb.pgHandle().prepare("SELECT action, actor FROM system_log WHERE category='finance' AND action='finance_certified'").all();
  assert.ok(log.some((l) => l.actor === 'fc_verifier'), 'certification in the system log');
  const x = await raw('/api/assets/finance/export.xlsx', T.fviewer);
  const wb = XLSX.read(x.buf); assert.ok(wb.SheetNames.includes('Finance certification'));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Finance certification']);
  const af = rows.find((r) => r.Scope === 'asset_finance'); assert.equal(af.State, 'Certifié'); assert.equal(af['Certified by'], 'fc_verifier');
  assert.equal(rows.find((r) => r.Scope === 'depreciation').State, 'Non certifié', 'another scope is not certified by this act');
  assert.equal((await raw('/api/assets/finance/export.xlsx', T.editor)).status, 403, 'invariant 2: no money export for an editor');
  const reg = await raw('/api/finance/certifications/export.xlsx', T.fviewer);
  assert.deepEqual(XLSX.read(reg.buf).SheetNames, ['Certifications', 'Ledger']);
  assert.equal((await raw('/api/finance/certifications/export.xlsx', T.viewer)).status, 403);
});

test('a changed figure removes the certification (stale → "Non certifié"); re-certification supersedes', async () => {
  await adb.pgHandle().prepare("UPDATE assets SET purchase_cost = '1,000,001.00' WHERE asset_id = 'FC-1'").run();
  const s = await status(T.fviewer);
  assert.equal(s.j.state, 'stale'); assert.equal(s.j.certified, false); assert.match(s.j.badge.label, /^Non certifié — chiffres modifiés/);
  const site = await status(T.fviewer, { scope_key: 'site:Mana' });
  assert.equal(site.j.state, 'uncertified', 'a site key is its own target');
  const c = await send('POST', '/api/finance/certifications', T.verifier2, certBody({ evidence: 'Re-tied after the cost correction (fictitious)' }));
  assert.equal(c.status, 200); T.c2 = c.j.certification.id;
  const reg = (await send('GET', '/api/finance/certifications?scope=asset_finance&scope_key=fleet', T.fviewer)).j.certifications;
  assert.equal(reg.find((r) => r.id === T.c1).status, 'superseded'); assert.equal(reg.find((r) => r.id === T.c2).current_state, 'verified');
  assert.ok(!JSON.stringify(reg).match(/1,000,00/), 'the register carries counts, never an amount');
});

test('revoke: verifier only, reason required; the badge comes back; revoked twice = 409', async () => {
  assert.equal((await send('POST', `/api/finance/certifications/${T.c2}/revoke`, T.fviewer, { reason: 'x y z' })).status, 403);
  assert.equal((await send('POST', `/api/finance/certifications/${T.c2}/revoke`, T.verifier, { reason: '' })).status, 400);
  const r = await send('POST', `/api/finance/certifications/${T.c2}/revoke`, T.verifier, { reason: 'Rate source changed (fictitious)' });
  assert.equal(r.status, 200); assert.equal(r.j.certification.status, 'revoked');
  assert.equal((await status(T.fviewer)).j.state, 'uncertified');
  assert.equal((await send('POST', `/api/finance/certifications/${T.c2}/revoke`, T.verifier, { reason: 'again' })).status, 409);
});

test('separation of duties: whoever entered a project actual cannot certify it; another verifier can', async () => {
  await rdb.pgHandle().prepare("INSERT INTO ppm_budget_periods (project_id, period, currency, kind, amount, reason, actor_id, actor, updated_at) VALUES (?, '2026-10', 'XOF', 'actual', 750000, 'fictitious', ?, 'fc_adminv', ?)").run(pid, U.fc_adminv, new Date().toISOString());
  const body = certBody({ scope: 'project_actuals', scope_key: `project:${pid}`, period: '2026-10' });
  const self = await send('POST', '/api/finance/certifications', T.adminVerifier, body);
  assert.equal(self.status, 403); assert.equal(self.j.reason, 'SELF_REVIEW');
  const ok = await send('POST', '/api/finance/certifications', T.verifier, body);
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  assert.equal((await status(T.fviewer, { scope: 'project_actuals', scope_key: `project:${pid}`, period: '2026-10' })).j.state, 'verified');
  assert.equal((await status(T.fviewer, { scope: 'project_actuals', scope_key: 'project:999999', period: '2026-10' })).j.found, false);
});

test('benefits: with the switch on, a MONEY benefit is verified by a finance-verifier (not by any committee member)', async () => {
  await cfg.setConfig(rdb.db, { benefit_money_verifier_role: '' }, 'smoke');
  const b = await send('PUT', '/api/governance/portfolio/benefit', T.pmo, { project_id: pid, description: 'Fictitious saving', value_kind: 'money', currency: 'USD', owner: 'x', review_date: '2026-01-15' });
  assert.equal(b.status, 200, JSON.stringify(b.j));
  const rv = await send('POST', `/api/governance/portfolio/benefit/${b.j.id}/realised`, T.pmo, { realised_value: 1000, evidence_link: 'https://intranet.example/b' });
  assert.equal(rv.status, 200, JSON.stringify(rv.j));
  const committee = await send('POST', `/api/governance/portfolio/benefit/${b.j.id}/verify`, T.admin);
  assert.equal(committee.status, 403); assert.equal(committee.j.code, 'VERIFIER_ROLE');
  const v = await send('POST', `/api/governance/portfolio/benefit/${b.j.id}/verify`, T.verifier);
  assert.equal(v.status, 200, JSON.stringify(v.j));
});
