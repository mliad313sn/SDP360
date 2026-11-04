'use strict';
// A-28a — POST /api/security/csp-report: where browsers send Content-Security-Policy-Report-Only
// violations. UNAUTHENTICATED by nature (a browser posts it with no credentials), so it is mounted only
// when SDP_CSP_REPORT_ONLY=1, BEFORE the /api gate and the global JSON parser, and it:
//   · accepts application/csp-report and application/reports+json only (else 415), 16 KB max (else 413);
//   · rate-limits per IP (in memory, default 60 / minute → 429);
//   · writes one system_log row (category security, action csp_violation) per
//     (directive, blocked origin, document path) and day, capped per day — the noise of every inline
//     handler is the inventory for the later enforcement goal, it must not flood the log;
//   · never echoes input: always an empty 204.
// Wiring in server.js: if (_cspReportOnly) app.use(require('./routes/securityCsp')({ express, getRdb }));
const { TYPES, normalise } = require('../services/cspReport');
const { makeOncePerDay } = require('../services/viewLog');

module.exports = function securityCspRoutes({ express, getRdb, max = 60, windowMs = 60 * 1000, dailyCap = 2000 }) {
  const router = express.Router();
  const parse = express.json({ type: TYPES, limit: '16kb' });
  const hits = new Map();
  const seen = makeOncePerDay();

  const limiter = (req, res, next) => {
    const ip = req.ip || 'unknown', now = Date.now();
    const e = hits.get(ip);
    if (!e || now - e.start > windowMs) {
      if (hits.size >= 10000) hits.clear();             // bounded memory under a spray of source addresses
      hits.set(ip, { start: now, count: 1 }); return next();
    }
    if (++e.count > max) { res.setHeader('Retry-After', Math.ceil(windowMs / 1000)); return res.status(429).end(); }
    next();
  };

  router.post('/api/security/csp-report', limiter, (req, res) => {
    const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!TYPES.includes(ct)) return res.status(415).end();
    parse(req, res, (err) => {
      if (err) return res.status(err.type === 'entity.too.large' || err.status === 413 ? 413 : 400).end();
      try {
        const day = new Date().toISOString().slice(0, 10);
        const rdb = getRdb && getRdb();
        for (const v of normalise(req.body)) {
          if (seen.size() >= dailyCap) break;
          if (!seen(`${v.directive}|${v.blocked}|${v.document}`, day)) continue;
          if (rdb && rdb.logEvent) {
            rdb.logEvent({ category: 'security', action: 'csp_violation', actor: 'browser', target: `${v.directive} ${v.document}`,
              ip: req.ip, risk: 0, details: v });
          }
        }
      } catch (_) { /* a report never breaks anything */ }
      res.status(204).end();
    });
  });
  return router;
};
