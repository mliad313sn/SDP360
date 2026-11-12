'use strict';
// B8 — dated FX rates, display currency and the Pronto actuals FILE import over HTTP (fictitious data only):
// switch off = 404; money rule on every amount-bearing route; dry run writes nothing; commit writes ONLY budget
// actuals (ledgered), refuses a duplicate file; round trip reconciles to "unchanged"; imported actuals stay
// "Non certifié"; conversions name the dated rate used and are reproducible.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'fin-imp-'));
process.env.DASH_USER = process.env.DASH_USER || 'finimp-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'finimp-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'finimp-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const XLSX = require('xlsx');
let server, base, rdb, cfg, A, T = {}, P = {};
const FILE = _fs.readFileSync(_path.join(__dirname, 'fixtures', 'pronto', 'actuals-sample.csv'));
const upload = { filename: 'actuals-sample.csv', content_base64: FILE.toString('base64') };
const MAP = { columns: { project_key: 'Job Code', period: 'GL Period', currency: 'Curr', amount: 'Amount' }, date_format: 'DMY' };

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'fx_rates'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  A = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.viewer = await mk('ai_viewer', ['viewer'], A);
  T.editor = await mk('ai_editor', ['editor'], A);
  T.fviewer = await mk('ai_fviewer', ['viewer', 'finance-viewer']);
  T.admin = await mk('ai_admin', ['admin']);
  T.pmo = await mk('ai_pmo', ['viewer', 'committee-member']);
  T.verifier = await mk('ai_verifier', ['viewer', 'finance-viewer', 'finance-verifier']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const put = (k, b) => send('PUT', '/api/governance/portfolio/' + k, T.pmo, b);
  const prog = (await put('programme', { key: 'ai-prog', name: 'Actuals' })).j.id;
  const obj = (await put('objective', { programme_id: prog, key: 'ai-o', name: 'O' })).j.id;
  P.wan = (await put('project', { objective_id: obj, key: 'WAN-2', name: 'Fictitious WAN', owner: 'ai_pmo', site_id: A })).j.id;
  P.erp = (await put('project', { objective_id: obj, key: 'ERP-1', name: 'Fictitious ERP', owner: 'ai_pmo', site_id: A })).j.id;
  await rdb.pgHandle().prepare("INSERT INTO ppm_budget_periods (project_id, period, currency, kind, amount, reason, updated_at) VALUES (?, '2026-10', 'XOF', 'baseline', 1000000, 'fictitious', ?), (?, '2026-10', 'XOF', 'actual', 1000000, 'fictitious', ?)").run(P.wan, 'x', P.wan, 'x');
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; };
const raw = async (p, t) => { const r = await fetch(base + p, { headers: { 'x-report-token': t } }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) }; };
const actuals = () => rdb.pgHandle().prepare("SELECT project_id, period, currency, amount, reason FROM ppm_budget_periods WHERE kind = 'actual' ORDER BY project_id, period, currency").all();

test('switch off (default): rates, conversion, preferences and import all answer 404', async () => {
  assert.equal(cfg.DEFAULTS.actuals_import_enabled, '0');
  await cfg.setConfig(rdb.db, { actuals_import_enabled: '0' }, 'smoke');
  for (const [m, p, t] of [['GET', '/api/finance/fx-rates', T.fviewer], ['GET', '/api/finance/prefs', T.editor], ['GET', '/api/finance/actuals/templates', T.admin], ['POST', '/api/finance/actuals/dry-run', T.admin]]) {
    assert.equal((await send(m, p, t, m === 'POST' ? upload : undefined)).status, 404, p);
  }
});

test('FX rates: money readers read, only the admin tier writes (dated, sourced, never edited); conversion names the rate', async () => {
  await cfg.setConfig(rdb.db, { actuals_import_enabled: '1' }, 'smoke');
  assert.equal((await send('GET', '/api/finance/fx-rates', T.viewer)).status, 403);
  assert.equal((await send('GET', '/api/finance/fx-rates', T.editor)).status, 403);
  assert.equal((await send('GET', '/api/finance/fx-rates', T.fviewer)).status, 200);
  const rate = { currency: 'XOF', effective_from: '2026-07-01', rate: 0.00165, source: 'BCEAO (fictitious)' };
  assert.equal((await send('POST', '/api/finance/fx-rates', T.fviewer, rate)).status, 403);
  const a = await send('POST', '/api/finance/fx-rates', T.admin, rate);
  assert.equal(a.status, 200, JSON.stringify(a.j));
  assert.equal((await send('POST', '/api/finance/fx-rates', T.admin, rate)).status, 409, 'a rate is never edited in place');
  assert.equal((await send('POST', '/api/finance/fx-rates', T.admin, { ...rate, currency: 'GBP' })).status, 400);
  const old = await send('POST', '/api/finance/fx-rates', T.admin, { ...rate, effective_from: '2026-01-01', rate: 0.0016 });
  const c1 = (await send('GET', '/api/finance/convert?amount=1000000&from=XOF&to=USD&date=2026-08-15', T.fviewer)).j.conversion;
  assert.equal(c1.value, 1650); assert.equal(c1.from_rate.id, a.j.rate.id); assert.match(c1.basis, /0\.00165/);
  const c0 = (await send('GET', '/api/finance/convert?amount=1000000&from=XOF&to=USD&date=2026-03-01', T.fviewer)).j.conversion;
  assert.equal(c0.value, 1600); assert.equal(c0.from_rate.id, old.j.rate.id, 'the rate of THAT day');
  assert.deepEqual((await send('GET', '/api/finance/convert?amount=1000000&from=XOF&to=USD&date=2026-08-15', T.fviewer)).j.conversion, c1, 'reproducible');
  const none = (await send('GET', '/api/finance/convert?amount=5&from=EUR&to=USD&date=2026-08-15', T.fviewer)).j.conversion;
  assert.equal(none.value, null, 'no EUR rate → unknown, never 0');
  assert.equal((await send('GET', '/api/finance/convert?amount=5&from=XOF&to=USD', T.editor)).status, 403);
  assert.equal((await send('POST', `/api/finance/fx-rates/${old.j.rate.id}/retire`, T.admin, { reason: 'wrong source (fictitious)' })).status, 200);
  assert.equal((await send('GET', '/api/finance/convert?amount=1000000&from=XOF&to=USD&date=2026-03-01', T.fviewer)).j.conversion.value, null, 'a retired rate is no longer used');
  await new Promise((r) => setTimeout(r, 200));
  const log = await rdb.pgHandle().prepare("SELECT action FROM system_log WHERE category='finance' AND action IN ('fx_rate_added','fx_rate_retired')").all();
  assert.equal(log.filter((l) => l.action === 'fx_rate_added').length, 2); assert.equal(log.filter((l) => l.action === 'fx_rate_retired').length, 1);
});

test('display currency: any session (presentation only), USD/XOF/EUR, default = site currency else USD', async () => {
  const g = await send('GET', '/api/finance/prefs', T.editor);
  assert.equal(g.status, 200); assert.equal(g.j.effective, 'USD'); assert.equal(g.j.presentation_only, true);
  assert.equal((await send('PUT', '/api/finance/prefs', T.editor, { display_currency: 'GBP' })).status, 400);
  const p = await send('PUT', '/api/finance/prefs', T.editor, { display_currency: 'xof' });
  assert.equal(p.j.display_currency, 'XOF'); assert.equal(p.j.effective, 'XOF');
  await cfg.setConfig(rdb.db, { asset_site_currency: JSON.stringify({ Hounde: 'XOF' }) }, 'smoke');
  assert.equal((await send('GET', '/api/finance/prefs', T.viewer)).j.effective, 'XOF', 'the site currency when no preference');
  await cfg.setConfig(rdb.db, { asset_site_currency: '' }, 'smoke');
});

test('import guard: only the admin tier (finance-viewer, editor, committee refused)', async () => {
  for (const t of [T.fviewer, T.editor, T.pmo, T.viewer]) assert.equal((await send('POST', '/api/finance/actuals/dry-run', t, upload)).status, 403);
});

test('dry run: headers first, then row errors + reconciliation; NOTHING written', async () => {
  const before = await actuals();
  const h = await send('POST', '/api/finance/actuals/dry-run', T.admin, upload);
  assert.equal(h.status, 200, JSON.stringify(h.j)); assert.equal(h.j.needs_mapping, true); assert.deepEqual(h.j.file.headers, ['Job Code', 'GL Period', 'Curr', 'Amount', 'Description']);
  const miss = await send('POST', '/api/finance/actuals/dry-run', T.admin, { ...upload, mapping: { ...MAP, columns: { ...MAP.columns, amount: 'Montant' } } });
  assert.equal(miss.status, 400); assert.match(miss.j.error, /Montant/);
  const d = await send('POST', '/api/finance/actuals/dry-run', T.admin, { ...upload, mapping: MAP });
  assert.equal(d.status, 200, JSON.stringify(d.j));
  assert.deepEqual(d.j.errors.map((e) => e.row), [6, 7]);
  const r = d.j.reconciliation;
  assert.equal(r.lines.find((l) => l.project_key === 'WAN-2').status, 'changed');
  assert.equal(r.lines.find((l) => l.project_key === 'WAN-2').delta, 250000);
  assert.equal(r.summary.to_write, 3);
  assert.deepEqual(await actuals(), before, 'dry run writes nothing');
});

test('commit: reason required, row errors refused unless skipped; writes only budget actuals; duplicate file 409', async () => {
  assert.equal((await send('POST', '/api/finance/actuals/commit', T.admin, { ...upload, mapping: MAP, reason: '' })).status, 400);
  const errs = await send('POST', '/api/finance/actuals/commit', T.admin, { ...upload, mapping: MAP, reason: 'October close (fictitious)' });
  assert.equal(errs.status, 400); assert.equal(errs.j.errors.length, 2);
  const tpl = await send('PUT', '/api/finance/actuals/templates', T.admin, { name: 'Pronto GL v1', mapping: MAP });
  assert.equal(tpl.status, 200, JSON.stringify(tpl.j));
  const c = await send('POST', '/api/finance/actuals/commit', T.admin, { ...upload, template: 'Pronto GL v1', reason: 'October close (fictitious)', skip_errors: true });
  assert.equal(c.status, 200, JSON.stringify(c.j)); assert.equal(c.j.batch.rows_written, 3); assert.match(c.j.certification, /not certified/);
  T.batch = c.j.batch.id;
  const rows = await actuals();
  const wan = rows.find((x) => Number(x.project_id) === P.wan && x.period === '2026-10');
  assert.equal(Number(wan.amount), 1250000); assert.match(wan.reason, /^Pronto import [0-9a-f]{12} \(actuals-sample\.csv\): October close/);
  assert.equal(rows.filter((x) => Number(x.project_id) === P.erp).length, 2);
  const ev = await rdb.pgHandle().prepare("SELECT COUNT(*) AS n FROM ppm_events WHERE action = 'budget_period_edit' AND entity_id IN (?, ?)").get(P.wan, P.erp);
  assert.equal(Number(ev.n), 3, 'every write in the hash-chained ledger');
  const dup = await send('POST', '/api/finance/actuals/commit', T.admin, { ...upload, mapping: MAP, reason: 'again', skip_errors: true });
  assert.equal(dup.status, 409);
});

test('round trip: the same file reconciles to "unchanged"; batch export says "Non certifié" until a verifier certifies', async () => {
  const d = await send('POST', '/api/finance/actuals/dry-run', T.admin, { ...upload, mapping: MAP });
  assert.deepEqual([...new Set(d.j.reconciliation.lines.map((l) => l.status))], ['unchanged']);
  assert.equal(d.j.already_imported.batch_id, T.batch);
  await cfg.setConfig(rdb.db, { finance_certification_enabled: '1' }, 'smoke');
  const x = await raw(`/api/finance/actuals/batches/${T.batch}/export.xlsx`, T.admin);
  assert.equal(x.status, 200);
  const wb = XLSX.read(x.buf);
  assert.deepEqual(wb.SheetNames, ['Reconciliation', 'Totals per currency', 'Row errors', 'Batch']);
  const lines = XLSX.utils.sheet_to_json(wb.Sheets.Reconciliation);
  assert.ok(lines.every((l) => l.State === 'Non certifié'), 'imported actuals are not certified');
  assert.deepEqual(XLSX.utils.sheet_to_json(wb.Sheets['Totals per currency']).map((t) => t.Currency), ['USD', 'XOF']);
  const self = await send('POST', '/api/finance/certifications', T.verifier, { scope: 'project_actuals', scope_key: `project:${P.erp}`, period: '2026-10', evidence: 'Matched to the Pronto job ledger (fictitious)', source: 'Pronto job ledger' });
  assert.equal(self.status, 200, JSON.stringify(self.j), 'the importer (admin) is not this verifier');
  const after = XLSX.utils.sheet_to_json(XLSX.read((await raw(`/api/finance/actuals/batches/${T.batch}/export.xlsx`, T.admin)).buf).Sheets.Reconciliation);
  assert.equal(after.find((l) => l.Project === 'ERP-1' && l.Period === '2026-10').State, 'Certifié');
  assert.equal(after.find((l) => l.Project === 'WAN-2').State, 'Non certifié');
  assert.equal((await raw(`/api/finance/actuals/batches/${T.batch}/export.xlsx`, T.fviewer)).status, 403);
});
