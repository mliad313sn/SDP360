'use strict';
// P11 round 8 (fix 34) — HTTP regression pins, fictitious data only. AI-written, not a human review.
//   PPM R8-1  a risk created WITHOUT probability / impact (generic writer AND RAID writer) is stored NULL (unscored),
//             never 2 × 2: project risk score null, RAG risk component null, RAID severity null. A RAID update that
//             sends an empty score resets it to unknown; an update that omits the field keeps it.
//   PPM R8-5  RAID create returns the id of the row it inserted (RETURNING id).
//   N-R8-1    an approved Policy Center request whose apply step fails (value out of today's range) is recorded
//             'failed' with the reason, plus a policy_change_failed journal row — never left 'approved'.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'p11r8-'));
process.env.DASH_USER = process.env.DASH_USER || 'r8-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'r8-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'r8-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, cfg, sites; const T = {}, ids = {};
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body !== undefined ? { 'content-type': 'application/json' } : {}), body: body === undefined ? undefined : JSON.stringify(body) }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (_) {} return { status: r.status, j, txt }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');

before(async () => {
  const { app } = require('../server'); await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 80; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_project_documents'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  sites = (await rdb.listSites({ includeInactive: true })).map((s) => s.id);
  const root = await rdb.db.prepare('SELECT id FROM users WHERE username=?').get(process.env.DASH_USER);
  const mk = async (u, roles) => {
    await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles });
    ids[u] = Number((await rdb.db.prepare('SELECT id FROM users WHERE username=?').get(u)).id);
    await rdb.db.prepare(`INSERT INTO system_log (ts, category, action, actor, actor_id, target, details) VALUES (?, 'identity', 'user_created', 'root', ?, ?, ?)`).run(new Date(Date.now() - 30 * 864e5).toISOString(), root ? Number(root.id) : 1, u, JSON.stringify({ after: { roles } }));
    return (await rdb.login(u, u + 'pass1234')).token;
  };
  T.pmo = await mk('r8x_pmo', ['viewer', 'committee-member']);
  T.s1 = await mk('r8x_super1', ['super_admin']);
  T.s2 = await mk('r8x_super2', ['super_admin']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); }); base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());

let n = 0;
const project = async () => {
  n++;
  const prog = (await put('programme', T.pmo, { key: `r8x-g-${n}`, name: 'G' + n })).j.id;
  const obj = (await put('objective', T.pmo, { programme_id: prog, key: `r8x-o-${n}`, name: 'O' + n })).j.id;
  const r = await put('project', T.pmo, { objective_id: obj, key: `R8X-P${n}`, name: 'P' + n, owner: 'r8x_pmo', site_id: sites[0] });
  assert.strictEqual(r.status, 200, r.txt); return r.j.id;
};

test('R8-1 — an unscored risk is stored NULL by both writers and reads UNKNOWN everywhere', async () => {
  await sw({ ppm_simplified_view_enabled: '1', ppm_project_rag_enabled: '1', ppm_raid_enabled: '1' });
  const P = await project();
  const g = await put('risk', T.pmo, { project_id: P, title: 'nobody scored this' });
  assert.strictEqual(g.status, 200, g.txt);
  assert.deepStrictEqual(await rdb.db.prepare('SELECT probability, impact FROM portfolio_risks WHERE id=?').get(g.j.id), { probability: null, impact: null });
  const rag = await send('GET', `/api/governance/ppm/project/${P}/rag`, T.pmo);
  assert.strictEqual(rag.status, 200, rag.txt);
  assert.strictEqual(rag.j.components.risk.rag, null, 'risk component UNKNOWN, never green');
  assert.strictEqual(rag.j.components.risk.risk_score.value, null);
  const sum = await send('GET', `/api/governance/ppm/project/${P}/summary`, T.pmo);
  assert.strictEqual(sum.status, 200, sum.txt);
  assert.deepStrictEqual(sum.j.top_risks, [], 'an unscored risk is not listed with a score');

  const P2 = await project();
  const rr = await send('PUT', `/api/governance/ppm/project/${P2}/raid`, T.pmo, { kind: 'risk', title: 'raid unscored', status: 'Open' });
  assert.strictEqual(rr.status, 200, rr.txt);
  const row = await rdb.db.prepare('SELECT id, probability, impact, status FROM portfolio_risks WHERE project_id=?').all(P2);
  assert.strictEqual(row.length, 1);
  assert.deepStrictEqual({ p: row[0].probability, i: row[0].impact, s: row[0].status }, { p: null, i: null, s: 'open' });
  assert.strictEqual(Number(rr.j.item.id), Number(row[0].id), 'R8-5 — the returned id is the inserted row');
  assert.strictEqual(rr.j.item.severity, null);
  const rv = await send('GET', `/api/governance/ppm/project/${P2}/raid`, T.pmo);
  assert.deepStrictEqual(rv.j.items.map((x) => x.severity), [null]);

  // score it, then an update that OMITS the score keeps it, one that sends '' resets it to unknown
  const id = Number(row[0].id);
  assert.strictEqual((await send('PUT', `/api/governance/ppm/project/${P2}/raid`, T.pmo, { id, kind: 'risk', title: 'raid unscored', probability: 3, impact: 2 })).status, 200);
  assert.strictEqual((await send('PUT', `/api/governance/ppm/project/${P2}/raid`, T.pmo, { id, kind: 'risk', title: 'raid renamed' })).status, 200);
  assert.deepStrictEqual(await rdb.db.prepare('SELECT probability, impact FROM portfolio_risks WHERE id=?').get(id), { probability: 3, impact: 2 });
  assert.strictEqual((await send('PUT', `/api/governance/ppm/project/${P2}/raid`, T.pmo, { id, kind: 'risk', title: 'raid renamed', probability: '', impact: '' })).status, 200);
  assert.deepStrictEqual(await rdb.db.prepare('SELECT probability, impact FROM portfolio_risks WHERE id=?').get(id), { probability: null, impact: null });
});

test('N-R8-1 — an approval whose apply fails is recorded failed + journalled, never left approved', async () => {
  await sw({ policy_center_enabled: '1', auth_pbkdf2_iterations: '100000' });
  const H = rdb.pgHandle ? rdb.pgHandle() : rdb.db;
  const { makePolicyChangeStore } = require('../services/policyChangeStore');
  const rq = await makePolicyChangeStore(() => H).create({ key: 'auth_pbkdf2_iterations', scope: 'global', oldValue: '100000', newValue: '10000000', reason: 'legacy pending request before the range check', actor: { id: ids.r8x_super1, username: 'r8x_super1' } });
  const ap = await send('POST', `/api/policy-center/requests/pc-${rq.id}/approve`, T.s2, { reason: 'approve legacy request' });
  assert.strictEqual(ap.status, 400, ap.txt);
  assert.strictEqual((await cfg.getConfig(rdb.db)).auth_pbkdf2_iterations, '100000', 'nothing applied');
  const st = await H.prepare('SELECT status, decision_reason FROM policy_change_requests WHERE id=?').get(rq.id);
  assert.strictEqual(st.status, 'failed');
  assert.match(st.decision_reason, /apply failed/);
  await new Promise((r) => setTimeout(r, 200));
  const j = await H.prepare("SELECT COUNT(*)::int AS n FROM system_log WHERE action='policy_change_failed' AND target='auth_pbkdf2_iterations'").get();
  assert.strictEqual(j.n, 1, 'one journal row records the failure');
  // the key is free again: a corrected request can be filed
  assert.ok(!(await makePolicyChangeStore(() => H).pendingFor('auth_pbkdf2_iterations')), 'no pending request blocks the key');
});
