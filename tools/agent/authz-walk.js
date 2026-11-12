'use strict';
// C-17 (G36/G37) — walk the live Express router and list, per API route, the role guard it
// carries (the role set read off the guard's `legacyRoles` tag), the capability the catalogue
// maps it to, and the inline role checks / site-scope helpers found in its handler source.
//
//   node tools/agent/authz-walk.js            → table on stdout
//   node tools/agent/authz-walk.js --json     → JSON rows
//
// Pure helpers are exported for tests/authz-route-matrix.test.js and tests/capability-registry.test.js.
// Read-only: requires server.js without starting it (no port, no database write).

// Middleware names that are role guards. A layer with one of these names MUST carry `legacyRoles`.
const ROLE_GUARD_NAMES = ['requireAdmin', 'requireSuperAdmin', 'requireExecutiveOrSuperAdmin', 'requireRole', 'requireMoneyRead',
  '_syslogGate', 'requireSuper', 'requireSuperTier', 'requireAdminTier', 'requireCommittee', 'requireBuilder', 'requirePublisher',
  'requireField', 'requireAuthor', 'requireKpiCommittee'];
// Helper names that, inside a handler, narrow the answer to the caller's sites.
const SITE_SCOPE_HELPERS = ['_siteReadDenied', '_siteCodeReadDenied', '_userSiteGroups', '_authorizeReportWrite', '_authorizeSiteWrite',
  '_authorizeActionWrite', '_sitelessWriteDenied', '_userMeetingsSite', '_userInspectionSite', 'userSites.', 'scopeSites', 'siteIdsOf', 'scope(', 'canEditSite('];
// Local predicate helpers → the role(s) they test (each is `userHasRole(u, role)` or an OR of them).
const INLINE_HELPERS = { isAdmin: ['admin'], isSuper: ['super_admin'], isCommittee: ['admin', 'committee-member'], isBuilder: ['admin', 'tracker-admin'],
  isPublisher: ['admin', 'dashboard-publisher'], isField: ['admin', 'editor', 'field-tech'], isAuthor: ['admin', 'report-author'],
  _canReadMoney: ['admin', 'finance-viewer'], _adminTier: ['admin'], canEditSite: ['admin'] };

function walkRoutes(stack, prefix = '', out = []) {
  for (const layer of stack || []) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]).map((m) => m.toUpperCase());
      const layers = layer.route.stack.map((l) => ({ name: l.name || (l.handle && l.handle.name) || 'anonymous', handle: l.handle }));
      for (const m of methods) out.push({ key: `${m} ${prefix}${layer.route.path}`, method: m, path: prefix + layer.route.path, layers });
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      const mm = layer.regexp && layer.regexp.source.match(/^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)/);
      walkRoutes(layer.handle.stack, prefix + (mm ? '/' + mm[1].replace(/\\\//g, '/') : ''), out);
    }
  }
  return out;
}

/** Role guards of one route: [{name, roles}] (roles = null when a guard-named layer carries no tag). */
function guardsOf(route) {
  return route.layers.filter((l) => (l.handle && Array.isArray(l.handle.legacyRoles)) || ROLE_GUARD_NAMES.some((n) => l.name === n || l.name.startsWith(n + '(')))
    .map((l) => ({ name: l.name, roles: l.handle && Array.isArray(l.handle.legacyRoles) ? [...l.handle.legacyRoles] : null }));
}

/** Inline role checks + site-scope helpers found in the route's handler source (non-guard layers). */
function inlineOf(route) {
  const roles = new Set(), scope = new Set();
  for (const l of route.layers) {
    if (!l.handle || Array.isArray(l.handle.legacyRoles) || l.name === 'requireReportSession') continue;
    let src = '';
    try { src = Function.prototype.toString.call(l.handle); } catch (_) { continue; }
    for (const m of src.matchAll(/userHasRole\([^']*?'([\w-]+)'\)/g)) roles.add(m[1]);
    for (const [h, rs] of Object.entries(INLINE_HELPERS)) if (new RegExp('\\b' + h + '\\(').test(src)) rs.forEach((r) => roles.add(r));
    for (const h of SITE_SCOPE_HELPERS) if (src.includes(h)) scope.add(h.replace(/[.(]$/, ''));
  }
  return { roles: [...roles].sort(), scope: [...scope].sort() };
}

/** Static scan: every `userHasRole(x, 'role')` literal in server.js + routes/*.js → [{file, line, role}]. */
function scanInlineChecks(root) {
  const fs = require('fs'), path = require('path');
  const files = ['server.js', ...fs.readdirSync(path.join(root, 'routes')).filter((f) => f.endsWith('.js')).map((f) => 'routes/' + f)];
  const out = [];
  for (const f of files) {
    fs.readFileSync(path.join(root, f), 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/userHasRole\([^']*?'([\w-]+)'\)/g)) out.push({ file: f, line: i + 1, role: m[1] });
    });
  }
  return out;
}

/** One row per API route: {key, session, guards:[{name,roles}], capability, inline_roles, site_scope}. */
function buildRows(app, registry = require('../../services/capabilityRegistry')) {
  return walkRoutes(require('../../services/routerStack').routerStack(app)).filter((r) => r.path.startsWith('/api') || r.path === '/health' || r.path === '/ready').map((r) => {
    const guards = guardsOf(r);
    const caps = guards.filter((g) => g.roles).map((g) => registry.forRoute(r.method, r.path, g.roles));
    const inl = inlineOf(r);
    return { key: r.key, method: r.method, path: r.path, session: r.layers.some((l) => l.name === 'requireReportSession'), guards,
      capabilities: caps.map((c) => (c ? c.id : null)), inline_roles: inl.roles, site_scope: inl.scope };
  });
}

// A0 — public routes (reason) and the prefixes that rely only on the global /api gate. Shared with
// tests/authz-route-matrix.test.js so the Markdown matrix and the machine-readable JSON agree.
const PUBLIC = {
  'GET /health': 'liveness probe',
  'GET /ready': 'readiness probe — {ok, db, last_job_at} only, no business data (fiche C1/M14)',
  'GET /api/health': 'liveness probe',
  'GET /api/exec/summary': 'SharePoint-facing aggregates, PII-whitelisted (Exec View v1)',
  'GET /api/auth/config': 'SSO mode discovery before login',
  'GET /api/auth/sso/login': 'OIDC start',
  'GET /api/auth/sso/callback': 'OIDC return',
  'POST /api/reports/auth/login': 'password login (rate-limited)',
  'GET /api/actions/open': 'Meridian server-to-server — own X-API-Key check inside routes/meridian.js',
};
const GLOBAL_GATE_PREFIXES = ['/api/data/', '/api/survey/', '/api/sync/', '/api/dashboard/', '/api/ai/', '/api/risk-register-config', '/api/admin/', '/api/exec/', '/api/analytics/', '/api/integrations/', '/api/meetings/', '/api/inspection/', '/api/tracker/', '/api/assets/', '/api/roadmap/', '/api/teams-sla/', '/api/metrics/', '/api/fmp/', '/api/meridian/', '/api/sites', '/api/reconcile', '/api/4mp', '/api/site-awareness', '/api/changes', '/api/major-incidents', '/api/weeks', '/api/exec-pptx', '/api/ping'];
// Central site-read guard of server.js (app.get([_REPORT_ID_READ, _SITE_ID_READ])) — a GET under these paths is
// site-scoped before its own handler runs.
const CENTRAL_SITE_READ = [/^\/api\/reports\/:id(\/|$)/, /^\/api\/(?:reports\/(?:monthly|yearly|objectives)|sites)\/:(?:site_?id|id|site)(\/|$)/];
// Handler-source markers of an amount-bearing answer (masked below the money readers).
const MONEY_MARKERS = ['requireMoneyRead', '_canReadMoney(', '_stripAssetMoney', 'canSeeMoney(', "'finance-viewer'", 'readsMoney', 'canReadMoney('];

function _src(route) {
  let s = '';
  for (const l of route.layers) { try { s += Function.prototype.toString.call(l.handle) + '\n'; } catch (_) { /* native */ } }
  return s;
}

/**
 * A0 — machine-readable capability / route matrix. Deterministic (no date) so the committed copy
 * (docs/ops/authz-matrix.json) can be diffed per release and checked for freshness by a test.
 * allowed_roles = the canonical single-role accounts that pass every role guard on the route AND the
 * business-only lock (services/businessGuard); it says nothing of site scope or handler-level checks.
 */
function buildMatrix(app, deps = {}) {
  const rdb = deps.rdb || require('../../reports-db');
  const registry = deps.registry || require('../../services/capabilityRegistry');
  const bguard = deps.businessGuard || require('../../services/businessGuard');
  const { isBusinessOnly } = require('../../public/lib/businessRoles');
  const roles = [...rdb.ROLE_HIERARCHY, ...rdb.FEATURE_ROLES_KNOWN];
  const routes = walkRoutes(require('../../services/routerStack').routerStack(app)).filter((r) => typeof r.path === 'string' && (r.path.startsWith('/api') || r.path === '/health' || r.path === '/ready'));
  const seen = new Set();
  const rows = [];
  for (const r of routes) {
    if (seen.has(r.key)) continue;   // first registration wins in Express
    seen.add(r.key);
    const guards = guardsOf(r);
    const inl = inlineOf(r);
    const src = _src(r);
    let gate;
    if (PUBLIC[r.key]) gate = 'public';
    else if (r.layers.some((l) => l.name === 'requireReportSession') || guards.length) gate = 'session';
    else if (GLOBAL_GATE_PREFIXES.some((p) => r.path.startsWith(p))) gate = 'global';
    else gate = 'UNGUARDED';
    const apiPath = r.path.startsWith('/api') ? r.path.slice(4) : r.path;
    const businessAllowed = bguard.isAllowed(apiPath);
    const allowed = gate === 'public' ? ['anonymous'] : roles.filter((role) => {
      const u = { roles: [role] };
      if (isBusinessOnly(u.roles) && !businessAllowed) return false;
      return guards.every((g) => !g.roles || g.roles.some((gr) => rdb.userHasRole(u, gr)));
    });
    const caps = guards.filter((g) => g.roles).map((g) => { const c = registry.forRoute(r.method, r.path, g.roles); return c ? c.id : 'UNCATALOGUED'; });
    rows.push({
      key: r.key, method: r.method, path: r.path, gate,
      ...(gate === 'public' ? { public_reason: PUBLIC[r.key] } : {}),
      guards: guards.map((g) => ({ name: g.name, roles: g.roles })),
      capabilities: caps, allowed_roles: allowed,
      inline_roles: inl.roles, site_scope: inl.scope,
      site_scoped: inl.scope.length > 0 || (r.method === 'GET' && CENTRAL_SITE_READ.some((re) => re.test(r.path))),
      money_bearing: MONEY_MARKERS.some((m) => src.includes(m)) || guards.some((g) => (g.roles || []).includes('finance-viewer')),
      business_allowed: businessAllowed,
    });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  const byRole = {};
  for (const role of roles) byRole[role] = rows.filter((x) => x.allowed_roles.includes(role)).length;
  return {
    schema: 'sdp360.authz-matrix/1',
    generated_by: 'node tools/agent/authz-walk.js --matrix-json --write (or AUTHZ_MATRIX_UPDATE=1 node --test tests/authz-matrix-json.test.js)',
    roles,
    capabilities: registry.list().map((c) => ({ id: c.id, risk: c.risk, scope: c.scope, legacy: [...c.legacy], inline: c.inline, requires_request: c.requires_request })),
    totals: { routes: rows.length, public: rows.filter((x) => x.gate === 'public').length, role_guarded: rows.filter((x) => x.guards.length).length,
      site_scoped: rows.filter((x) => x.site_scoped).length, money_bearing: rows.filter((x) => x.money_bearing).length, reachable_by_role: byRole },
    routes: rows,
  };
}

const MATRIX_JSON_PATH = require('path').join(__dirname, '..', '..', 'docs', 'ops', 'authz-matrix.json');
// One route per line so a release diff (git diff / authz-diff.js) reads route by route.
function serializeMatrix(m) {
  const head = Object.assign({}, m); delete head.routes;
  const h = JSON.stringify(head, null, 1);
  return h.slice(0, -2) + ',\n "routes": [\n' + m.routes.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n ]\n}\n';
}

function bootApp() {
  const os = require('os'), fs = require('fs'), path = require('path');
  process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'authz-walk-'));
  process.env.DASH_USER = process.env.DASH_USER || 'authz-walk'; process.env.DASH_PASS = process.env.DASH_PASS || 'authz-walk-0000';
  for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
  const log = console.log; console.log = () => {};
  try { return require('../../server').app; } finally { console.log = log; }
}

if (require.main === module && process.argv.includes('--matrix-json')) {
  const m = buildMatrix(bootApp());
  if (process.argv.includes('--write')) { require('fs').writeFileSync(MATRIX_JSON_PATH, serializeMatrix(m)); process.stderr.write(`[authz-walk] ${m.routes.length} routes → ${MATRIX_JSON_PATH}\n`); }
  else { process.stdout.write(serializeMatrix(m), () => process.exit(0)); return; }
  process.exit(0);
}
if (require.main === module) {
  const rows = buildRows(bootApp());
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify({ routes: rows, inline: scanInlineChecks(require('path').join(__dirname, '..', '..')) }, null, 1) + '\n');
  else for (const r of rows) {
    const g = r.guards.map((x) => `${x.name}[${(x.roles || ['?']).join('|')}]`).join(' ') || '-';
    process.stdout.write(`${r.key}\t${r.session ? 'session' : '-'}\t${g}\t${r.capabilities.join(',') || '-'}\t${r.inline_roles.join('|') || '-'}\t${r.site_scope.join(',') || '-'}\n`);
  }
  process.exit(0);
}

module.exports = { ROLE_GUARD_NAMES, walkRoutes, guardsOf, inlineOf, scanInlineChecks, buildRows, bootApp,
  PUBLIC, GLOBAL_GATE_PREFIXES, CENTRAL_SITE_READ, MONEY_MARKERS, buildMatrix, serializeMatrix, MATRIX_JSON_PATH };
