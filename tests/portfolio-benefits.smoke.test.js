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

// ── F-PRODUCT-03 + F-DATA-09 — value class / basis / measurement window behind benefit_value_class_enabled ──────────
test('value class: switch off → the fields are ignored and the answer is today\'s; on → round trip, coherence refused, totals per class', async () => {
  const cls = { value_class: 'cost_avoidance_estimate', basis: 'estimated_avoidance', measured_from: '2026-01-01', measured_to: '2026-03-31', method_note: 'tickets avoided x mean handling time', source_kind: 'manual' };
  assert.equal(cfg.DEFAULTS.benefit_value_class_enabled, '0');
  const off = await put('benefit', T.pmo, { project_id: pid, description: 'Avoided call-outs', unit: 'call-outs', target_value: 10, ...cls });
  assert.equal(off.status, 200, JSON.stringify(off.j));
  let d = await detail();
  let b = d.benefits.find((x) => x.id === off.j.id);
  assert.strictEqual(b.value_class, null, 'ignored while off'); assert.strictEqual(b.basis, null);
  assert.strictEqual(b.evidence_level, undefined); assert.strictEqual(d.benefit_totals, undefined);
  assert.equal((await send('GET', '/api/governance/ppm/features', T.pmo)).j.benefit_value_class, false);
  await cfg.setConfig(rdb.db, { benefit_value_class_enabled: '1' }, 'smoke');
  try {
    assert.equal((await send('GET', '/api/governance/ppm/features', T.pmo)).j.benefit_value_class, true);
    assert.equal((await put('benefit', T.pmo, { id: off.j.id, ...cls })).status, 200);
    d = await detail(); b = d.benefits.find((x) => x.id === off.j.id);
    assert.deepEqual([b.value_class, b.basis, b.measured_from, b.measured_to, b.source_kind, b.method_note], ['cost_avoidance_estimate', 'estimated_avoidance', '2026-01-01', '2026-03-31', 'manual', 'tickets avoided x mean handling time']);
    assert.equal(b.evidence_level, 'planned'); assert.equal(b.class_label, 'estimate'); assert.equal(b.verification_independent, false);
    // incoherent or unknown values are refused with a code, nothing is written
    const bad = await put('benefit', T.pmo, { id: off.j.id, basis: 'observed' });
    assert.equal(bad.status, 400); assert.equal(bad.j.code, 'CLASS_BASIS');
    assert.equal((await put('benefit', T.pmo, { id: off.j.id, value_class: 'savings' })).j.code, 'VALUE_CLASS');
    assert.equal((await put('benefit', T.pmo, { id: off.j.id, measured_from: '2026-05-01' })).j.code, 'PERIOD');
    assert.equal((await put('benefit', T.pmo, { project_id: pid, description: 'm', value_kind: 'money', basis: 'observed' })).j.code, 'CURRENCY_REQUIRED');
    assert.equal((await detail()).benefits.find((x) => x.id === off.j.id).basis, 'estimated_avoidance', 'refused = not written');
    // an observed benefit in the same unit: the two realised values are never added
    const obs = (await put('benefit', T.pmo, { project_id: pid, description: 'Observed call-outs', unit: 'call-outs', basis: 'observed', value_class: 'productivity_time' })).j.id;
    for (const [id, val] of [[off.j.id, 40], [obs, 6]]) assert.equal((await send('POST', `/api/governance/portfolio/benefit/${id}/realised`, T.pmo, { realised_value: val, evidence_link: 'https://example.test/evidence' })).status, 200);
    d = await detail();
    const tot = d.benefit_totals.filter((g) => g.unit === 'call-outs');
    assert.deepEqual(tot.map((g) => [g.label, g.realised_total]).sort(), [['estimate', 40], ['observed', 6]]);
    assert.ok(!d.benefit_totals.some((g) => g.realised_total === 46), 'never added across classes');
    // verified by another member with no required role: verified, still not "validated"
    assert.equal((await send('POST', `/api/governance/portfolio/benefit/${obs}/verify`, T.cio)).status, 200);
    b = (await detail()).benefits.find((x) => x.id === obs);
    assert.equal(b.evidence_level, 'verified'); assert.equal(b.measurement_class, 'observed'); assert.equal(b.verification_independent, false);
    // changing the class after a verification clears it
    assert.equal((await put('benefit', T.pmo, { id: obs, value_class: 'other' })).status, 200);
    assert.equal((await detail()).benefits.find((x) => x.id === obs).verified_at, null);
    // workbook: class columns present for this reader, the estimate labelled
    const wb = XLSX.read((await (await fetch(base + '/api/governance/portfolio/workbook.xlsx', { headers: { 'x-report-token': T.pmo } })).arrayBuffer()));
    const row = XLSX.utils.sheet_to_json(wb.Sheets.Benefits).find((r) => r.id === off.j.id);
    assert.equal(row.measurement_class, 'estimate'); assert.equal(row.value_class, 'cost_avoidance_estimate');
  } finally { await cfg.setConfig(rdb.db, { benefit_value_class_enabled: '0' }, 'smoke'); }
  assert.strictEqual((await detail()).benefit_totals, undefined, 'off again: today\'s answer');
});

// ── F-PRODUCT-04 — Finance-side verifier for a MONEY benefit, behind benefit_money_verifier_role ('' = today) ───────
test('money verifier role: off = any other member verifies; set = committee member refused (VERIFIER_ROLE), role holder accepted, entrant still refused', async () => {
  assert.equal(cfg.DEFAULTS.benefit_money_verifier_role, '');
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.fin = await mk('ben_fin', ['viewer', 'finance-viewer']);
  T.finpmo = await mk('ben_finpmo', ['viewer', 'committee-member', 'finance-viewer']);
  const money = async (desc) => {
    const id = (await put('benefit', T.pmo, { project_id: pid, description: desc, value_kind: 'money', currency: 'USD', target_value: 100 })).j.id;
    assert.equal((await send('POST', `/api/governance/portfolio/benefit/${id}/realised`, T.pmo, { realised_value: 80, evidence_link: 'https://example.test/ledger' })).status, 200);
    return id;
  };
  const verify = (id, t) => send('POST', `/api/governance/portfolio/benefit/${id}/verify`, t);
  // today ('' ): the finance viewer has no plan-write → refused; another committee member verifies; nothing is stamped
  const m0 = await money('Penalty refund (off)');
  assert.equal((await verify(m0, T.fin)).status, 403, 'no role rule: the plan-write rule applies');
  assert.equal((await verify(m0, T.cio)).status, 200);
  assert.strictEqual((await detail()).benefits.find((x) => x.id === m0).verifier_role_required, null);
  assert.strictEqual((await detail()).money_verifier_role, undefined);
  await cfg.setConfig(rdb.db, { benefit_money_verifier_role: 'finance-viewer', benefit_value_class_enabled: '1' }, 'smoke');
  try {
    const m1 = await money('Penalty refund (role)');
    assert.equal((await put('benefit', T.pmo, { id: m1, basis: 'observed', value_class: 'realised_cash' })).status, 200);
    assert.equal((await send('POST', `/api/governance/portfolio/benefit/${m1}/realised`, T.finpmo, { realised_value: 80, evidence_link: 'https://example.test/ledger' })).status, 200);
    const c = await verify(m1, T.cio);
    assert.equal(c.status, 403); assert.equal(c.j.code, 'VERIFIER_ROLE', 'a committee member without the role');
    const self = await verify(m1, T.finpmo);
    assert.equal(self.status, 403); assert.equal(self.j.code, 'SELF_REVIEW', 'the entrant, even holding the role');
    assert.equal((await verify(m1, T.viewer)).status, 403, 'neither plan-write nor the role');
    const ok = await verify(m1, T.fin);
    assert.equal(ok.status, 200, JSON.stringify(ok.j));
    const d = await detail();
    const b = d.benefits.find((x) => x.id === m1);
    assert.equal(b.verifier_role_required, 'finance-viewer'); assert.equal(b.verification_independent, true); assert.equal(b.measurement_class, 'validated');
    assert.equal(d.money_verifier_role, 'finance-viewer'); assert.equal(d.holds_money_verifier_role, false);
    assert.equal((await detail(T.fin)).holds_money_verifier_role, true);
    // a new realised value clears the verification AND its stamp
    assert.equal((await send('POST', `/api/governance/portfolio/benefit/${m1}/realised`, T.pmo, { realised_value: 81, evidence_link: 'https://example.test/ledger' })).status, 200);
    const b2 = (await detail()).benefits.find((x) => x.id === m1);
    assert.strictEqual(b2.verifier_role_required, null); assert.equal(b2.measurement_class, 'observed');
    // a QUANTITY benefit keeps today's rule (the role does not apply, nothing stamped); the role alone gives no plan-write
    const q = (await put('benefit', T.pmo, { project_id: pid, description: 'Quantity under the role rule', unit: 'h' })).j.id;
    assert.equal((await send('POST', `/api/governance/portfolio/benefit/${q}/realised`, T.pmo, { realised_value: 3, evidence_link: 'https://example.test/q' })).status, 200);
    assert.equal((await verify(q, T.fin)).status, 403, 'the finance role does not open a quantity benefit');
    assert.equal((await verify(q, T.cio)).status, 200);
    assert.strictEqual((await detail()).benefits.find((x) => x.id === q).verifier_role_required, null);
    assert.equal((await put('benefit', T.fin, { project_id: pid, description: 'x' })).status, 403, 'no write right granted');
    // the ledger says which role was required
    const ev = await rdb.db.prepare("SELECT note FROM ppm_events WHERE action='benefit_verified' AND field=? ORDER BY id DESC").get(`benefit:${m1}`);
    assert.match(ev.note, /finance-viewer/);
    // a role name nobody holds blocks money verification (fail closed)
    await cfg.setConfig(rdb.db, { benefit_money_verifier_role: 'no-such-role' }, 'smoke');
    assert.equal((await verify(m1, T.cio)).j.code, 'VERIFIER_ROLE');
    assert.equal((await verify(m1, T.fin)).status, 403);
  } finally { await cfg.setConfig(rdb.db, { benefit_money_verifier_role: '', benefit_value_class_enabled: '0' }, 'smoke'); }
});
