'use strict';
// E-S01 (audit S-04) — capability enforcement per allow-list (authz_enforce_caps).
// enforce acts ONLY on listed capabilities, can only REFUSE (never widen), ignores critical caps while
// C-18 grants are off, and leaves off/shadow exactly as today.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'authz-enf-'));
process.env.DASH_USER = process.env.DASH_USER || 'enf-admin'; process.env.DASH_PASS = process.env.DASH_PASS || 'enf-pass-0000';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test } = require('node:test');
const assert = require('node:assert');

const shadow = require('../services/authzShadow');
const authz = require('../services/authorizationService');
const registry = require('../services/capabilityRegistry');
const walker = require('../tools/agent/authz-walk');
const rdb = require('../reports-db');
const report = require('../tools/security/authz-divergence-report');
const { DEFAULTS } = require('../services/reportConfig');

const hasRole = rdb.userHasRole;
const fakeReq = (roles, path, method = 'GET') => ({ reportUser: roles ? { id: 9, username: 'secret-name', roles } : undefined, method, baseUrl: '', route: { path }, ip: '10.1.2.3' });
function fakeRes() {
  return { statusCode: 200, body: null, headersSent: false, req: { method: 'GET', originalUrl: '/x' },
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; this.headersSent = true; return this; } };
}
const policy = (caps, mode = 'enforce') => ({ mode, caps: new Set(caps), at: Date.now() });
const tick = () => new Promise((r) => setTimeout(r, 20));

test('authz_enforce_caps defaults to empty (nothing enforced = today)', () => {
  assert.equal(DEFAULTS.authz_enforce_caps, '');
  assert.equal(shadow.parseEnforceCaps('', {}).size, 0);
});

test('mode enforce + empty list = identical answers to shadow on every guarded route', async () => {
  const { app } = require('../server');
  const rows = walker.walkRoutes(app._router.stack).filter((r) => r.path.startsWith('/api'));
  const HIER = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];
  let n = 0;
  for (const r of rows) for (const g of walker.guardsOf(r).filter((x) => x.roles)) for (const roles of [[], ...HIER.map((x) => [x]), ['scorecard-viewer'], ['tracker-editor']]) {
    const res = fakeRes();
    const d = shadow.enforceDecision({ ...fakeReq(roles, r.path, r.method) }, res, g.roles, policy([]), { hasRole });
    assert.equal(d, 'legacy', r.key); assert.equal(res.body, null); n++;
  }
  assert.ok(n > 500, 'routes walked: ' + n);
});

test('a listed low-risk read capability (review.read) refuses a role the catalogue denies, logs once, actor id only', async () => {
  const logs = [];
  const res = fakeRes();
  const roles = ['executive', 'scorecard-viewer'];
  const d = shadow.enforceDecision(fakeReq(['viewer'], '/api/reports/review-data'), res, roles, policy(['review.read']), { hasRole, logEvent: async (e) => logs.push(e) });
  assert.equal(d, 'denied'); assert.equal(res.statusCode, 403);
  assert.equal(res.body.reason_code, 'missing_role'); assert.equal(res.body.capability, 'review.read');
  await tick();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].category, 'authz'); assert.equal(logs[0].action, 'authz_enforce_denied');
  assert.equal(logs[0].actor, 'user:9'); assert.equal(logs[0].target, 'review.read');
  assert.ok(!/secret|10\.1\.2\.3/.test(JSON.stringify(logs[0])), 'no name / ip in the log');
  // a holder is handed to the legacy guard
  const ok = fakeRes();
  assert.equal(shadow.enforceDecision(fakeReq(['scorecard-viewer'], '/api/reports/review-data'), ok, roles, policy(['review.read']), { hasRole, logEvent: async (e) => logs.push(e) }), 'legacy');
  assert.equal(ok.body, null);
  await tick(); assert.equal(logs.length, 1);
});

test('no session under enforce stays the legacy guard answer (its own 401)', () => {
  const res = fakeRes();
  assert.equal(shadow.enforceDecision(fakeReq(null, '/api/reports/review-data'), res, ['executive', 'scorecard-viewer'], policy(['review.read']), { hasRole }), 'legacy');
});

test('a critical capability is ignored with a warning while C-18 grants are off; kept once grants are on', () => {
  const warns = [];
  const caps = shadow.parseEnforceCaps('platform.identity.manage, review.read, no.such.cap, scope.all_sites', {}, (k, m) => warns.push(m));
  assert.deepEqual([...caps], ['review.read']);
  assert.ok(warns.some((m) => /critical capability "platform.identity.manage" ignored/.test(m)));
  assert.ok(warns.some((m) => /unknown capability "no.such.cap"/.test(m)));
  assert.ok(warns.some((m) => /scope.all_sites/.test(m)));
  const on = shadow.parseEnforceCaps('platform.identity.manage', { access_require_approval: '1' });
  assert.deepEqual([...on], ['platform.identity.manage']);
});

test('enforce never widens: a can() allow still goes through a refusing legacy guard', async () => {
  // A guard whose legacy layer refuses everybody, tagged with a role set that can() allows for this user.
  let called = 0;
  const legacy = function requireRoleX(req, res) { called++; res.status(403).json({ error: 'legacy says no' }); };
  legacy.legacyRoles = ['executive', 'scorecard-viewer'];
  const app = { _router: { stack: [{ route: { stack: [{ handle: legacy }] } }] } };
  shadow._resetCache();
  const deps = { hasRole, getConfig: async () => ({ authz_capability_mode: 'enforce', authz_enforce_caps: 'review.read' }), logEvent: async () => {} };
  assert.equal(shadow.instrument(app, deps), 1);
  const wrapped = app._router.stack[0].route.stack[0].handle;
  const res = fakeRes();
  wrapped(fakeReq(['executive'], '/api/reports/review-data'), res, () => assert.fail('must not pass'));
  await tick();
  assert.equal(called, 1); assert.equal(res.statusCode, 403); assert.equal(res.body.error, 'legacy says no');
  shadow._resetCache();
});

test('off and shadow modes: the legacy guard answers, no enforce refusal, even with a list set', async () => {
  for (const mode of ['off', 'shadow']) {
    let called = 0;
    const legacy = function requireRoleY(req, res, next) { called++; next(); };
    legacy.legacyRoles = ['executive', 'scorecard-viewer'];
    const app = { _router: { stack: [{ route: { stack: [{ handle: legacy }] } }] } };
    shadow._resetCache();
    const logs = [];
    shadow.instrument(app, { hasRole, getConfig: async () => ({ authz_capability_mode: mode, authz_enforce_caps: 'review.read' }), logEvent: async (e) => logs.push(e) });
    let passed = false;
    app._router.stack[0].route.stack[0].handle(fakeReq(['viewer'], '/api/reports/review-data'), fakeRes(), () => { passed = true; });
    await tick();
    assert.equal(called, 1, mode); assert.equal(passed, true, mode);
    assert.ok(!logs.some((l) => l.action === 'authz_enforce_denied'), mode);
  }
  shadow._resetCache();
});

test('every enforceable capability refuses only what the legacy role set also refuses (catalogue = legacy today)', () => {
  const HIER = ['super_admin', 'executive', 'admin', 'editor', 'viewer', 'scorecard-viewer', 'tracker-editor', 'finance-viewer'];
  for (const c of registry.list().filter((x) => !x.inline)) for (const r of HIER) {
    const u = { id: 1, roles: [r] };
    const legacyAllow = c.legacy.some((role) => hasRole(u, role));
    assert.equal(authz.can(u, c.id, {}, hasRole).allow, legacyAllow, `${c.id} [${r}]`);
  }
});

test('divergence report groups by capability/route, prints counts only (no names, no ids)', async () => {
  const rows = [
    { ts: '2026-11-01T10:00:00Z', action: 'authz_shadow_divergence', actor_id: 7, target: 'uncatalogued', details: JSON.stringify({ route: 'POST /api/new/thing', reason_code: 'unknown_capability' }) },
    { ts: '2026-11-02T10:00:00Z', action: 'authz_shadow_divergence', actor_id: 8, target: 'uncatalogued', details: { route: 'POST /api/new/thing', reason_code: 'unknown_capability' } },
    { ts: '2026-11-03T10:00:00Z', action: 'authz_enforce_denied', actor_id: 7, target: 'review.read', details: { route: 'GET /api/reports/review-data', reason_code: 'missing_role' } },
    { ts: '2026-11-03T10:00:00Z', action: 'login_failed', actor_id: 7, target: 'x', details: {} },
  ];
  const lines = report.summarize(rows);
  assert.equal(lines.length, 2);
  assert.deepEqual({ ...lines[0], reasons: undefined }, { action: 'authz_shadow_divergence', capability: 'uncatalogued', route: 'POST /api/new/thing', count: 2, distinct_actors: 2, reasons: undefined, first: '2026-11-01', last: '2026-11-02' });
  const md = await report.report({ query: async () => rows, days: 14, asOf: '2026-11-05' });
  assert.match(md, /2026-10-22 → 2026-11-05 \(14 days\)/);
  assert.match(md, /\| uncatalogued \| POST \/api\/new\/thing \| 2 \| 2 \|/);
  assert.match(md, /Total shadow divergences: 2/);
  assert.ok(!/\b7\b.*\b8\b|secret/.test(md.split('\n').filter((l) => l.startsWith('|')).join('\n').replace(/\| 2 \| 2 \|/g, '')));
});

test('divergence report reads a real system_log (throwaway PostgreSQL)', async () => {
  await rdb.logEvent({ category: 'authz', action: 'authz_enforce_denied', actor: 'user:3', actor_id: 3, target: 'review.read', risk: 0, details: { route: 'GET /api/reports/review-data', reason_code: 'missing_role' } });
  const h = rdb.pgHandle();
  const md = await report.report({ query: async (sql, p) => h.prepare(sql.replace(/\$1/g, '?')).all(...p), days: 2 });
  assert.match(md, /\| review\.read \| GET \/api\/reports\/review-data \| 1 \| 1 \| missing_role ×1 \|/);
});
