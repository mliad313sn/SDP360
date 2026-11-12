'use strict';
// UAT-OI-05 (G3-UX) — switch portfolio_executive_readonly ('0' = today).
// Today the executive tier inherits the admin tier (role hierarchy super_admin > executive > admin), so a director can
// create a programme, move a project stage, verify a benefit or approve a change request (UAT seat S5-07: 200).
// '1' → an account whose ONLY write tier is `executive` (no `super_admin`, no `admin`, no `committee-member` = PMO)
// still READS everything it reads today but every write to portfolio / project / benefit / change-request objects
// answers 403 with a readable reason. Admin, super_admin and PMO (committee-member) are unchanged; nothing is granted.
//
// Mounted as ONE router-level middleware on the governance router (routes/governance.js), in front of every
// /api/governance/portfolio/* and /api/governance/ppm/* write (the change requests live under ppm/project/:id/changes),
// plus the RFI → project conversion and the roadmap publication (both create portfolio objects). The session is
// resolved here only when the switch is on and the request is such a write; an unauthenticated request is left to
// the route's own requireReportSession (401), so this middleware never changes who is authenticated.
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PATHS = [
  /^\/api\/governance\/portfolio(\/|$)/,
  /^\/api\/governance\/ppm(\/|$)/,
  /^\/api\/governance\/rfi\/[^/]+\/to-project$/,
  /^\/api\/governance\/roadmap-migration(\/|$)/,
];
const REASON = 'Read-only for the executive tier: portfolio, project, benefit and change-request changes are made by the PMO (committee-member) or an admin (portfolio_executive_readonly = 1).';

const roleList = (u) => (u && Array.isArray(u.roles) ? u.roles : []);

/** true when the account's only write tier is `executive` (pure). */
function isExecutiveOnly(user) {
  const r = roleList(user);
  return r.includes('executive') && !r.includes('super_admin') && !r.includes('admin') && !r.includes('committee-member');
}
function isPortfolioWrite(method, path) {
  return WRITE.has(String(method || '').toUpperCase()) && PATHS.some((re) => re.test(String(path || '')));
}
function enabled(cfg) { return String((cfg || {}).portfolio_executive_readonly) === '1'; }

/**
 * Express middleware factory. deps: { getConfig: async () => cfg, resolveUser: async (req) => user|null, fail }.
 */
function middleware({ getConfig, resolveUser, fail }) {
  return async function portfolioExecutiveReadonly(req, res, next) {
    try {
      if (!isPortfolioWrite(req.method, req.originalUrl ? req.originalUrl.split('?')[0] : req.path)) return next();
      if (!enabled(await getConfig())) return next();
      const u = req.reportUser || await resolveUser(req);
      if (!u || !isExecutiveOnly(u)) return next();
      return fail(res, Object.assign(new Error(REASON), { code: 'FORBIDDEN', reason: 'executive_read_only' }), 403);
    } catch (_) {
      return next();   // a config/session read failure leaves today's behaviour (the route's own guards still apply)
    }
  };
}

module.exports = { isExecutiveOnly, isPortfolioWrite, enabled, middleware, REASON, PATHS };
