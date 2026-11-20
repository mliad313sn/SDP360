'use strict';
// P11 round 6 (security + PPM seats) — through the real server:
//   N-R6-1  a switch sent as a JSON boolean / "on" through the generic PUT /api/reports/config is stored canonically
//           ('1'/'0'), and the four-eyes guard compares that stored value: the reviewer's three-key repro no longer
//           turns the controls off (true against '1' = no change; false = typed 409; nonsense = 400; nothing written).
//   N-R6-2  an approved change request unlocks only the fields of its approved scope: the budget through impact_budget,
//           every other frozen field only when the request names it (scope_fields).
//   R6-2    two concurrent project edits naming two DIFFERENT approved change requests serialise on the project row:
//           one applies, the second (computed on the stale budget) is a 409 — no lost budget change, the second request
//           stays unused.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'p11r6-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'p11r6-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'p11r6-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'p11r6-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, RC; const T = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); RC = require('../services/reportConfig');
  for (let i = 0; i < 100; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ppm_change_requests' AND column_name = 'scope_fields'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const mk = async (k, roles) => { const u = 'p11r6_' + k; try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles }); } catch {} T[k] = (await rdb.login(u, u + 'pass1234')).token; };
  await mk('super', ['super_admin']); await mk('pmo', ['viewer', 'committee-member']); await mk('exec', ['viewer', 'committee-member']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: { ...(t ? { 'x-report-token': t } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
const cfg = async () => RC.getConfig(rdb.db);
const KEYS3 = ['portfolio_site_scope_reads', 'export_policy_strict', 'access_require_approval'];

test('N-R6-1: center OFF — booleans through the generic PUT are stored as 1/0 (what the readers compare)', async () => {
  assert.strictEqual((await cfg()).policy_center_enabled, '0');
  const r = await send('PUT', '/api/reports/config', T.super, { portfolio_site_scope_reads: true, export_policy_strict: 'on', access_require_approval: 1, reason: 'turn the three controls on' });
  assert.strictEqual(r.status, 200);
  const c = await cfg();
  for (const k of KEYS3) assert.strictEqual(c[k], '1', k);
  const bad = await send('PUT', '/api/reports/config', T.super, { export_policy_strict: 'maybe', smtp_host: 'should-not-land' });
  assert.strictEqual(bad.status, 400);
  assert.notStrictEqual((await cfg()).smtp_host, 'should-not-land', 'a refused switch writes nothing');
});

test('N-R6-1: center ON — the reviewer three-key repro: true = no change (stays 1), false = typed 409, nothing written', async () => {
  await RC.setConfig(rdb.db, { policy_center_enabled: '1', portfolio_site_scope_reads: '1', export_policy_strict: '1', access_require_approval: '1' }, 'test');
  const same = await send('PUT', '/api/reports/config', T.super, { portfolio_site_scope_reads: true, export_policy_strict: true, access_require_approval: true, reason: 'resend the controls as booleans' });
  assert.strictEqual(same.status, 200);
  let c = await cfg();
  for (const k of KEYS3) assert.strictEqual(c[k], '1', k + ' is still the canonical 1 — never "true"');
  for (const off of [false, 'false', 'off', 0, '0']) {
    const r = await send('PUT', '/api/reports/config', T.super, { portfolio_site_scope_reads: off, export_policy_strict: off, access_require_approval: off, reason: 'turn the controls off alone' });
    assert.strictEqual(r.status, 409, JSON.stringify(off));
    assert.strictEqual(r.j.code, 'CONFLICT');
    assert.deepStrictEqual([...r.j.four_eyes_keys].sort(), [...KEYS3].sort());
    c = await cfg();
    for (const k of KEYS3) assert.strictEqual(c[k], '1', `${k} unchanged after ${JSON.stringify(off)}`);
  }
  const nonsense = await send('PUT', '/api/reports/config', T.super, { export_policy_strict: 'nope' });
  assert.strictEqual(nonsense.status, 400);
  assert.strictEqual((await cfg()).export_policy_strict, '1');
  await RC.setConfig(rdb.db, { policy_center_enabled: '0' }, 'test');
});

const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const CH = 'Objective, scope and benefits of the project, long enough.';
async function approvedProject(key) {
  const prog = (await put('programme', T.pmo, { key: key + '-prog', name: key })).j.id;
  const o = (await put('objective', T.pmo, { programme_id: prog, key: key + '-o', name: 'O' })).j.id;
  const pid = (await put('project', T.pmo, { objective_id: Number(o), key, name: key, owner: 'someone', sponsor: 'Sam', charter: CH, budget: 1000, currency: 'USD', expected_value: 5000, start_date: '2027-01-01', end_date: '2027-06-30', baseline_end: '2027-06-30' })).j.id;
  assert.strictEqual((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.pmo, { to: 'approval', note: 'submit for approval now' })).status, 200);
  assert.strictEqual((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.exec, { to: 'in_progress', note: 'approved by the committee' })).status, 200);
  return pid;
}
async function approvedCr(pid, body) {
  const cr = await send('POST', `/api/governance/ppm/project/${pid}/changes`, T.pmo, body);
  assert.ok([200, 201].includes(cr.status), JSON.stringify(cr.j));
  const id = cr.j.change.id;
  for (const a of ['assess', 'approve']) assert.strictEqual((await send('POST', `/api/governance/ppm/project/${pid}/changes/${id}/${a}`, T.exec, { note: 'reviewed and fine ok' })).status, 200);
  return cr.j.change;
}
const row = (pid) => rdb.db.prepare('SELECT budget, charter FROM portfolio_projects WHERE id=?').get(pid);

test('N-R6-2: a budget-only change request does not unlock the charter; a request naming the charter does', async () => {
  await RC.setConfig(rdb.db, { ppm_business_case_freeze_enabled: '1', ppm_change_requests_enabled: '1' }, 'test');
  const pid = await approvedProject('R6-SCOPE');
  const c1 = await approvedCr(pid, { title: 'Second licence', reason: 'another licence is needed', impact_budget: 100, currency: 'USD' });
  assert.deepStrictEqual(c1.scope_fields, []);
  const e = await put('project', T.pmo, { id: pid, budget: 1100, charter: 'A completely different project scope now, unrelated.', change_request_id: c1.id });
  assert.strictEqual(e.status, 409);
  assert.ok(JSON.stringify(e.j).includes('CHANGE_REQUEST_SCOPE'), JSON.stringify(e.j));
  let r = await row(pid);
  assert.strictEqual(Number(r.budget), 1000); assert.strictEqual(r.charter, CH);
  // the same request still applies to the field it covers (not consumed by the refused write)
  assert.strictEqual((await put('project', T.pmo, { id: pid, budget: 1100, change_request_id: c1.id })).status, 200);
  assert.strictEqual(Number((await row(pid)).budget), 1100);
  // unknown scope name refused at proposal
  const badScope = await send('POST', `/api/governance/ppm/project/${pid}/changes`, T.pmo, { title: 'Bad scope', reason: 'rename the currency of the project', scope_fields: 'currency' });
  assert.strictEqual(badScope.status, 400);
  // a request naming the charter unlocks the charter only (not the budget: it carries no budget impact)
  const c2 = await approvedCr(pid, { title: 'Scope change', reason: 'the scope moved after the review', scope_fields: ['charter'] });
  assert.deepStrictEqual(c2.scope_fields, ['charter']);
  const both = await put('project', T.pmo, { id: pid, charter: 'Revised objective, scope and benefits, long enough.', budget: 1200, change_request_id: c2.id });
  assert.strictEqual(both.status, 409);
  const ok = await put('project', T.pmo, { id: pid, charter: 'Revised objective, scope and benefits, long enough.', change_request_id: c2.id });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.j));
  r = await row(pid);
  assert.strictEqual(r.charter, 'Revised objective, scope and benefits, long enough.'); assert.strictEqual(Number(r.budget), 1100);
});

test('R6-2: two concurrent edits with two DIFFERENT approved change requests — no lost update (8 rounds)', async () => {
  const pid = await approvedProject('R6-RACE');
  const used = async (cr) => !!(await rdb.db.prepare(`SELECT 1 AS x FROM ppm_events WHERE entity='project' AND entity_id=? AND action='business_case_change' AND field=?`).get(pid, `cr:${cr.id}`));
  for (let round = 0; round < 8; round++) {
    const start = Number((await row(pid)).budget);
    const crA = await approvedCr(pid, { title: `Licence A${round}`, reason: 'licence A is needed now', impact_budget: 100, currency: 'USD' });
    const crB = await approvedCr(pid, { title: `Licence B${round}`, reason: 'licence B is needed now', impact_budget: 200, currency: 'USD' });
    const [a, b] = await Promise.all([put('project', T.pmo, { id: pid, budget: start + 100, change_request_id: crA.id }), put('project', T.pmo, { id: pid, budget: start + 200, change_request_id: crB.id })]);
    assert.deepStrictEqual([a.status, b.status].sort(), [200, 409], `round ${round}: ` + JSON.stringify([a.j, b.j]));
    const winner = a.status === 200 ? crA : crB, loser = a.status === 200 ? crB : crA;
    assert.strictEqual(await used(winner), true);
    assert.strictEqual(await used(loser), false, 'the refused request stays unused');
    assert.strictEqual(Number((await row(pid)).budget), start + Number(winner.impact_budget));
    // the second request now applies on top of the first
    const again = await put('project', T.pmo, { id: pid, budget: start + 300, change_request_id: loser.id });
    assert.strictEqual(again.status, 200);
    assert.strictEqual(Number((await row(pid)).budget), start + 300);
  }
});
