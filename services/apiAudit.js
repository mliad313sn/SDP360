'use strict';
// Step 4 (SDP-DASH-2.0) — extended audit journal. Every WRITE call to the API (POST/PUT/PATCH/
// DELETE) and every REFUSED call (403, any method) is recorded in system_log (category `api`),
// with who, which route, the target path and the HTTP status. Kept 12 months (job
// audit.retention). Logging is fire-and-forget and happens after the response: it can never slow
// down or break a request. The request body is NOT recorded (it may carry secrets or personal data).

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Already journaled with richer detail by their own handlers.
const SKIP = [/^\/api\/reports\/auth\/(login|logout)$/, /^\/api\/auth\/sso\//];

function routePattern(req) {
  if (req.route && req.route.path) return String(req.baseUrl || '') + String(req.route.path);
  return String(req.originalUrl || req.url || '').split('?')[0];
}

/** Pure: should this finished request be journaled, and how? */
function classify({ method, path, status }) {
  if (SKIP.some(re => re.test(path))) return null;
  if (status === 403) return { action: 'api_denied', risk: 1 };
  if (WRITE.has(method)) return { action: 'api_write', risk: 0 };
  return null;
}

function middleware(logEvent) {
  return (req, res, next) => {
    res.on('finish', () => {
      try {
        const path = String(req.originalUrl || req.url || '').split('?')[0];
        const c = classify({ method: req.method, path, status: res.statusCode });
        if (!c) return;
        const u = req.reportUser || {};
        logEvent({
          category: 'api', action: c.action, risk: c.risk,
          actor: u.username || (req.headers && req.headers['x-dash-key'] ? 'dash-key' : 'anonymous'),
          actor_id: u.id != null ? u.id : null,
          target: path.slice(0, 300), ip: req.ip || null,
          details: { method: req.method, route: routePattern(req), status: res.statusCode },
        });
      } catch (_) { /* never let the journal disturb a response */ }
    });
    next();
  };
}

module.exports = { middleware, classify, routePattern };
