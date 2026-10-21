'use strict';
// ─────────────────────────────────────────────────────────────────────────
// Health routes — extracted from server.js (fiche M12-a, 2026-10-20), same dependency-injection
// pattern as routes/inspection.js.
//
//   GET /ready              — UNAUTHENTICATED readiness probe (fiche C1 / M14). Mounted OUTSIDE the
//                             /api/ gate on purpose; returns ONLY {ok, db, last_job_at} — no business
//                             data, no token state, no identifiers.
//   GET /api/health/views   — Zoho view-schema check, session + admin tier (was key/query-token only).
//
// Wiring in server.js:
//   app.use(require('./routes/health')({ express, checkZohoViewSchema, requireReportSession, getRdb }));
// ─────────────────────────────────────────────────────────────────────────
module.exports = function healthRoutes(deps) {
  const { express, checkZohoViewSchema, requireReportSession, getRdb } = deps;
  const router = express.Router();

// Readiness: can we reach the database? When was the last sync job marked successful?
// `getSyncStatus` is a dual-backend dispatcher (Promise on PostgreSQL) → awaited.
router.get('/ready', async (req, res) => {
  let db = false, last_job_at = null;
  try {
    const rdb = getRdb && getRdb();
    if (rdb) {
      const rows = await rdb.getSyncStatus();
      db = true;
      for (const r of rows || []) {
        const t = r && r.last_sync_at;
        if (t && (!last_job_at || String(t) > String(last_job_at))) last_job_at = t;
      }
    }
  } catch (e) { db = false; }
  res.status(db ? 200 : 503).json({ ok: db, db, last_job_at });
});

// Expose as an admin-only endpoint for manual health checks (session required — the admin tier
// is checked through rdb.userHasRole, never user.role === 'admin').
router.get('/api/health/views', requireReportSession, async (req, res) => {
  const rdb = getRdb();
  if (!rdb.userHasRole(req.reportUser, 'admin')) {
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
