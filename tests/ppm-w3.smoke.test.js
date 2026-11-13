'use strict';
// W3-GOVERNANCE over HTTP, fictitious data only. Every new action is 404 while its PROPOSED switch is '0' (= today).
//   T9  gate checklist negatives (owner, non-approver, reason, slot taken, incomplete → stage 409) + append-only;
//       composite RAG stored with hysteresis memory
//   T10 the summary cards reconcile to the engines; Simplified/Expert preference per user
//   T11 DCMA 14 points over HTTP
//   RAID amounts only for the admin tier + finance-viewer; reports; switches off = today
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-w3-'));
process.env.DASH_USER = process.env.DASH_USER || 'w3-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'w3-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'w3-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, A, B, obj, pid, T = {}, ID = {};
const ALL = { ppm_simplified_view_enabled: '1', ppm_project_rag_enabled: '1', ppm_dcma_enabled: '1', ppm_gate_checklist_enabled: '1', ppm_raid_enabled: '1', ppm_project_report_enabled: '1' };
const OFF = Object.fromEntries(Object.keys(ALL).map((k) => [k, '0']));

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_gate_signoffs'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  A = sites.find((s) => /hounde/i.test(s.name)).id; B = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); ID[u] = Number(((await rdb.listUsers()) || []).find((x) => x.username === u).id); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('w3_pmo', ['viewer', 'committee-member']);
  T.cio = await mk('w3_cio', ['viewer', 'committee-member']);
  T.owner = await mk('w3_owner', ['viewer', 'committee-member']);
  T.adm = await mk('w3_adm', ['admin']);
  T.fin = await mk('w3_fin', ['viewer', 'finance-viewer']);
  T.viewer = await mk('w3_viewer', ['viewer']);
  T.editorB = await mk('w3_editor_b', ['editor'], B);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'w3-prog', name: 'W3' })).j.id;
  obj = (await put('objective', T.pmo, { programme_id: prog, key: 'w3-o', name: 'O' })).j.id;
  pid = (await put('project', T.pmo, { objective_id: obj, key: 'W3-1', name: 'Fictitious backbone refresh', owner: 'w3_owner', sponsor: 'Sponsor', site_id: A, start_date: '2026-11-02', end_date: '2026-11-30',
    charter: 'Refresh the fictitious backbone switches and document the cut-over and rollback tests.', baseline_start: '2026-11-02', baseline_end: '2026-11-20' })).j.id;
  const t1 = (await put('task', T.pmo, { project_id: pid, name: 'Design', start_date: '2026-11-02', duration_days: 5, effort_hours: 40, progress_pct: 100, status: 'done' })).j.id;
  const t2 = (await put('task', T.pmo, { project_id: pid, name: 'Build', duration_days: 10, effort_hours: 80, progress_pct: 25, depends_on: [t1] })).j.id;
  await put('task', T.pmo, { project_id: pid, name: 'Go live', duration_days: 0, depends_on: [t2] });
  await put('milestone', T.pmo, { project_id: pid, name: 'Cut-over', due_date: '2099-01-10' });
  await put('risk', T.pmo, { project_id: pid, title: 'Vendor delay', probability: 3, impact: 2, status: 'open' });
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; const txt = await r.text(); try { j = JSON.parse(txt); } catch (_) {} return { status: r.status, j, txt, r }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');
const P = (s) => `/api/governance/ppm/project/${pid}/${s}`;

test('switches off (= today): every W3 route answers 404; the stage move ignores checklists', async () => {
  await sw(OFF);
  for (const [m, p, b] of [['GET', P('summary')], ['GET', '/api/governance/ppm/view-mode'], ['PUT', '/api/governance/ppm/view-mode', { mode: 'simplified' }], ['GET', P('rag')], ['GET', P('dcma')], ['GET', P('gates')], ['PUT', P('gates/approval'), {}],
    ['POST', P('gates/approval/evidence'), {}], ['POST', P('gates/approval/signoff'), {}], ['GET', P('raid')], ['PUT', P('raid'), {}], ['GET', P('report.html')], ['GET', P('report.xlsx')]]) {
    assert.equal((await send(m, p, T.pmo, b)).status, 404, `${m} ${p}`);
  }
  const f = (await send('GET', '/api/governance/ppm/features', T.pmo)).j;
  for (const k of ['simplified_view', 'project_rag', 'dcma', 'gate_checklist', 'raid', 'project_report']) assert.equal(f[k], false, k);
});

test('T9 gate checklist: committee defines; incomplete → stage 409; owner / non-approver / reason / slot negatives; then the committee moves', async () => {
  await sw({ ...OFF, ppm_gate_checklist_enabled: '1' });
  try {
    const def = { items: [{ key: 'charter', label: 'Signed charter', kind: 'artifact' }, { key: 'review', label: 'Architecture review held', kind: 'check' }], approvers: [{ user_id: ID.w3_cio }, { role: 'finance-viewer' }], rule: 'all' };
    assert.equal((await send('PUT', P('gates/approval'), T.viewer, def)).status, 403, 'a viewer cannot define');
    assert.equal((await send('PUT', P('gates/approval'), T.pmo, { ...def, approvers: [] })).j.code, 'NO_APPROVER');
    assert.equal((await send('PUT', P('gates/nowhere'), T.pmo, def)).j.code, 'STAGE_UNKNOWN');
    const d = await send('PUT', P('gates/approval'), T.pmo, def);
    assert.equal(d.status, 200, JSON.stringify(d.j)); assert.equal(d.j.checklist.version, 1); assert.equal(d.j.evaluation.refusal.code, 'GATE_CHECKLIST');
    // the dry run and the move both refuse
    const pg = await send('GET', `/api/governance/portfolio/project/${pid}`, T.pmo);
    assert.equal(pg.j.allowed_stages.find((g) => g.to === 'approval').refusal.code, 'GATE_CHECKLIST');
    const mv = await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.pmo, { to: 'approval' });
    assert.equal(mv.status, 409); assert.equal(mv.j.code, 'GATE_CHECKLIST');
    // evidence: bad link refused; a viewer cannot add evidence
    assert.equal((await send('POST', P('gates/approval/evidence'), T.pmo, { item_key: 'charter', link: 'javascript:alert(1)' })).j.code, 'BAD_LINK');
    assert.equal((await send('POST', P('gates/approval/evidence'), T.viewer, { item_key: 'charter', link: 'https://x.example/c.pdf' })).status, 403);
    assert.equal((await send('POST', P('gates/approval/evidence'), T.pmo, { item_key: 'charter', link: 'https://sp.example/charter.pdf' })).status, 200);
    const e2 = await send('POST', P('gates/approval/evidence'), T.pmo, { item_key: 'review' });
    assert.equal(e2.j.evaluation.refusal.code, 'GATE_SIGNOFF', 'items done, sign-offs missing');
    // sign-off negatives
    const sign = (t, b) => send('POST', P('gates/approval/signoff'), t, b);
    assert.equal((await sign(T.viewer, { decision: 'approve' })).j.code, 'NOT_AN_APPROVER');
    await sw({ ...OFF, ppm_gate_checklist_enabled: '1' });
    // make the owner an approver to prove the owner rule
    const d2 = await send('PUT', P('gates/approval'), T.pmo, { ...def, approvers: [...def.approvers, { user_id: ID.w3_owner }] });
    assert.equal(d2.j.checklist.version, 2);
    const so = await sign(T.owner, { decision: 'approve' });
    assert.equal(so.status, 403); assert.equal(so.j.code, 'GATE_SOD', 'the project owner never signs off');
    await send('PUT', P('gates/approval'), T.pmo, def);   // v3, back to two slots
    assert.equal((await sign(T.cio, { decision: 'reject', reason: 'short' })).j.code, 'REASON_REQUIRED');
    assert.equal((await sign(T.cio, { decision: 'reject', reason: 'The rollback plan is missing from the charter.' })).status, 200);
    const fin1 = await sign(T.fin, { decision: 'approve' });
    assert.equal(fin1.status, 200, JSON.stringify(fin1.j)); assert.equal(fin1.j.evaluation.refusal.code, 'GATE_REJECTED', 'a standing reject blocks');
    const cio2 = await sign(T.cio, { decision: 'approve' });
    assert.equal(cio2.j.evaluation.complete, true, 'the latest decision of each approver counts');
    // the checklist never moves the stage: still proposal until the committee moves it
    assert.equal((await send('GET', `/api/governance/portfolio/project/${pid}`, T.pmo)).j.project.stage, 'proposal');
    const ok = await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.pmo, { to: 'approval' });
    assert.equal(ok.status, 200, JSON.stringify(ok.j)); assert.equal(ok.j.project.stage, 'approval');
    // append-only: a sign-off row cannot be edited or deleted; the ledger records every step
    const H = rdb.pgHandle();
    await assert.rejects(H.prepare('UPDATE ppm_gate_signoffs SET decision=? WHERE project_id=?').run('approve', pid));
    await assert.rejects(H.prepare('DELETE FROM ppm_gate_evidence WHERE project_id=?').run(pid));
    const ev = (await H.prepare(`SELECT action FROM ppm_events WHERE entity='project' AND entity_id=? ORDER BY id`).all(pid)).map((r) => r.action);
    for (const a of ['gate_checklist_defined', 'gate_evidence_added', 'gate_signoff_rejected', 'gate_signoff_approved', 'stage']) assert.ok(ev.includes(a), a);
    const st = (await H.prepare(`SELECT at FROM ppm_gate_signoffs WHERE project_id=? ORDER BY id DESC`).get(pid)).at;
    assert.ok(Math.abs(Date.parse(st) - Date.now()) < 60000, 'server timestamp');
  } finally { await sw(OFF); }
});

test('T9 composite RAG: stored with its hysteresis memory; PROPOSED thresholds stated', async () => {
  await sw({ ...OFF, ppm_project_rag_enabled: '1' });
  try {
    const r = await send('GET', P('rag'), T.viewer);
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.match(r.j.thresholds_status, /PROPOSED/);
    assert.equal(r.j.components.risk.risk_score.value, 6, 'open 3×2 risk'); assert.equal(r.j.components.risk.rag, 'amber');
    assert.equal(r.j.components.cost.rag, null, 'EVM off → cost unknown, never green');
    assert.ok(r.j.measured.includes('slip_wd'));
    const st = await rdb.pgHandle().prepare('SELECT rag, state_json FROM ppm_project_rag_state WHERE project_id=?').get(pid);
    assert.equal(st.rag, r.j.rag); assert.equal(JSON.parse(st.state_json).metrics.risk_score, 'amber');
    await sw({ ppm_rag_thresholds: '{bad' });
    assert.equal((await send('GET', P('rag'), T.viewer)).j.threshold_problems.length, 1);
  } finally { await sw({ ...OFF, ppm_rag_thresholds: '' }); }
});

test('T10 summary: cards reconcile to the engine; budget burn hidden without money; view mode per user', async () => {
  await sw({ ...OFF, ppm_simplified_view_enabled: '1', ppm_project_rag_enabled: '1' });
  try {
    const s = await send('GET', P('summary'), T.pmo);
    assert.equal(s.status, 200, JSON.stringify(s.j));
    const d = (await send('GET', `/api/governance/portfolio/project/${pid}`, T.pmo)).j;
    const ENGINE = require('../services/ppm/scheduleEngine');
    const sch = ENGINE.schedule(d.tasks, { anchor: d.project.start_date });
    const leaves = d.tasks.map((t) => ({ ...t, _duration: sch.tasks.find((r) => r.id === t.id).duration_days }));
    assert.equal(s.j.cards.schedule_complete_pct, ENGINE.rollupProgress(leaves).progress_pct, 'work-weighted, recomputed from the rows');
    assert.equal(s.j.cards.forecast_finish, sch.project_finish);
    assert.equal(s.j.cards.active_risks, 1); assert.equal(s.j.cards.next_milestone.name, 'Cut-over');
    assert.equal(s.j.money_hidden, true, 'a committee-member is not an amount reader (invariant 2)'); assert.equal(s.j.cards.budget_burn, null);
    assert.equal(s.j.phase_strip.length, 4); assert.equal(s.j.mode, 'expert', 'default = expert = today');
    assert.equal((await send('PUT', '/api/governance/ppm/view-mode', T.pmo, { mode: 'nope' })).j.code, 'BAD_MODE');
    assert.equal((await send('PUT', '/api/governance/ppm/view-mode', T.pmo, { mode: 'simplified' })).j.mode, 'simplified');
    assert.equal((await send('GET', '/api/governance/ppm/view-mode', T.pmo)).j.mode, 'simplified');
    assert.equal((await send('GET', '/api/governance/ppm/view-mode', T.cio)).j.mode, 'expert', 'per user');
  } finally { await sw(OFF); }
});

test('T11 DCMA over HTTP: 14 points, W2-only points not measurable, bad status date 400', async () => {
  await sw({ ...OFF, ppm_dcma_enabled: '1' });
  try {
    const r = await send('GET', P('dcma') + '?status_date=2026-11-16', T.viewer);
    assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.points.length, 14);
    assert.equal(r.j.points.find((p) => p.id === 10).pass, null, 'resources: no W2 data');
    assert.equal((await send('GET', P('dcma') + '?status_date=2026-02-30', T.viewer)).j.code, 'BAD_STATUS_DATE');
  } finally { await sw(OFF); }
});

test('RAID: dependency kind, amounts only for admin tier + finance-viewer, editor of another site refused', async () => {
  await sw({ ...OFF, ppm_raid_enabled: '1' });
  try {
    assert.equal((await send('PUT', P('raid'), T.pmo, { kind: 'dependency', title: 'Carrier fibre', impact_amount: 5000, impact_currency: 'USD' })).j.code, 'MONEY_SCOPE', 'committee-member is not an amount writer');
    const c = await send('PUT', P('raid'), T.pmo, { kind: 'dependency', title: 'Carrier fibre', probability: 2, impact: 3, response: 'mitigate', review_date: '2026-01-01', dependency_ref: 'Carrier order 42', probability_pct: 50 });
    assert.equal(c.status, 200, JSON.stringify(c.j)); assert.equal(c.j.item.money_hidden, true); assert.equal(c.j.item.review_overdue, true);
    const a = await send('PUT', P('raid'), T.adm, { id: c.j.item.id, kind: 'dependency', title: 'Carrier fibre', probability: 2, impact: 3, probability_pct: 50, impact_amount: 5000, impact_currency: 'usd' });
    assert.equal(a.status, 200, JSON.stringify(a.j)); assert.equal(a.j.item.exposure_amount, 2500);
    // a committee save without money keeps the amount
    await send('PUT', P('raid'), T.pmo, { id: c.j.item.id, kind: 'dependency', title: 'Carrier fibre (renamed)', probability: 2, impact: 3, probability_pct: 50 });
    const g = (await send('GET', P('raid'), T.fin)).j;
    const it = g.items.find((x) => x.id === c.j.item.id);
    assert.equal(it.impact_amount, 5000); assert.equal(it.title, 'Carrier fibre (renamed)'); assert.deepEqual(g.exposure_totals, [{ currency: 'USD', exposure_amount: 2500, entries: 1, unknown: 0 }]);
    const v = await send('GET', P('raid'), T.pmo);
    assert.ok(!/5000|2500/.test(v.txt), 'no amount for a non-money reader'); assert.equal(v.j.exposure_totals, null);
    const led = (await rdb.pgHandle().prepare(`SELECT new_value, note FROM ppm_events WHERE entity='project' AND entity_id=? AND action LIKE 'raid_%'`).all(pid)).map((r) => (r.new_value || '') + (r.note || '')).join(' ');
    assert.ok(!/5000|2500/.test(led), 'no amount written to the ledger');
    assert.equal((await send('PUT', P('raid'), T.editorB, { title: 'Intrusion', kind: 'risk' })).status, 403, 'editor plan writes off');
  } finally { await sw(OFF); }
});

test('reports: html + xlsx through the export policy; amounts only for money readers', async () => {
  await sw({ ...OFF, ppm_project_report_enabled: '1', ppm_raid_enabled: '1', ppm_dcma_enabled: '1' });
  try {
    const h = await send('GET', P('report.html'), T.pmo);
    assert.equal(h.status, 200); assert.match(h.txt, /W3-1/); assert.match(h.txt, /amounts not included/); assert.ok(!/5000/.test(h.txt));
    const hf = await send('GET', P('report.html'), T.fin);
    assert.ok(!/amounts not included/.test(hf.txt), 'finance-viewer gets the money view');
    const x = await send('GET', P('report.xlsx'), T.adm);
    assert.equal(x.status, 200); assert.match(String(x.r.headers.get('content-type')), /spreadsheetml/);
  } finally { await sw(OFF); }
});

test('scheduled project report: armed off by default, no gather; preview composes without amounts', async () => {
  const CLI = require('../tools/reports/send-ppm-reports');
  assert.deepEqual(CLI.decidePpmReportSend({}), { send: false, reason: 'disabled' });
  assert.deepEqual(CLI.decidePpmReportSend({ ppm_report_send_enabled: '1' }), { send: false, reason: 'no recipients' });
  let mailed = 0;
  const off = await CLI.main({ args: {}, cfg: { ppm_report_send_enabled: '0' }, db: rdb.db, reportsDb: rdb, mailerSend: () => { mailed++; } });
  assert.equal(off.reason, 'disabled'); assert.equal(mailed, 0);
  const pv = await CLI.main({ args: {}, preview: true, cfg: { ppm_dcma_enabled: '1', ppm_raid_enabled: '1' }, db: rdb.db, reportsDb: rdb, projectIds: [pid], mailerSend: () => { mailed++; } });
  assert.equal(pv.preview, true); assert.equal(pv.projects, 1); assert.match(pv.html, /amounts not included/); assert.equal(mailed, 0);
  const sent = []; const recs = [];
  const r = await CLI.main({ args: {}, cfg: { ppm_report_send_enabled: '1', ppm_report_recipients: 'pmo@example.invalid' }, db: rdb.db, reportsDb: rdb, projectIds: [pid], alreadySentToday: async () => false, renderPdf: async () => ({ ok: false }), mailerSend: async (m) => { sent.push(m); return { ok: true }; }, record: async (_db, x) => recs.push(x) });
  assert.equal(r.sent, 1); assert.equal(sent[0].attachments.length, 2); assert.equal(recs[0].report_type, 'ppm_project');
  assert.equal(require('../services/reportSchedule').cliFor('ppm_project'), require('path').join(__dirname, '..', 'tools', 'reports', 'send-ppm-reports.js'));
});
