'use strict';
const { fail, typed } = require('../services/httpError');
// C-17 (G37/G42) — access self-service, read-only.
//   GET /api/access/me/why?cap=<capability id>   or   ?need=<role|role>
//     → { ok, allow, reason_code, needed, capability:{id,en,fr,risk,scope}|null }
//   Session required. Answers only about the CALLER (never another user). An unknown capability or
//   an uncatalogued role set answers reason_code 'unknown_capability' (deny), never a guess.
module.exports = function accessRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const authz = () => deps.authz || require('../services/authorizationService');
  const clean = (s, max) => String(s == null ? '' : s).replace(/[^\w.\-|]/g, '').slice(0, max);

  router.get('/api/access/me/why', requireReportSession, (req, res) => {
    try {
      const cap = clean(req.query.cap, 80) || null;
      const need = clean(req.query.need, 160).split('|').filter(Boolean);
      if (!cap && !need.length) return fail(res, typed('VALIDATION', 'cap or need is required'));
      res.json({ ok: true, ...authz().why(req.reportUser, { cap, need }) });
    } catch (e) { fail(res, e); }
  });
  return router;
};
