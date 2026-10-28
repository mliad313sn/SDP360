'use strict';
const { fail } = require('../services/httpError');
// ─────────────────────────────────────────────────────────────────────────
// Health routes — extracted from server.js (fiche M12-a, 2026-10-20), same dependency-injection
// pattern as routes/inspection.js.
//
//   GET /ready              — UNAUTHENTICATED readiness probe (fiche C1 / M14). Mounted OUTSIDE the
//                             /api/ gate on purpose; returns ONLY {ok, db, last_job_at} — no business
//                             data, no token state, no identifiers.
//   GET /api/health/views   — Zoho view-schema check, session + admin tier (was key/query-token only).
//   GET /api/health/restore-drill — last `restore_drill` system_log row (E11), super_admin.
//   GET /api/health/version — package version + build SHA + Node + start time; any signed-in user
//                             (consolidation P0-E / backlog E0.3). Nothing sensitive: no host, path or config.
//
// Wiring in server.js:
//   app.use(require('./routes/health')({ express, checkZohoViewSchema, requireReportSession, getRdb }));
// ─────────────────────────────────────────────────────────────────────────
module.exports = function healthRoutes(deps) {
  const { express, checkZohoViewSchema, requireReportSession, getRdb, getBuild } = deps;
  const startedAt = new Date().toISOString();
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

router.get('/api/health/version', requireReportSession, (req, res) => {
  res.json({ version: require('../package.json').version, build: (getBuild && getBuild()) || null,
    node: process.version, started_at: startedAt });
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
    fail(res, e);
  }
});

// E11 — last restore drill (super_admin): the newest `restore_drill` row of system_log, so the
// admin card can show date + result without reading the dated report file.
// `listSystemLog` is a dual-backend dispatcher (Promise on PostgreSQL) → awaited.
router.get('/api/health/restore-drill', requireReportSession, async (req, res) => {
  const rdb = getRdb();
  if (!rdb.userHasRole(req.reportUser, 'super_admin')) return res.status(403).json({ error: 'super_admin only' });
  try {
    const { rows } = await rdb.listSystemLog({ category: 'ops', action: 'restore_drill' }, { limit: 1, offset: 0 });
    const r = rows && rows[0];
    if (!r) return res.json({ last: null });
    let details = null;
    try { details = typeof r.details === 'string' ? JSON.parse(r.details) : r.details; } catch (_) { details = null; }
    res.json({ last: { ts: r.ts, ok: details ? !!details.ok : !r.risk, date: r.target, details } });
  } catch (e) { fail(res, e); }
});

  return router;
};
