'use strict';
// A0 — SAFETY NET. The machine-readable capability / route matrix (docs/ops/authz-matrix.json) is the contract the
// RBAC regression suite (tests/rbac-matrix.smoke.test.js) enforces at runtime. This file proves:
//   1. the committed JSON equals a fresh walk of the live router — a guard added, removed or re-roled without
//      regenerating the matrix fails CI (regenerate: AUTHZ_MATRIX_UPDATE=1 node --test tests/authz-matrix-json.test.js,
//      or node tools/agent/authz-walk.js --matrix-json --write, then review `git diff docs/ops/authz-matrix.json`);
//   2. the matrix is self-consistent (no unguarded route, every role guard catalogued, money routes never open to a
//      plain viewer, business-only roles reach only the Site Awareness allowlist);
//   3. tools/agent/authz-diff.js reports added / removed / changed rules and flags widenings first.
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const walker = require('../tools/agent/authz-walk');
const { diffMatrix, widenings, format } = require('../tools/agent/authz-diff');

let fresh;
function freshMatrix() {
  if (!fresh) {
    const log = console.log; console.log = () => {};
    try { fresh = walker.buildMatrix(require('../server').app); } finally { console.log = log; }
  }
  return fresh;
}
const committed = () => JSON.parse(fs.readFileSync(walker.MATRIX_JSON_PATH, 'utf8'));

test('the committed authz-matrix.json equals a fresh walk of the live router (regenerate on every guard change)', () => {
  const m = freshMatrix();
  const text = walker.serializeMatrix(m);
  if (process.env.AUTHZ_MATRIX_UPDATE === '1') fs.writeFileSync(walker.MATRIX_JSON_PATH, text);
  const d = diffMatrix(committed(), m);
  assert.equal(d.total, 0, 'docs/ops/authz-matrix.json is stale — regenerate it and review the diff:\n' + format(d));
  assert.equal(fs.readFileSync(walker.MATRIX_JSON_PATH, 'utf8'), text, 'same rules but a different serialisation — regenerate');
});

test('the matrix is self-consistent: no unguarded route, every role guard catalogued', () => {
  const m = committed();
  assert.equal(m.schema, 'sdp360.authz-matrix/1');
  assert.ok(m.routes.length >= 600, `${m.routes.length} routes`);
  assert.deepEqual(m.routes.filter((r) => r.gate === 'UNGUARDED').map((r) => r.key), []);
  assert.deepEqual(m.routes.filter((r) => r.capabilities.includes('UNCATALOGUED')).map((r) => r.key), []);
  for (const r of m.routes) if (r.gate === 'public') assert.ok(r.public_reason, r.key + ' public without a reason');
});

test('invariant 2 (static): no route guarded by the money rule is open to a plain viewer or editor', () => {
  for (const r of committed().routes) {
    if (!r.guards.some((g) => (g.roles || []).includes('finance-viewer'))) continue;
    for (const role of ['viewer', 'editor', 'tracker-editor', 'scorecard-viewer', 'site-business', 'group-business'])
      assert.ok(!r.allowed_roles.includes(role), `${r.key} admits ${role}`);
    assert.ok(r.allowed_roles.includes('finance-viewer') && r.allowed_roles.includes('admin'), r.key);
  }
});

test('invariant 3 (static): business-only roles reach only Site Awareness + session/workspace routes', () => {
  const guard = require('../services/businessGuard');
  for (const r of committed().routes) {
    for (const role of ['site-business', 'group-business']) {
      if (!r.allowed_roles.includes(role)) continue;
      assert.ok(guard.isAllowed(r.path.slice(4)), `${r.key} reachable by ${role}`);
      assert.match(r.path, /^\/api\/(site-awareness|reports\/auth|auth|ping|health\/version|workspace\/(me|prefs))(\/|$)/, r.key);
    }
  }
});

test('authz-diff: a removed guard, a gained role and a new public route are reported as widenings', () => {
  const base = committed();
  const mut = JSON.parse(JSON.stringify(base));
  const fin = mut.routes.find((r) => r.key === 'GET /api/assets/finance/summary');
  fin.guards = []; fin.capabilities = []; fin.allowed_roles = base.roles.filter((x) => !/business/.test(x));
  const sys = mut.routes.find((r) => r.key === 'GET /api/reports/system-log');
  sys.allowed_roles = [...sys.allowed_roles, 'viewer'];
  mut.routes.push({ key: 'GET /api/new-thing', method: 'GET', path: '/api/new-thing', gate: 'public', public_reason: 'x', guards: [], capabilities: [], allowed_roles: ['anonymous'], inline_roles: [], site_scope: [], site_scoped: false, money_bearing: false, business_allowed: false });
  mut.routes = mut.routes.filter((r) => r.key !== 'DELETE /api/workspace/prefs');
  const d = diffMatrix(base, mut);
  assert.equal(d.added.length, 1); assert.equal(d.removed.length, 1); assert.equal(d.changed.length, 2);
  const w = widenings(d).join('\n');
  assert.match(w, /GET \/api\/assets\/finance\/summary: guard removed/);
  assert.match(w, /GET \/api\/assets\/finance\/summary: roles gained .*viewer/);
  assert.match(w, /GET \/api\/reports\/system-log: roles gained viewer/);
  assert.match(w, /GET \/api\/new-thing: new route/);
  assert.match(format(d), /ACCESS WIDENED/);
  assert.equal(diffMatrix(base, base).total, 0);
});

test('authz-diff CLI: exit 1 with --fail-on-change, 0 without', () => {
  const os = require('os'), path = require('path'), { spawnSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authz-diff-'));
  const a = path.join(dir, 'a.json'), b = path.join(dir, 'b.json');
  const m = committed();
  fs.writeFileSync(a, JSON.stringify(m));
  m.routes[0].allowed_roles = [...m.routes[0].allowed_roles, 'zzz'];
  fs.writeFileSync(b, JSON.stringify(m));
  const env = Object.assign({}, process.env, { NODE_OPTIONS: '' });
  const cli = path.join(__dirname, '..', 'tools', 'agent', 'authz-diff.js');
  const r1 = spawnSync(process.execPath, [cli, a, b, '--fail-on-change'], { encoding: 'utf8', env });
  assert.equal(r1.status, 1, r1.stderr); assert.match(r1.stdout, /roles gained zzz/);
  const r0 = spawnSync(process.execPath, [cli, a, b], { encoding: 'utf8', env });
  assert.equal(r0.status, 0, r0.stderr);
});
