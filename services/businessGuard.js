'use strict';
// M06 / PO decision DEC-02 (2026-10-28) — server-side boundary for business-only accounts.
// A session whose ONLY roles are site-business / group-business (public/lib/businessRoles.js)
// may call the Site Awareness view, the composed dashboards (each definition carries its own
// audience + site scope), the KPI readers behind them, and its own session endpoints. Every
// other /api route answers 403. Before this the restriction lived in the browser only
// (auth.js / _shell.js) and such a session reached ~110 API routes directly.
// Any account that also holds a hierarchy or other feature role is NOT business-only.
const { isBusinessOnly } = require('../public/lib/businessRoles');

const ALLOWED = [/^\/site-awareness(\/|$)/, /^\/dashboards(\/|$)/, /^\/metrics(\/|$)/,
  /^\/reports\/auth\//, /^\/auth\//, /^\/ping$/];

// Same /api/metrics/ prefix, but fleet-wide raw Zoho readers (routes/zohoData.js), not the KPI
// dictionary readers (routes/metrics.js) — refused.
const DENIED = /^\/metrics\/(change|cab|survey|requests|request-filter-options)(\/|$)/;

function isAllowed(path) { return !DENIED.test(path) && ALLOWED.some((re) => re.test(path)); }

/** Express middleware for app.use('/api/', …). deps: { getUser(req) → Promise<user|null> }. */
function middleware({ getUser }) {
  return async (req, res, next) => {
    if (isAllowed(req.path)) return next();
    let user = null;
    try { user = await getUser(req); } catch (e) { user = null; }
    if (user && isBusinessOnly(user.roles || [])) {
      return res.status(403).json({ error: 'Your account gives access to the site view only.' });
    }
    next();
  };
}

module.exports = { middleware, isAllowed, ALLOWED, DENIED };
