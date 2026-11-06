'use strict';
// E-I02 (audit I-02) — GET /api/commitments/problem-candidates + promotion through POST /api/commitments.
// Switch off → 404; another site → 403; scope by the site's Zoho group (never request_records.site); promote is idempotent.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pc-smoke-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'pc-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pc-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'pc-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, hounde, mana, edH, superT;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /^mana$/i.test(s.name)).id;
  await rdb.db.prepare('UPDATE sites SET zoho_group=? WHERE id=?').run('PC Hounde Agents', hounde);
  await rdb.db.prepare('UPDATE sites SET zoho_group=? WHERE id=?').run('PC Mana Agents', mana);
  const day = new Date(Date.now() - 5 * 86400000).toISOString();
  const ins = (id, grp, site, extra = {}) => rdb.db.prepare(`INSERT INTO request_records (request_id, display_id, request_type, request_status, pending_status, category, sub_category, created_time, tech_group, site)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, id, extra.type || 'Incident', extra.status || 'Open', extra.pending == null ? 1 : extra.pending, 'Network', 'WAN', day, grp, site);
  await ins('pc1', 'PC Hounde Agents', 'MANA');            // free-form site says MANA: must still count for Hounde (group scope)
  await ins('pc2', 'PC Hounde Agents', 'HOUNDE', { status: 'Closed', pending: 0 });
  await ins('pc3', 'PC Hounde Agents', 'HOUNDE');
  await ins('pc4', 'PC Mana Agents', 'HOUNDE');             // free-form site says HOUNDE: must NOT count for Hounde
  const mk = async (u, roles, site) => { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); } catch {} return (await rdb.login(u, u + 'pass1234')).token; };
  edH = await mk('pc_ed_h', ['editor'], hounde); superT = await mk('pc_super', ['super_admin']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  await cfg.setConfig(rdb.db, { commitments_enabled: '1' }, 'test');
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

test('defaults: switch off and no threshold', () => {
  assert.equal(cfg.DEFAULTS.problem_candidates_enabled, '0'); assert.equal(cfg.DEFAULTS.problem_candidate_min, '');
});

test('switch 0 → 404 (list and promotion)', async () => {
  assert.equal((await send('GET', `/api/commitments/problem-candidates?site=${hounde}`, edH)).status, 404);
  assert.equal((await send('POST', '/api/commitments', edH, { kind: 'issue', title: 'x', site_id: hounde, source: { system: 'problem_candidate', id: `${hounde}|Network|WAN` } })).status, 404);
});

test('switch on: threshold empty → no candidate; other site → 403; group scope; promote idempotent', async () => {
  await cfg.setConfig(rdb.db, { problem_candidates_enabled: '1' }, 'test');
  try {
    let j = await (await send('GET', `/api/commitments/problem-candidates?site=${hounde}`, edH)).json();
    assert.equal(j.enabled, false); assert.deepEqual(j.candidates, []);
    await cfg.setConfig(rdb.db, { problem_candidate_min: '3' }, 'test');
    assert.equal((await send('GET', `/api/commitments/problem-candidates?site=${mana}`, edH)).status, 403);
    const r = await send('GET', `/api/commitments/problem-candidates?site=${hounde}`, edH);
    assert.equal(r.status, 200); j = await r.json();
    assert.match(j.status, /causality not validated/);
    assert.equal(j.candidates.length, 1, JSON.stringify(j));
    assert.equal(j.candidates[0].count, 3); assert.equal(j.candidates[0].closed, 1);
    assert.equal(j.candidates[0].commitment_id, null);
    const key = j.candidates[0].source_key;
    assert.equal((await send('POST', '/api/commitments', edH, { kind: 'issue', title: 'x', site_id: mana, source: { system: 'problem_candidate', id: key } })).status, 403, 'other site');
    assert.equal((await send('POST', '/api/commitments', superT, { kind: 'issue', title: 'x', site_id: mana, source: { system: 'problem_candidate', id: key } })).status, 400, 'key / site mismatch');
    const p1 = await send('POST', '/api/commitments', edH, { kind: 'issue', title: 'Recurring WAN', site_id: hounde, accountable_owner: 'pc_ed_h', source: { system: 'problem_candidate', id: key } });
    assert.equal(p1.status, 201, await p1.text());
    const p2 = await send('POST', '/api/commitments', edH, { kind: 'issue', title: 'Recurring WAN', site_id: hounde, source: { system: 'problem_candidate', id: key } });
    assert.equal(p2.status, 200); assert.equal((await p2.json()).created, false);
    j = await (await send('GET', `/api/commitments/problem-candidates?site=${hounde}`, edH)).json();
    assert.ok(j.candidates[0].commitment_id > 0, 'candidate shows its commitment');
    const m = await (await send('GET', `/api/commitments/problem-candidates?site=${mana}`, superT)).json();
    assert.deepEqual(m.candidates, [], 'Mana has one incident only');
  } finally { await cfg.setConfig(rdb.db, { problem_candidates_enabled: '0', problem_candidate_min: '' }, 'test'); }
});
