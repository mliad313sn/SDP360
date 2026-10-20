'use strict';
// ─────────────────────────────────────────────────────────────────────────
// Health routes (/api/health/views) — extracted from server.js (fiche M12-a, 2026-10-20), same
// dependency-injection pattern as routes/inspection.js. Handlers are byte-for-byte
// the inline ones; only `app.` → `router.` and `require('./x')` → `require('../x')`.
//
// Wiring in server.js:
//   app.use(require('./routes/health')({ express, checkZohoViewSchema }));
// ─────────────────────────────────────────────────────────────────────────
module.exports = function healthRoutes(deps) {
  const { express, checkZohoViewSchema } = deps;
  const router = express.Router();

// Expose as an admin-only endpoint for manual health checks
router.get('/api/health/views', async (req, res) => {
  // Require a valid session with admin or super_admin role
  const token = req.headers['x-report-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const { validateSession } = require('../reports-db');
  const user = await validateSession(token);
  if (!user || !['admin','super_admin'].includes(user.role)) {
    return res.status(403).json({ error: 'Admin role required' });
  }
  try {
    const results = await checkZohoViewSchema();
    const allOk = results.every(r => r.ok);
    res.json({ ok: allOk, checkedAt: new Date().toISOString(), results });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

  return router;
};
