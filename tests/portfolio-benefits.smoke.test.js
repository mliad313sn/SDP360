'use strict';
// B-08 — benefit record on portfolio projects over HTTP (fictitious data only): define, realise with evidence,
// four-eyes verification (SELF_REVIEW), terms change clears the verification, money read rule, the A09 line on the
// Site obligations view and on "My work", the workbook sheet. No switch: today nobody has a benefit, nothing changes.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-ben-'));
process.env.DASH_USER = process.env.DASH_USER || 'ppmben-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ppmben-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ppmben-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const XLSX = require('xlsx');
let server, base, rdb, cfg, A, B, pid, T = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'portfolio_benefits'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  A = sites.find((s) => /hounde/i.test(s.name)).id; B = sites.find((s) => /^mana$/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('ben_pmo', ['viewer', 'committee-member']);
  T.cio = await mk('ben_cio', ['viewer', 'committee-member']);
  T.viewer = await mk('ben_viewer', ['viewer'], A);
  T.edA = await mk('ben_eda', ['editor'], A);
  T.edB = await mk('ben_edb', ['editor'], B);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'ben-prog', name: 'Benefits' })).j.id;
  const obj = (await put('objective', T.pmo, { programme_id: prog, key: 'ben-o', name: 'O' })).j.id;
  pid = (await put('project', T.pmo, { objective_id: obj, key: 'BEN-1', name: 'Second WAN link', owner: 'ben_pmo', site_id: A })).j.id;
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const detail = async (t = T.pmo) => (await send('GET', `/api/governance/portfolio/project/${pid}`, t)).j;
const past = '2026-01-15';

test('define: committee adds a benefit; a site editor is refused while plan writes are off (today)', async () => {
  await cfg.setConfig(rdb.db, { portfolio_editor_plan_writes: '0' }, 'smoke');
  const r = await put('benefit', T.pmo, { project_id: pid, description: 'Fewer unplanned WAN outages', measure: 'unplanned outage hours', unit: 'hours / month', baseline_value: 12, target_value: 4, owner: 'Site GM', review_date: past });
  assert.equal(r.status, 200, JSON.stringify(r.j)); T.b1 = r.j.id;
  assert.equal((await put('benefit', T.edA, { project_id: pid, description: 'x' })).status, 403);
  const bad = await put('benefit', T.pmo, { project_id: pid, description: 'x', review_date: '15/01/2026' });
  assert.equal(bad.status, 400);
  const d = await detail(T.viewer);
  const b = d.benefits.find((x) => x.id === T.b1);
  assert.equal(b.state, 'review_due'); assert.equal(b.target_value, 4); assert.equal(b.review_due, true);
});

test('A09 line: the Site obligations view and My work show the benefit whose review date is reached', async () => {
  const ob = await send('GET', `/api/obligations?site=${A}`, T.edA);
  assert.equal(ob.status, 200); assert.equal(ob.j.registers.benefit_reviews, 'read');
  const line = ob.j.items.find((x) => x.register === 'benefit_review' && x.id === T.b1);
  assert.ok(line, 'benefit line present'); assert.equal(line.status, 'missing'); assert.equal(line.overdue, true); assert.equal(line.link, `project.html?id=${pid}#benefits`);
  const other = await send('GET', `/api/obligations?site=${B}`, T.edB);
  assert.ok(!other.j.items.some((x) => x.register === 'benefit_review'), 'another site does not see it');
  const w = await send('GET', '/api/me/work', T.edA);
  assert.equal(w.status, 200); assert.equal(w.j.sites[0].benefit_reviews.count, 1);
});

test('realise: evidence must be an http(s) link; a valid entry waits for verification', async () => {
  const noLink = await send('POST', `/api/governance/portfolio/benefit/${T.b1}/realised`, T.pmo, { realised_value: 5, evidence_link: 'javascript:alert(1)' });
  assert.equal(noLink.status, 400);
  const ok = await send('POST', `/api/governance/portfolio/benefit/${T.b1}/realised`, T.pmo, { realised_value: 5, evidence_link: 'https://intranet.example/wan/kpi', note: 'six-month average' });
  assert.equal(ok.status, 200, JSON.stringify(ok.j)); assert.equal(ok.j.benefit.state, 'awaiting_verification'); assert.equal(ok.j.benefit.realised_by_name, 'ben_pmo');
  const ob = await send('GET', `/api/obligations?site=${A}`, T.edA);
  assert.equal(ob.j.items.find((x) => x.id === T.b1 && x.register === 'benefit_review').status, 'awaiting_verification');
});

test('verify: the person who entered the value is refused (SELF_REVIEW); another member verifies; the line disappears', async () => {
  const self = await send('POST', `/api/governance/portfolio/benefit/${T.b1}/verify`, T.pmo);
  assert.equal(self.status, 403); assert.equal(self.j.code, 'SELF_REVIEW');
  assert.equal((await send('POST', `/api/governance/portfolio/benefit/${T.b1}/verify`, T.viewer)).status, 403, 'a viewer cannot verify');
  const ok = await send('POST', `/api/governance/portfolio/benefit/${T.b1}/verify`, T.cio);
  assert.equal(ok.status, 200, JSON.stringify(ok.j)); assert.equal(ok.j.benefit.state, 'verified'); assert.equal(ok.j.benefit.verified_by_name, 'ben_cio');
  const ob = await send('GET', `/api/obligations?site=${A}`, T.edA);
  assert.ok(!ob.j.items.some((x) => x.register === 'benefit_review' && x.id === T.b1));
  const ev = (await send('GET', `/api/governance/portfolio/project/${pid}/history`, T.pmo)).j.events.map((e) => e.action);
  assert.ok(ev.includes('benefit_realised') && ev.includes('benefit_verified'), ev.join(','));
  const nothing = await put('benefit', T.pmo, { project_id: pid, description: 'Not realised yet' });
  const early = await send('POST', `/api/governance/portfolio/benefit/${nothing.j.id}/verify`, T.cio);
  assert.equal(early.status, 409); assert.equal(early.j.code, 'NOT_REALISED');
});

test('a change of target after verification clears it; editing the owner does not', async () => {
  await put('benefit', T.pmo, { id: T.b1, owner: 'Site manager' });
  assert.equal((await detail()).benefits.find((x) => x.id === T.b1).state, 'verified');
  await put('benefit', T.pmo, { id: T.b1, target_value: 3 });
  const b = (await detail()).benefits.find((x) => x.id === T.b1);
  assert.equal(b.state, 'awaiting_verification'); assert.equal(b.verified_at, null);
  assert.ok((await send('GET', `/api/governance/portfolio/project/${pid}/history`, T.pmo)).j.events.some((e) => e.action === 'benefit_unverified'));
});

test('money read rule: a money benefit is written only by a money reader and its values are hidden from others', async () => {
  const m = await put('benefit', T.pmo, { project_id: pid, description: 'Lower ISP penalties', value_kind: 'money', currency: 'USD', baseline_value: 90000, target_value: 30000, review_date: '2099-01-01' });
  assert.equal(m.status, 200, JSON.stringify(m.j));
  const v = (await detail(T.viewer)).benefits.find((x) => x.id === m.j.id);
  assert.equal(v.values_hidden, true); assert.equal(v.target_value, undefined); assert.equal(v.description, 'Lower ISP penalties');
  assert.ok(!JSON.stringify((await send('GET', '/api/governance/portfolio', T.viewer)).j.benefits).includes('90000'));
  assert.equal((await detail(T.pmo)).benefits.find((x) => x.id === m.j.id).target_value, 30000);
  await cfg.setConfig(rdb.db, { portfolio_editor_plan_writes: '1' }, 'smoke');
  try {
    const ed = await put('benefit', T.edA, { id: m.j.id, target_value: 1 });
    assert.equal(ed.status, 403); assert.equal(ed.j.code, 'MONEY_SCOPE');
    const q = await put('benefit', T.edA, { project_id: pid, description: 'Faster site onboarding', unit: 'days', target_value: 2 });
    assert.equal(q.status, 200, 'an editor of the site may maintain a quantity benefit when plan writes are on');
    assert.equal((await put('benefit', T.edB, { id: q.j.id, owner: 'x' })).status, 403, 'not another site');
  } finally { await cfg.setConfig(rdb.db, { portfolio_editor_plan_writes: '0' }, 'smoke'); }
  const wbV = XLSX.read((await (await fetch(base + '/api/governance/portfolio/workbook.xlsx', { headers: { 'x-report-token': T.viewer } })).arrayBuffer()));
  assert.ok(wbV.SheetNames.includes('Benefits'));
  assert.ok(!/90000|30000/.test(XLSX.utils.sheet_to_csv(wbV.Sheets.Benefits)), 'no money in the viewer workbook');
  const wbC = XLSX.read((await (await fetch(base + '/api/governance/portfolio/workbook.xlsx', { headers: { 'x-report-token': T.pmo } })).arrayBuffer()));
  assert.ok(XLSX.utils.sheet_to_json(wbC.Sheets.Benefits).some((r) => r.target_value === 30000));
});
