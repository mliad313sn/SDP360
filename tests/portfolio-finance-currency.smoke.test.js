'use strict';
// F-DATA-10 — Finance currency: no silent default. A project amount or a money benefit written without a currency
// is flagged + warned at finance_currency_required = '0' (today) and refused at '1'. Fictitious data only.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-cur-'));
process.env.DASH_USER = process.env.DASH_USER || 'ppmcur-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ppmcur-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ppmcur-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const XLSX = require('xlsx');
const ROOT = _path.join(__dirname, '..');
let server, base, rdb, cfg, obj, T = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 80; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'portfolio_projects' AND column_name = 'currency_defaulted'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const mk = async (u, roles) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('cur_pmo', ['viewer', 'committee-member']);
  T.viewer = await mk('cur_viewer', ['viewer']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', { key: 'cur-prog', name: 'Currency' })).j.id;
  obj = (await put('objective', { programme_id: prog, key: 'cur-o', name: 'O' })).j.id;
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { /* not json */ } return { status: r.status, j }; };
const put = (k, b, t = T.pmo) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const proj = async (id, t = T.pmo) => (await send('GET', `/api/governance/portfolio/project/${id}`, t)).j;
const notes = async (id) => (await rdb.db.prepare("SELECT field, note FROM ppm_events WHERE entity='project' AND entity_id=? AND action='finance_edit' ORDER BY id").all(id)).map((r) => [r.field, r.note]);

test("today ('0'): a budget without a currency is accepted but flagged, noted in the ledger and warned — never a silent USD", async () => {
  assert.equal(cfg.DEFAULTS.finance_currency_required, '0');
  const r = await put('project', { objective_id: obj, key: 'CUR-1', name: 'No currency', budget: 1000 });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.warnings.map((w) => w.code), ['CURRENCY_DEFAULTED']);
  const p = (await proj(r.j.id)).project;
  assert.equal(p.currency_defaulted, 1); assert.equal(p.budget, 1000);
  assert.deepEqual(await notes(r.j.id), [['budget', 'currency_defaulted=true']]);
  T.p1 = r.j.id;
  // a later amount, still no currency: warned again, noted again
  const r2 = await put('project', { id: T.p1, spent: 200 });
  assert.equal(r2.status, 200); assert.equal(r2.j.warnings[0].code, 'CURRENCY_DEFAULTED');
  assert.deepEqual((await notes(T.p1)).pop(), ['spent', 'currency_defaulted=true']);
  // a non-money edit says nothing
  assert.strictEqual((await put('project', { id: T.p1, name: 'No currency (renamed)' })).j.warnings, undefined);
});

test('a stated currency clears the flag; a project created with its currency is never flagged; no amount = no flag', async () => {
  const r = await put('project', { id: T.p1, currency: 'XOF' });
  assert.equal(r.status, 200); assert.strictEqual(r.j.warnings, undefined);
  assert.equal((await proj(T.p1)).project.currency_defaulted, 0);
  assert.strictEqual((await put('project', { id: T.p1, budget: 1500 })).j.warnings, undefined, 'confirmed currency: a new amount is not a default');
  const ok = await put('project', { objective_id: obj, key: 'CUR-2', name: 'With currency', budget: 5, currency: 'USD' });
  assert.strictEqual(ok.j.warnings, undefined); assert.equal((await proj(ok.j.id)).project.currency_defaulted, 0);
  const none = await put('project', { objective_id: obj, key: 'CUR-3', name: 'No amount' });
  assert.strictEqual(none.j.warnings, undefined); assert.strictEqual((await proj(none.j.id)).project.currency_defaulted, null);
  T.p3 = none.j.id;
});

test('a row written before the flag existed (flag NULL, amount present) is left as it is: not known, not guessed', async () => {
  const id = (await put('project', { objective_id: obj, key: 'CUR-L', name: 'Legacy', budget: 9, currency: 'USD' })).j.id;
  await rdb.db.prepare('UPDATE portfolio_projects SET currency_defaulted = NULL WHERE id = ?').run(id);
  const r = await put('project', { id, spent: 1 });
  assert.strictEqual(r.j.warnings, undefined);
  assert.strictEqual((await proj(id)).project.currency_defaulted, null);
});

test('money benefit without a currency: warning today', async () => {
  const b = await put('benefit', { project_id: T.p1, description: 'Lower penalties', value_kind: 'money', target_value: 10 });
  assert.equal(b.status, 200, JSON.stringify(b.j)); assert.deepEqual(b.j.warnings.map((w) => w.code), ['CURRENCY_MISSING']);
  const q = await put('benefit', { project_id: T.p1, description: 'Fewer outages', unit: 'h', target_value: 1 });
  assert.strictEqual(q.j.warnings, undefined, 'a quantity benefit has no currency to state');
  assert.strictEqual((await put('benefit', { id: b.j.id, currency: 'USD' })).j.warnings, undefined);
});

test("finance_currency_required = '1': the same writes are refused (CURRENCY_REQUIRED), nothing is written; with a currency they pass", async () => {
  await cfg.setConfig(rdb.db, { finance_currency_required: '1' }, 'smoke');
  try {
    const r = await put('project', { objective_id: obj, key: 'CUR-4', name: 'Refused', budget: 10 });
    assert.equal(r.status, 400); assert.equal(r.j.code, 'CURRENCY_REQUIRED');
    assert.strictEqual(await rdb.db.prepare("SELECT id FROM portfolio_projects WHERE key = 'CUR-4'").get(), undefined);
    const u = await put('project', { id: T.p3, budget: 10 });
    assert.equal(u.status, 400); assert.equal(u.j.code, 'CURRENCY_REQUIRED');
    assert.strictEqual((await proj(T.p3)).project.budget, null, 'refused = not written');
    assert.equal((await put('project', { id: T.p3, budget: 10, currency: 'XOF' })).status, 200);
    const b = await put('benefit', { project_id: T.p1, description: 'Refused money', value_kind: 'money' });
    assert.equal(b.status, 400); assert.equal(b.j.code, 'CURRENCY_REQUIRED');
    assert.equal((await put('benefit', { project_id: T.p1, description: 'Money with currency', value_kind: 'money', currency: 'XOF' })).status, 200);
    assert.equal((await put('project', { id: T.p3, name: 'renamed while required' })).status, 200, 'a non-money edit is not concerned');
  } finally { await cfg.setConfig(rdb.db, { finance_currency_required: '0' }, 'smoke'); }
});

test('views: the workbook says "default, not confirmed" for the money reader only; the pages carry the wording', async () => {
  const d = (await put('project', { objective_id: obj, key: 'CUR-5', name: 'Shown as default', budget: 77 })).j.id;
  const wb = XLSX.read((await (await fetch(base + '/api/governance/portfolio/workbook.xlsx', { headers: { 'x-report-token': T.pmo } })).arrayBuffer()));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Projects);
  assert.equal(rows.find((r) => r.key === 'CUR-5').currency_status, 'default, not confirmed');
  assert.strictEqual(rows.find((r) => r.key === 'CUR-2').currency_status, undefined);
  const wbV = XLSX.read((await (await fetch(base + '/api/governance/portfolio/workbook.xlsx', { headers: { 'x-report-token': T.viewer } })).arrayBuffer()));
  assert.ok(!XLSX.utils.sheet_to_json(wbV.Sheets.Projects, { header: 1 })[0].includes('currency_status'), 'no money column for a viewer');
  assert.equal((await proj(d)).project.currency_defaulted, 1);
  const read = (f) => _fs.readFileSync(_path.join(ROOT, f), 'utf8');
  assert.match(read('public/project.html'), /currency_defaulted === 1 \|\| !p\.currency \? " <small class=\\"muted\\">\(default, not confirmed\)/);
  assert.match(read('public/portfolio.html'), /in USD by default, not confirmed/);
});

test('docs/ops/FINANCE-CURRENCY-RULES.md: every money path has a rule in code and a pending Finance decision; every cited file exists', () => {
  const doc = _fs.readFileSync(_path.join(ROOT, 'docs', 'ops', 'FINANCE-CURRENCY-RULES.md'), 'utf8');
  assert.match(doc, /not a Finance rule/);
  const rows = doc.split('\n').filter((l) => /^\| (?!Money path|---)/.test(l));
  assert.ok(rows.length >= 8, 'eight money paths or more');
  for (const r of rows) { const c = r.split('|').map((x) => x.trim()); assert.ok(c[3] && c[4], 'rule + decision: ' + c[1]); }
  for (const p of ['Asset purchase cost', 'Software licence', 'Project budget', 'Budget per period', 'Benefit of kind', 'WAN SLA credit']) assert.ok(doc.includes(p), p);
  const files = [...doc.matchAll(/`((?:services|db|docs|tools|public)\/[\w./-]+)`/g)].map((m) => m[1]);
  assert.ok(files.length >= 8);
  for (const f of files) assert.ok(_fs.existsSync(_path.join(ROOT, f)), 'cited file missing: ' + f);
  for (const k of ['finance_currency_required', 'benefit_money_verifier_role', 'benefit_value_class_enabled', 'xof_usd_rate', 'asset_site_currency']) assert.ok(k in cfg.DEFAULTS && doc.includes(k), k);
});
