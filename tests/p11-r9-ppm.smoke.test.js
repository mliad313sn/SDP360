'use strict';
// P11 round 9 (fix 37) — HTTP regression pins, fictitious data only. AI-written, not a human review.
//   R9-1  a RAID update shaped like the old form (every key, empty inputs = null) keeps the stored 3 × 3 score and the
//         project RAG stays RED; '' or clear_score resets it to unknown; a left-out key keeps it (fix 34 control).
//   R9-2  the generic risk writer refuses scores outside 1..3 / non-integers with 400 (never 500); '' / null = unscored.
//   R9-3  the summary card flags a "high" count that is a lower bound (open entry without a score).
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'p11r9-'));
process.env.DASH_USER = process.env.DASH_USER || 'r9-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'r9-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'r9-key';
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
  T.pmo = await mk('r9x_pmo', ['viewer', 'committee-member']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); }); base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());

let n = 0;
const project = async () => {
  n++;
  const prog = (await put('programme', T.pmo, { key: `r9x-g-${n}`, name: 'G' + n })).j.id;
  const obj = (await put('objective', T.pmo, { programme_id: prog, key: `r9x-o-${n}`, name: 'O' + n })).j.id;
  const r = await put('project', T.pmo, { objective_id: obj, key: `R9X-P${n}`, name: 'P' + n, owner: 'r9x_pmo', site_id: sites[0] });
  assert.strictEqual(r.status, 200, r.txt); return r.j.id;
};
const score = async (id) => rdb.db.prepare('SELECT probability, impact, owner FROM portfolio_risks WHERE id=?').get(id);

test('R9-1 — a form-shaped RAID edit keeps the stored score; only an explicit clear resets it', async () => {
  await sw({ ppm_simplified_view_enabled: '1', ppm_project_rag_enabled: '1', ppm_raid_enabled: '1' });
  const P = await project();
  const raid = (b) => send('PUT', `/api/governance/ppm/project/${P}/raid`, T.pmo, b);
  const c = await raid({ kind: 'risk', title: 'critical vendor', probability: '3', impact: '3', owner: 'alice', status: 'open' });
  assert.strictEqual(c.status, 200, c.txt);
  const id = Number(c.j.item.id);
  const rag0 = await send('GET', `/api/governance/ppm/project/${P}/rag`, T.pmo);
  assert.strictEqual(rag0.j.rag, 'red', rag0.txt);
  // the body the shipped form used to build when only the owner was changed (P/I inputs empty)
  const u = await raid({ id, kind: 'risk', title: 'critical vendor', probability: null, impact: null, owner: 'bob', status: 'open', response: null, review_date: null, probability_pct: null, dependency_ref: null, mitigation: null });
  assert.strictEqual(u.status, 200, u.txt);
  assert.deepStrictEqual(await score(id), { probability: 3, impact: 3, owner: 'bob' });
  const rag1 = await send('GET', `/api/governance/ppm/project/${P}/rag`, T.pmo);
  assert.strictEqual(rag1.j.rag, 'red', 'the project stays RED, never UNKNOWN after an owner change');
  const ev = await rdb.db.prepare('SELECT new_value FROM ppm_events WHERE entity_id=? AND field=? ORDER BY id DESC LIMIT 1').get(P, `raid:${id}`);
  assert.match(ev.new_value, /P3×I3/);
  // omitted keys keep (fix 34 control); '' clears; clear_score clears
  assert.strictEqual((await raid({ id, title: 'critical vendor renamed' })).status, 200);
  assert.deepStrictEqual(await score(id), { probability: 3, impact: 3, owner: 'bob' });
  assert.strictEqual((await raid({ id, probability: '', impact: '' })).status, 200);
  assert.deepStrictEqual(await score(id), { probability: null, impact: null, owner: 'bob' });
  assert.strictEqual((await raid({ id, probability: 2, impact: 3 })).status, 200);
  assert.strictEqual((await raid({ id, clear_score: true })).status, 200);
  assert.deepStrictEqual(await score(id), { probability: null, impact: null, owner: 'bob' });
  // create keeps fix 34: unscored = NULL
  const c2 = await raid({ kind: 'risk', title: 'nobody scored' });
  assert.deepStrictEqual(await score(Number(c2.j.item.id)), { probability: null, impact: null, owner: null });
});

test('R9-2 — the generic writer validates the 1..3 integer scale (400, never 500)', async () => {
  const P = await project();
  for (const [p, i] of [[0, 0], [5, 2], [-1, 3], [2.5, 3], ['abc', 2], [2, 4]]) {
    const r = await put('risk', T.pmo, { project_id: P, title: `g ${p}/${i}`, probability: p, impact: i });
    assert.strictEqual(r.status, 400, `${p}/${i} → ${r.status} ${r.txt}`);
  }
  for (const [p, i, want] of [['', '', [null, null]], [null, null, [null, null]], ['2', '3', [2, 3]], [3, 1, [3, 1]]]) {
    const r = await put('risk', T.pmo, { project_id: P, title: `ok ${p}/${i}`, probability: p, impact: i });
    assert.strictEqual(r.status, 200, r.txt);
    const row = await rdb.db.prepare('SELECT probability, impact FROM portfolio_risks WHERE id=?').get(r.j.id);
    assert.deepStrictEqual([row.probability, row.impact], want);
  }
});

test('R9-3/R9-4 — the summary card flags the lower-bound high count and the partial RAG', async () => {
  await sw({ ppm_simplified_view_enabled: '1', ppm_project_rag_enabled: '1', ppm_raid_enabled: '1' });
  const P = await project();
  await send('PUT', `/api/governance/ppm/project/${P}/raid`, T.pmo, { kind: 'risk', title: 'medium known', probability: 2, impact: 2 });
  await send('PUT', `/api/governance/ppm/project/${P}/raid`, T.pmo, { kind: 'issue', title: 'unscored issue' });
  const s = await send('GET', `/api/governance/ppm/project/${P}/summary`, T.pmo);
  assert.strictEqual(s.status, 200, s.txt);
  assert.deepStrictEqual({ a: s.j.cards.active_risks, h: s.j.cards.high_risks, u: s.j.cards.unscored_risks, p: s.j.cards.high_risks_partial, rp: s.j.cards.rag_partial },
    { a: 2, h: 0, u: 1, p: true, rp: true });
});
