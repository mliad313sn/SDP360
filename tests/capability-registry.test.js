'use strict';
// C-17 (G36/G37/G42 · A01) — capability catalogue, single evaluator, zero escalation, shadow mode.
// The zero-escalation proof runs the REAL guard middleware of every role-guarded route (as mounted on the
// live router) for every role set of the hierarchy + feature roles, and checks that `can()` on the
// route's capability gives the same decision. A catalogue that would widen OR narrow a guard fails here.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'capreg-'));
process.env.DASH_USER = process.env.DASH_USER || 'cap-admin'; process.env.DASH_PASS = process.env.DASH_PASS || 'cap-pass-0000';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const registry = require('../services/capabilityRegistry');
const authz = require('../services/authorizationService');
const shadow = require('../services/authzShadow');
const walker = require('../tools/agent/authz-walk');
const rdb = require('../reports-db');
const { DEFAULTS } = require('../services/reportConfig');

const HIER = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];
const FEATURE = ['tracker-admin', 'tracker-editor', 'report-author', 'audit-viewer', 'scorecard-viewer', 'site-business', 'group-business', 'dashboard-publisher', 'committee-member', 'field-tech', 'finance-viewer'];
// every single role, no role, every hierarchy tier combined with every feature role
const ROLE_SETS = [[], ...HIER.map((r) => [r]), ...FEATURE.map((r) => [r]), ...HIER.flatMap((h) => FEATURE.map((f) => [h, f]))];
const userOf = (roles) => ({ id: 42, username: 'probe', roles, site_id: 1, site_ids: [1] });

test('catalogue is well formed: unique ids, known roles, valid risk/scope, bilingual labels', () => {
  const ids = new Set();
  for (const c of registry.list()) {
    assert.ok(!ids.has(c.id), 'duplicate ' + c.id); ids.add(c.id);
    assert.ok(registry.RISKS.includes(c.risk), c.id + ' risk');
    assert.ok(['site', 'platform'].includes(c.scope), c.id + ' scope');
    assert.ok(c.en && c.fr && c.resource, c.id + ' labels/resource');
    assert.ok(c.legacy.length > 0, c.id + ' legacy');
    for (const r of c.legacy) assert.ok(rdb.ROLE_HIERARCHY.includes(r) || rdb.FEATURE_ROLES_KNOWN.includes(r) || [...HIER, ...FEATURE].includes(r), `${c.id}: unknown role ${r}`);
    assert.deepEqual([...c.prereq], [], 'no qualification prerequisite exists today');
  }
});

test('unknown capability and missing session always deny', () => {
  assert.deepEqual(authz.can(userOf(['super_admin']), 'no.such.cap').reason_code, 'unknown_capability');
  assert.equal(authz.can(userOf(['super_admin']), 'no.such.cap').allow, false);
  assert.equal(authz.can(null, 'platform.settings.manage').reason_code, 'no_session');
  const d = authz.can(userOf(['viewer']), 'platform.settings.manage');
  assert.equal(d.allow, false); assert.equal(d.reason_code, 'missing_role'); assert.deepEqual(d.needed, ['super_admin']);
  assert.equal(authz.can(userOf(['executive']), 'platform.settings.manage').allow, false);
  assert.equal(authz.can(userOf(['super_admin']), 'platform.settings.manage').reason_code, 'granted_by_role');
});

test('site-scoped capability only narrows: other site denied for an editor, admin tier exempt', () => {
  const ed = userOf(['editor']);
  assert.equal(authz.can(ed, 'field.capture', { siteId: 1 }).allow, true);
  assert.equal(authz.can(ed, 'field.capture', { siteId: 2 }).reason_code, 'site_out_of_scope');
  assert.equal(authz.can(userOf(['admin']), 'field.capture', { siteId: 2 }).allow, true);
  assert.equal(authz.can(ed, 'platform.settings.manage', { siteId: 1 }).allow, false);
});

test('why(): by capability id, by the role set a page gate needed, unknown → unknown_capability', () => {
  const a = authz.why(userOf(['viewer']), { cap: 'finance.read' });
  assert.equal(a.allow, false); assert.equal(a.reason_code, 'missing_role'); assert.equal(a.capability.id, 'finance.read');
  const b = authz.why(userOf(['viewer']), { need: ['scorecard-viewer', 'admin'] });
  assert.equal(b.capability.id, 'analytics.data.read');
  assert.equal(authz.why(userOf(['viewer']), { need: ['nobody'] }).reason_code, 'unknown_capability');
  assert.equal(authz.why(userOf(['viewer']), { cap: 'bogus' }).capability, null);
});

let _rows = null;
function rows() {
  if (_rows) return _rows;
  const { app } = require('../server');
  _rows = walker.walkRoutes(app._router.stack).filter((r) => r.path.startsWith('/api'));
  return _rows;
}

test('every role guard on the live router is tagged and maps to a catalogued capability', () => {
  const bad = [], seen = new Set();
  for (const r of rows()) {
    for (const g of walker.guardsOf(r)) {
      if (!g.roles) { bad.push(`${r.key}: guard ${g.name} has no legacyRoles tag`); continue; }
      const c = registry.forRoute(r.method, r.path, g.roles);
      if (!c) bad.push(`${r.key}: ${g.name}[${g.roles.join('|')}] → no capability`);
      else { seen.add(c.id); assert.deepEqual([...c.legacy].sort(), [...g.roles].sort(), r.key); }
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(seen.size >= 20, `capabilities used by guards: ${seen.size}`);
});

function runGuard(h, user) {
  let status = null, nextCalled = false;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  h({ reportUser: user, method: 'GET', path: '/', baseUrl: '' }, res, () => { nextCalled = true; });
  return nextCalled ? true : (status === 403 ? false : `status ${status}`);
}

test('ZERO ESCALATION: for every role set and every guarded route, can() ≡ the legacy guard', () => {
  const mism = [];
  let checks = 0;
  for (const r of rows()) {
    for (const l of r.layers) {
      const h = l.handle && (l.handle.__inner || l.handle);
      if (!h || !Array.isArray(h.legacyRoles)) continue;
      const cap = registry.forRoute(r.method, r.path, h.legacyRoles);
      for (const roles of ROLE_SETS) {
        const u = userOf(roles);
        const legacy = runGuard(h, u);
        const mine = authz.can(u, cap && cap.id).allow;
        checks++;
        if (legacy !== mine) mism.push(`${r.key} ${l.name} roles=[${roles}] legacy=${legacy} can=${mine}`);
      }
    }
  }
  assert.deepEqual(mism.slice(0, 20), []);
  assert.ok(checks > 5000, `checks: ${checks}`);
});

test('every role tested inline in server.js / routes/*.js is named by at least one capability', () => {
  const inline = walker.scanInlineChecks(path.join(__dirname, '..'));
  assert.ok(inline.length > 50, `inline checks found: ${inline.length}`);
  const covered = new Set(registry.list().flatMap((c) => c.legacy));
  const missing = [...new Set(inline.map((x) => x.role))].filter((r) => !covered.has(r));
  assert.deepEqual(missing, []);
});

test('authz_capability_mode switch: default off; unknown values read as off', () => {
  assert.equal(DEFAULTS.authz_capability_mode, 'off');
  assert.equal(shadow.normalizeMode('SHADOW'), 'shadow');
  assert.equal(shadow.normalizeMode('yes'), 'off');
  assert.equal(shadow.normalizeMode(undefined), 'off');
});

test('every guard on the live router is wrapped by the shadow instrument without changing its name', () => {
  for (const r of rows()) for (const l of r.layers) {
    if (l.handle && Array.isArray(l.handle.legacyRoles)) {
      assert.equal(l.handle.__authzShadow, true, r.key + ' ' + l.name);
      assert.equal(l.handle.name, l.handle.__inner.name);
    }
  }
});

const tick = () => new Promise((r) => setTimeout(r, 20));
function fakeReq(roles, routePath) { return { reportUser: { id: 7, username: 'secret-name', full_name: 'Secret Person', roles }, method: 'POST', baseUrl: '', route: { path: routePath }, ip: '10.0.0.9' }; }

test('shadow mode: no divergence is logged when catalogue and guard agree; off logs nothing', async () => {
  const logs = [];
  shadow._resetCache();
  shadow.observe(fakeReq(['viewer'], '/api/reports/users'), ['super_admin'], { getConfig: async () => ({ authz_capability_mode: 'shadow' }), logEvent: async (e) => logs.push(e) });
  await tick();
  shadow._resetCache();
  shadow.observe(fakeReq(['viewer'], '/api/x'), ['nobody-role'], { getConfig: async () => ({ authz_capability_mode: 'off' }), logEvent: async (e) => logs.push(e) });
  await tick();
  assert.deepEqual(logs, []);
});

test('shadow mode: a divergence (uncatalogued guard) is logged to category authz with the user id only', async () => {
  const logs = [];
  shadow._resetCache();
  shadow.observe(fakeReq(['field-tech'], '/api/new/thing'), ['field-tech'], { getConfig: async () => ({ authz_capability_mode: 'shadow' }), logEvent: async (e) => logs.push(e), hasRole: rdb.userHasRole });
  await tick();
  assert.equal(logs.length, 1);
  const e = logs[0];
  assert.equal(e.category, 'authz'); assert.equal(e.action, 'authz_shadow_divergence');
  assert.equal(e.actor, 'user:7'); assert.equal(e.actor_id, 7); assert.equal(e.target, 'uncatalogued');
  assert.equal(e.details.legacy_allow, true); assert.equal(e.details.capability_allow, false); assert.equal(e.details.reason_code, 'unknown_capability');
  const flat = JSON.stringify(e);
  assert.ok(!/secret|10\.0\.0\.9/i.test(flat), 'no name / ip in the log');
  shadow._resetCache();
});

test('shadow compare() finds no divergence on any guarded route for any role set', () => {
  let n = 0;
  for (const r of rows()) for (const g of walker.guardsOf(r)) for (const roles of ROLE_SETS) {
    const c = shadow.compare(userOf(roles), r.method, r.path, g.roles, rdb.userHasRole); n++;
    assert.equal(c.diverges, false, `${r.key} [${roles}]`);
  }
  assert.ok(n > 5000);
});
