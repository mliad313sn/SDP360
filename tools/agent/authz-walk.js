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

function bootApp() {
  const os = require('os'), fs = require('fs'), path = require('path');
  process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'authz-walk-'));
  process.env.DASH_USER = process.env.DASH_USER || 'authz-walk'; process.env.DASH_PASS = process.env.DASH_PASS || 'authz-walk-0000';
  for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
  const log = console.log; console.log = () => {};
  try { return require('../../server').app; } finally { console.log = log; }
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

module.exports = { ROLE_GUARD_NAMES, walkRoutes, guardsOf, inlineOf, scanInlineChecks, buildRows, bootApp };
