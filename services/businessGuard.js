'use strict';
// Consolidation P0 security (2026-10-28) — server-side boundary for business-only accounts,
// transplanted from the 1.11 line (F-M06-001) and adapted to SDP360 2.0.
// A session whose ONLY roles are site-business / group-business (public/lib/businessRoles.js)
// may call the Site Awareness API (which scopes site vs group itself) and its own session
// endpoints. Every other /api route answers 403. Before this, 2.0 restricted these accounts in
// the browser only (auth.js redirect + _shell.js nav): a site-business session got 2xx from 104
// API routes. Accounts holding any other role are not business-only and are unaffected.
const { isBusinessOnly } = require('../public/lib/businessRoles');

// 2.0 sends business-only users to site-awareness.html only; it calls nothing else.
const ALLOWED = [/^\/site-awareness(\/|$)/, /^\/reports\/auth\//, /^\/auth\//, /^\/ping$/, /^\/health\/version$/];   // version info: not sensitive
function isAllowed(path) { return ALLOWED.some((re) => re.test(path)); }

function _cookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

/** Express middleware for app.use('/api/', …). deps: { getRdb() → reports-db module or null }. */
function middleware({ getRdb }) {
  return async (req, res, next) => {
    if (isAllowed(req.path)) return next();
    // UAT 2026-10-29 (F-01): check EVERY token the request carries. The session that the routes use is the
    // cookie first (services/sessionAuth.sessionToken); checking the header first let a business-only
    // session through with a bogus `x-report-token` next to its real cookie.
    const tokens = [...new Set([_cookie(req, 'report_token'), req.headers['x-report-token']].filter(Boolean))];
    const rdb = getRdb();
    if (!tokens.length || !rdb) return next();
    for (const token of tokens) {
      let user = null;
      try { user = await rdb.validateSession(token); } catch (e) { user = null; }
      if (user && isBusinessOnly(user.roles || [])) {
        return res.status(403).json({ error: 'Your account gives access to the site view only.' });
      }
    }
    next();
  };
}

module.exports = { middleware, isAllowed, ALLOWED };
