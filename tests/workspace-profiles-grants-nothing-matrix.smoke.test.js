'use strict';
// P5 / goal A4 — "switching profile grants zero new route", extended to EVERY profile × EVERY role (the 11 profiles of
// public/lib/workspaceProfiles.js × the roles of docs/ops/authz-matrix.json). For each role: one account, the role-gated
// GET routes of the generated authorisation matrix probed with no preference row (baseline), then again with a FORGED
// row for each of the 11 profiles (every destination, a block order, a snooze). The allowed / refused answer of every
// route must be identical, the session roles unchanged, and the served profile one the roles really allow.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'wsgm-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const W = require('../public/lib/workspaceProfiles');
const MATRIX = require('../docs/ops/authz-matrix.json');
// role-gated (or money-bearing) GET routes without a path parameter; exports / pages / debug left out (heavy, not a gate)
const PROBES = MATRIX.routes.filter((r) => r.method === 'GET' && r.path.startsWith('/api/') && !r.path.includes(':')
  && (r.guards.length || r.money_bearing) && !/\.(xlsx|csv|json|html)$|\/debug\//.test(r.path)).map((r) => r.path);
const ROLES = MATRIX.roles;
let server, base, rdb, hounde;
const users = {};

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  await require('../services/reportConfig').setConfig(rdb.db, { workspace_profiles_enabled: '1' }, 'test');
  hounde = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name)).id;
  for (const role of ROLES) {
    const u = 'wsgm_' + role.replace(/[^a-z]/g, '');
    await rdb.createUser({ username: u, full_name: 'M ' + role, password: u + '-pass-1234', roles: [role], site_id: ['super_admin', 'executive', 'admin', 'group-business'].includes(role) ? null : hounde });
    const id = (await rdb.listUsers()).find((x) => x.username === u).id;
    users[role] = { id, token: (await rdb.login(u, u + '-pass-1234')).token };
  }
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const allowed = async (token, p) => { const r = await fetch(base + p, { headers: { 'x-report-token': token } }); await r.arrayBuffer().catch(() => null); return !(r.status === 401 || r.status === 403 || r.status === 404); };
async function probe(token) { const out = {}; for (const p of PROBES) out[p] = await allowed(token, p); return out; }
async function forge(userId, profile) {
  const H = rdb.pgHandle();
  await H.prepare('DELETE FROM user_workspace_prefs WHERE user_id = ?').run(userId);
  await H.prepare(`INSERT INTO user_workspace_prefs (user_id, profile, card_order, cards_hidden, density, block_order, queue_snoozed, updated_at) VALUES (?, ?, ?, NULL, 'compact', ?, ?, ?)`)
    .run(userId, profile, JSON.stringify(Object.keys(W.DESTINATIONS)), JSON.stringify(['sites', 'queue']), JSON.stringify({ 'meetings:1': '2099-01-01' }), new Date().toISOString());
}

test('the probe set comes from the generated matrix and covers the privileged gates', () => {
  assert.ok(PROBES.length >= 40, `${PROBES.length} probes`);
  for (const p of ['/api/reports/system-log', '/api/reports/config', '/api/assets/finance/summary', '/api/reports/users']) assert.ok(PROBES.includes(p), p);
  assert.equal(W.PROFILES.length, 11);
});

test('every profile × every role: the same routes answer, the roles are unchanged, the served profile is allowed', async () => {
  const diffs = [];
  for (const role of ROLES) {
    const { id, token } = users[role];
    await rdb.pgHandle().prepare('DELETE FROM user_workspace_prefs WHERE user_id = ?').run(id);
    const baseline = await probe(token);
    const rolesBefore = (await rdb.validateSession(token)).roles.slice().sort();
    for (const p of W.PROFILES) {
      await forge(id, p.id);
      const now = await probe(token);
      for (const path of PROBES) if (now[path] !== baseline[path]) diffs.push(`${role} × ${p.id}: ${path} ${baseline[path]} → ${now[path]}`);
      assert.deepStrictEqual((await rdb.validateSession(token)).roles.slice().sort(), rolesBefore, `${role} × ${p.id}: roles unchanged`);
      const me = await fetch(base + '/api/workspace/me', { headers: { 'x-report-token': token } });
      if (me.status === 200) {
        const j = await me.json();
        assert.ok(j.eligible.includes(j.profile), `${role} × ${p.id}: served profile ${j.profile} is eligible`);
        for (const d of j.destinations) assert.ok(W.mayOpen(d.id, { roles: [role], has: (r) => rdb.userHasRole({ roles: [role] }, r) }), `${role} × ${p.id}: ${d.id} may be opened`);
      } else { await me.arrayBuffer().catch(() => null); }
    }
  }
  assert.deepStrictEqual(diffs, [], 'a preference row changed what a route answers');
});
