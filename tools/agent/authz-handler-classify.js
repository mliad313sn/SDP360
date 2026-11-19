'use strict';
// P02 — declared expectation of the IN-HANDLER authorisation decision of every session-gated route that carries no
// role guard (docs/ops/authz-handler-checks.json). A role guard is visible to the router walk (tools/agent/authz-walk.js);
// a decision taken inside the handler is not, so it is DECLARED here, reviewed in the diff, merged into the matrix as
// the `handler_check` field, and held to two pieces of evidence by tests/authz-handler-checks.test.js:
//   - static: a route whose handler source shows a role / site / ownership / switch signal may not be declared 'none';
//   - runtime: a route declared 'none' must give the SAME outcome class (refusal vs pass) to every active signed-in
//     non-business persona in docs/ops/authz-outcomes.json (tests/authz-outcomes.smoke.test.js).
//
//   node tools/agent/authz-handler-classify.js            → print the draft classification (static signals)
//   node tools/agent/authz-handler-classify.js --write    → merge new routes into the declarations file; a reviewed
//                                                           entry ("reviewed": true) is never overwritten; stale keys dropped
//
// Classes: role (role / tier / money-reader check inside the handler or a store it calls) · site (site perimeter,
// incl. the central site-read guard of server.js) · ownership (own object / own record / named member) ·
// switch (a report_config switch decides — 404 while off) · none (any signed-in non-business account; note required).
const CLASSES = ['role', 'site', 'ownership', 'switch'];
const SIGNALS = {
  role: /userHasRole|\bis(Admin|Super|Committee|Builder|Publisher|Field|Author|Exec)\w*\(|_adminTier\(|_canReadMoney\(|canSeeMoney\(|canReadMoney\(|adminOr403\(|_requireSuperAdminInline\(|committeeOnly\(|requireCommittee\(|moneyStrict\(|moneyVerifier\(|refuseMoneyBenefit\(|refusePlanWrite\(|superOnly|exportPolicyGate|canRun\(|\.roles\b|planWrite\(|mayManage\(|\.decide\(|incubationSource\(|loadDef\(|dashboardData\(/,
  site: /_siteScope|_listSite|scopeOf\(|siteIds\(|hasSite\(|canEditSite\(|_userInspectionSites?\(|_userMeetingsSites?\(|_meetingsImportScope|scopeIds\(|writableUnits|_scopeOr403|rfiScope|[sS]iteCodeReadDenied|_readDenied|readableProject|readableTask|viewFor\(|_siteReadDenied|_userSiteGroups|_authorize(Report|Site|Action)Write|_sitelessWriteDenied|userSites\.|scopeSites|accessCtx|canReadProject|writeProject\(|siteScope|site_ids|writeCells\(|incubationSource\(|dashboardData\(|authorizedSiteId\(|\bproject\(req, res\)/,
  ownership: /_ownInspectionOr403|actorOf\(|visibleRun\(|loadVisible\(|seesCadence|visibleDecisions|listSubscriptions|unreadCount|created_by\s*[!=]==|owner\w*\s*[!=]==|user_id\s*[!=]==|\.id\s*[!=]==\s*(req\.reportUser|u|user)\.id|reportUser\.id\s*[!=]==|WHERE[^`]*user_id\s*=\s*\?|loadSession\(|unsubscribe\(req\.reportUser\.id|verifyRfi\(|checkCapability\(req\.reportUser/,
  switch: /\benabled\(|pubGate|pirEnabled|_enabled\b|lifecycle\(|gateParam|async function gate|\bgate\(req|\bon\(res\)/,
};
const PATH = require('path').join(__dirname, '..', '..', 'docs', 'ops', 'authz-handler-checks.json');

function _src(route) {
  let s = '';
  for (const l of route.layers) { if (l.name === 'requireReportSession') continue; try { s += Function.prototype.toString.call(l.handle) + '\n'; } catch (_) { /* native */ } }
  return s;
}

/**
 * Source of the path-wrapper middlewares that run before a route: route layers registered on a path ARRAY or regexp
 * (e.g. the central site-read guard of server.js, the meetings read-scope wrapper) whose path matches this route.
 */
function wrapperSource(app, route) {
  const { routerStack } = require('../../services/routerStack');
  const url = route.path.replace(/:([A-Za-z_]+)/g, (m, n) => (/id\b|Id$|uid|key|token/i.test(n) ? '1' : 'x'));
  let out = '', done = false;
  (function visit(stack) {
    for (const l of stack || []) {
      if (done) return;
      if (l.name === 'router' && l.handle && l.handle.stack) { visit(l.handle.stack); continue; }
      if (!l.route) continue;
      const p = l.route.path, m = route.method.toLowerCase();
      if (typeof p === 'string') { if (p === route.path && (l.route.methods[m] || l.route.methods._all)) done = true; continue; }
      if (!(l.route.methods[m] || l.route.methods._all)) continue;
      let hit = false; try { hit = !!l.match(url); } catch (_) { hit = false; }
      if (hit) for (const x of l.route.stack) { try { out += Function.prototype.toString.call(x.handle) + '\n'; } catch (_) { /* native */ } }
    }
  })(routerStack(app));
  return out;
}

/** Static signals of one route's handler chain (+ path wrappers) → sorted class list. */
function staticSignals(route, walker = require('./authz-walk'), app = null) {
  const src = _src(route) + (app ? wrapperSource(app, route) : '');
  const out = CLASSES.filter((c) => SIGNALS[c].test(src));
  if (route.method === 'GET' && walker.CENTRAL_SITE_READ.some((re) => re.test(route.path)) && !out.includes('site')) out.push('site');
  return out.sort((a, b) => CLASSES.indexOf(a) - CLASSES.indexOf(b));
}

/** Routes in scope: gate session, no role guard (first registration wins, like the matrix). */
function inScope(app, walker = require('./authz-walk')) {
  const m = walker.buildMatrix(app);
  const keys = new Set(m.routes.filter((r) => r.gate === 'session' && !r.guards.some((g) => g.roles)).map((r) => r.key));
  const seen = new Set(), out = [];
  for (const r of walker.walkRoutes(require('../../services/routerStack').routerStack(app))) {
    if (!keys.has(r.key) || seen.has(r.key)) continue;
    seen.add(r.key); out.push(r);
  }
  return out;
}

function load() { try { return JSON.parse(require('fs').readFileSync(PATH, 'utf8')); } catch (_) { return null; } }

function serialize(decl) {
  const keys = Object.keys(decl.routes).sort();
  const head = Object.assign({}, decl); delete head.routes;
  return JSON.stringify(head, null, 1).slice(0, -2) + ',\n "routes": {\n' + keys.map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(decl.routes[k])).join(',\n') + '\n }\n}\n';
}

function draft(app, prev) {
  const walker = require('./authz-walk');
  const routes = {};
  for (const r of inScope(app, walker)) {
    const sig = staticSignals(r, walker, app);
    const old = prev && prev.routes && prev.routes[r.key];
    if (old && old.reviewed) { routes[r.key] = old; continue; }
    routes[r.key] = { checks: sig, note: old && old.note ? old.note : (sig.length ? 'static signals: ' + sig.join(', ') : ''), reviewed: false };
  }
  return { schema: 'sdp360.authz-handler-checks/1',
    generated_by: 'node tools/agent/authz-handler-classify.js --write (then review every entry and set "reviewed": true)',
    classes: { role: 'role / tier / money-reader check inside the handler or a store it calls', site: 'site perimeter (incl. central site-read guard)', ownership: 'own object / own record / named member', switch: 'report_config switch decides (404 while off)', none: 'checks: [] — any signed-in non-business account may call it; note = one-line justification' },
    routes };
}

// Exported before the CLI block: authz-walk.js requires this module back (load()), so exports must exist first.
module.exports = { CLASSES, SIGNALS, PATH, staticSignals, wrapperSource, inScope, load, serialize, draft };

if (require.main === module) {
  const walker = require('./authz-walk');
  const d = draft(walker.bootApp(), load());
  if (process.argv.includes('--write')) { require('fs').writeFileSync(PATH, serialize(d)); process.stderr.write(`[authz-handler-classify] ${Object.keys(d.routes).length} routes → ${PATH}\n`); }
  else for (const [k, v] of Object.entries(d.routes)) process.stdout.write(`${k}\t${v.checks.join('+') || 'none'}\t${v.reviewed ? 'reviewed' : 'draft'}\n`);
  process.exit(0);
}

