'use strict';
// SDP360 — sync observability routes (Phase 1 Foundation & Sync).
//   GET /api/sync/runs?job=&limit=   last runs of the generic runner (session-guarded)
//   GET /api/sync/health             per-job last ok / last error / error count
// DI factory like routes/teamsSla.js: server.js passes { express, requireReportSession }.
// The legacy GET /api/sync/status (sync_metadata) stays as is; this is the run-level view.
module.exports = function syncRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const sync = deps.sync || require('../services/sync');

  router.get('/api/sync/runs', requireReportSession, async (req, res) => {
    try {
      await sync.ensureReady();
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
      const job = req.query.job ? String(req.query.job).slice(0, 64) : null;
      const rows = await sync.getStore().recentRuns(job, limit);
      res.json({ ok: true, runs: rows.map((r) => ({ ...r, meta: safeJson(r.meta) })) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.get('/api/sync/health', requireReportSession, async (req, res) => {
    try {
      await sync.ensureReady();
      const rows = await sync.getStore().health();
      const now = Date.now();
      res.json({ ok: true, jobs: rows.map((r) => ({
        ...r,
        errors: Number(r.errors) || 0,
        stale_hours: r.last_ok ? Math.round((now - Date.parse(r.last_ok)) / 36e5) : null,
      })) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  function safeJson(s) { if (s == null) return null; try { return JSON.parse(s); } catch (_) { return s; } }
  return router;
};
