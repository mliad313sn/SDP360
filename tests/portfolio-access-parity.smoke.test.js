'use strict';
// F-ARCH-04 — portfolio access parity. The personas, the fixture projects and the EXPECTED visible set come from
// tools/agent/portfolio-access-matrix.js (the same definition writes docs/ops/PORTFOLIO-ACCESS-MATRIX.md).
// This file is the OBSERVED side: it builds the fixture over HTTP and checks that every surface — list, summary,
// detail, baselines, history, exceptions, deck, workbook, report, My work — shows the same set, in both states
// of portfolio_site_scope_reads, that a hidden project answers 404 and leaves no text anywhere, that amounts
// follow the role, and that a revocation applies on the next request of an open session.
// The switches are armed in the throwaway test database only.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pf-parity-'));
process.env.DASH_USER = process.env.DASH_USER || 'pap-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'pap-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'pap-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { execFileSync } = require('child_process');
const JSZip = require('jszip');
const XLSX = require('xlsx');
const M = require('../tools/agent/portfolio-access-matrix');

const BUDGET = 7654321, BENEFIT = 8765432;                       // amounts that must not reach a non-money reader
const MARK = { A: 'PAPQA1', B: 'PAPQB2', AB: 'PAPQX3', G: 'PAPQG4' };   // no marker is a prefix of another
const KEYS = M.PROJECTS.map((p) => p.key);
let server, base, rdb, cfg, superTok, SITES = {}, T = {}, U = {}, P = {};

const raw = (m, p, t, body) => fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
const send = async (m, p, t, body) => { const r = await raw(m, p, t, body); const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (_) { /* not JSON */ } return { status: r.status, j, text }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (reads, writes) => cfg.setConfig(rdb.db, { portfolio_site_scope_reads: reads, portfolio_editor_plan_writes: writes }, 'parity');
const keysIn = (text) => KEYS.filter((k) => text.includes(MARK[k]));
const sorted = (a) => [...a].sort();

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 50; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'portfolio_project_sites'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  SITES.A = sites.find((s) => /hounde/i.test(s.name)).id; SITES.B = sites.find((s) => /mana/i.test(s.name)).id;
  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['super_admin']);
  superTok = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  for (const p of M.PERSONAS) {
    const u = M.userOf(p).username, ids = p.sites.map((s) => SITES[s]);
    await rdb.createUser({ username: u, full_name: u, password: u + '-pass-0000', roles: p.roles, site_id: ids[0] || null, extra_site_ids: ids.slice(1) });
    const row = ((await rdb.listUsers()) || []).find((x) => x.username === u);
    U[p.key] = { id: row.id, form: { full_name: u, site_id: ids[0] || null, active: 1, roles: p.roles, extra_site_ids: ids.slice(1) } };
    T[p.key] = (await rdb.login(u, u + '-pass-0000')).token;
  }
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const pmo = T.committee;
  const prog = (await put('programme', pmo, { key: 'pap-prog', name: 'Parity programme' })).j.id;
  const obj = (await put('objective', pmo, { programme_id: prog, key: 'pap-o', name: 'Parity objective' })).j.id;
  for (const x of M.PROJECTS) {
    const k = MARK[x.key];
    const owner = x.owner ? M.userOf(M.PERSONAS.find((p) => p.key === x.owner)).username : 'nobody';
    const r = await put('project', pmo, { objective_id: obj, key: k, name: 'Project ' + k, site_id: x.site ? SITES[x.site] : null, owner, start_date: '2019-06-01', end_date: '2020-01-01', status: 'active', budget: BUDGET, spent: 1000, currency: 'USD' });
    assert.equal(r.status, 200, 'project ' + x.key + ' ' + r.text);
    P[x.key] = r.j.id;
    if (x.extra.length) assert.equal((await send('PUT', `/api/governance/portfolio/project/${P[x.key]}/sites`, pmo, { site_ids: x.extra.map((s) => SITES[s]) })).status, 200);
    for (const [kind, body] of [
      ['task', { name: 'tk-' + k, owner: 'Kone', start_date: '2019-12-01', end_date: '2020-01-05', allocation_pct: 50 }],
      ['milestone', { name: 'ms-' + k, due_date: '2020-01-02' }],
      ['deliverable', { name: 'dl-' + k }],
      ['risk', { title: 'rk-' + k, probability: 3, impact: 3 }],
      ['benefit', { description: 'bn-' + k, value_kind: 'money', currency: 'USD', baseline_value: 0, target_value: BENEFIT, owner: 'Site GM', review_date: '2020-02-01' }],
    ]) { const c = await put(kind, pmo, { ...body, project_id: P[x.key] }); assert.equal(c.status, 200, kind + ' ' + x.key + ' ' + c.text); }
  }
});
after(async () => { try { await sw('0', '0'); } catch (_) { /* db gone */ } server && server.close(); });

/** What one persona observes on every surface: a set of project keys (or a status per project) per surface, plus all the text read. */
async function observe(tok) {
  const o = { texts: {} };
  const list = await send('GET', '/api/governance/portfolio', tok);
  assert.equal(list.status, 200);
  const idKey = new Map(KEYS.map((k) => [P[k], k]));
  const ours = (rows, f = 'project_id') => [...new Set((rows || []).map((r) => idKey.get(Number(r[f]))).filter(Boolean))];
  o.list = ours(list.j.projects, 'id');
  o.children = {};
  for (const c of ['tasks', 'milestones', 'deliverables', 'risks', 'benefits', 'plans']) o.children[c] = ours(list.j[c]);
  o.children.gantt = ours(list.j.gantt, 'id');
  o.children.project_sites = ours(list.j.project_sites);
  o.summary = (list.j.summary.find((s) => s.programme === 'pap-prog') || {}).projects;
  o.editable = ours((list.j.can_edit_plan_projects || []).map((id) => ({ id })), 'id');
  o.money_hidden = !!list.j.money_hidden;
  o.texts.list = list.text;
  o.detail = {}; o.baselines = {}; o.history = {};
  for (const k of KEYS) {
    const d = await send('GET', `/api/governance/portfolio/project/${P[k]}`, tok); o.detail[k] = d.status; o.texts['detail:' + k] = d.text;
    const b = await send('GET', `/api/governance/portfolio/project/${P[k]}/baselines`, tok); o.baselines[k] = b.status; o.texts['baselines:' + k] = b.text;
    const h = await send('GET', `/api/governance/portfolio/project/${P[k]}/history`, tok); o.history[k] = h.status; o.texts['history:' + k] = h.text;
  }
  const ex = await send('GET', '/api/governance/portfolio/exceptions', tok);
  assert.equal(ex.status, 200);
  o.exceptions = ours(ex.j.items); o.texts.exceptions = ex.text;
  const deck = await raw('GET', '/api/governance/portfolio/deck.pptx', tok);
  assert.equal(deck.status, 200);
  const zip = await JSZip.loadAsync(Buffer.from(await deck.arrayBuffer()));
  let dx = '';
  for (const f of Object.keys(zip.files)) if (/\.xml$/.test(f)) dx += await zip.file(f).async('string');
  o.texts.deck = dx; o.deck = keysIn(dx);
  const wb = await raw('GET', '/api/governance/portfolio/workbook.xlsx', tok);
  assert.equal(wb.status, 200);
  const book = XLSX.read(Buffer.from(await wb.arrayBuffer()), { type: 'buffer' });
  o.texts.workbook = book.SheetNames.map((n) => JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets[n], { header: 1 }))).join('\n');
  o.workbook = keysIn(o.texts.workbook);
  const rep = await send('GET', '/api/governance/portfolio/report.html', tok);
  assert.equal(rep.status, 200);
  o.texts.report = rep.text; o.report = keysIn(rep.text);
  const mw = await send('GET', '/api/me/work', tok);
  assert.equal(mw.status, 200);
  o.texts.mywork = mw.text; o.mywork = keysIn(mw.text);
  return o;
}

function assertParity(p, o, visible, label) {
  const want = sorted(visible), hidden = KEYS.filter((k) => !visible.includes(k));
  const eq = (got, what) => assert.deepEqual(sorted(got), want, `${label} ${p.key}: ${what}`);
  eq(o.list, 'list');
  for (const [c, got] of Object.entries(o.children)) {
    if (c === 'project_sites') assert.ok(got.every((k) => visible.includes(k)), `${label} ${p.key}: project_sites`);
    else eq(got, 'list.' + c);
  }
  assert.equal(o.summary, visible.length, `${label} ${p.key}: summary count`);
  for (const k of KEYS) {
    const see = visible.includes(k);
    assert.equal(o.detail[k], see ? 200 : 404, `${label} ${p.key}: detail ${k}`);
    assert.equal(o.baselines[k], see ? 200 : 404, `${label} ${p.key}: baselines ${k}`);
    assert.equal(o.history[k], p.money ? (see ? 200 : 404) : 403, `${label} ${p.key}: history ${k}`);
  }
  eq(o.exceptions, 'exceptions'); eq(o.deck, 'deck.pptx'); eq(o.workbook, 'workbook.xlsx'); eq(o.report, 'report.html');
  assert.ok(o.mywork.every((k) => visible.includes(k)), `${label} ${p.key}: My work lists a hidden project (${o.mywork})`);
  for (const [surface, text] of Object.entries(o.texts)) {
    for (const k of hidden) assert.ok(!text.includes(MARK[k]), `${label} ${p.key}: text of hidden project ${k} found in ${surface}`);
    if (!p.money) for (const amount of [BUDGET, BENEFIT]) assert.ok(!text.includes(String(amount)), `${label} ${p.key}: amount ${amount} found in ${surface}`);
  }
  assert.equal(o.money_hidden, !p.money, `${label} ${p.key}: money_hidden`);
  if (p.money) assert.ok(o.texts.list.includes(String(BUDGET)) && o.texts.workbook.includes(String(BUDGET)), `${label} ${p.key}: a money reader sees the budget`);
}

test('the committed matrix document is the one the generator writes', () => {
  execFileSync(process.execPath, [_path.join(__dirname, '..', 'tools', 'agent', 'portfolio-access-matrix.js'), '--check']);
  const off = M.expected(false);
  for (const p of M.PERSONAS) assert.deepEqual(off[p.key], KEYS, 'switch off = today: everything');
});

test('read switch off (today): every persona sees the four projects on every surface; amounts follow the role', async () => {
  await sw('0', '0');
  const want = M.expected(false), edit = M.expectedEditable(false);
  for (const p of M.PERSONAS) {
    const o = await observe(T[p.key]);
    assertParity(p, o, want[p.key], 'scope off');
    assert.deepEqual(sorted(o.editable), sorted(edit[p.key]), `scope off ${p.key}: editable plans (committee only today)`);
  }
});

test('read switch on: every surface shows the same set per persona; hidden = 404 and no text; amounts follow the role', async () => {
  await sw('1', '0');
  const want = M.expected(true);
  for (const p of M.PERSONAS) assertParity(p, await observe(T[p.key]), want[p.key], 'scope on');
  // not vacuous: the site cards of My work do list the benefit reviews of the persona's sites
  const mw = await send('GET', '/api/me/work', T.edA);
  assert.deepEqual(sorted(keysIn(mw.text)), ['A', 'AB']);
});

test('both switches on: the editable plans are the expected ones and never exceed what the persona reads', async () => {
  await sw('1', '1');
  const read = M.expected(true), edit = M.expectedEditable(true);
  for (const p of M.PERSONAS) {
    const j = (await send('GET', '/api/governance/portfolio', T[p.key])).j;
    const got = KEYS.filter((k) => j.can_edit_plan_projects.includes(P[k]));
    assert.deepEqual(sorted(got), sorted(edit[p.key].filter((k) => read[p.key].includes(k))), `editable ${p.key}`);
    for (const k of KEYS) {
      if (p.committee) continue;
      const r = await put('task', T[p.key], { project_id: P[k], name: 'probe-' + p.key + '-' + k });
      assert.equal(r.status, edit[p.key].includes(k) ? 200 : 403, `plan write ${p.key} on ${k}`);
      if (r.status === 200) assert.equal((await send('DELETE', `/api/governance/portfolio/task/${r.j.id}`, T.committee)).status, 200);
    }
  }
});

const edit = (key, change) => send('PUT', `/api/reports/users/${U[key].id}`, superTok, { ...U[key].form, ...change });

test('revocation in an open session: the extra site of the multi-site editor is removed — site B disappears on the next request', async () => {
  await sw('1', '0');
  const p = M.PERSONAS.find((x) => x.key === 'multi');
  assertParity(p, await observe(T.multi), KEYS, 'before revocation');
  assert.equal((await edit('multi', { extra_site_ids: [] })).status, 200);
  assertParity(p, await observe(T.multi), ['A', 'AB', 'G'], 'after revocation');   // same token, no new login
});

test('revocation in an open session: the finance role is removed — history refused and amounts gone on the next request', async () => {
  await sw('1', '0');
  const p = M.PERSONAS.find((x) => x.key === 'finA');
  assertParity(p, await observe(T.finA), ['A', 'AB', 'G'], 'before revocation');
  assert.equal((await edit('finA', { roles: ['viewer'] })).status, 200);
  assertParity({ ...p, money: false }, await observe(T.finA), ['A', 'AB', 'G'], 'after revocation');
});

test('revocation in an open session: moving an editor to the other site moves the readable set', async () => {
  await sw('1', '0');
  assert.equal((await edit('edA', { site_id: SITES.B })).status, 200);
  assertParity(M.PERSONAS.find((x) => x.key === 'edA'), await observe(T.edA), ['B', 'AB', 'G'], 'after the move');
});
