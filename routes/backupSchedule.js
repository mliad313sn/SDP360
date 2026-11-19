'use strict';
// ─────────────────────────────────────────────────────────────────────────
// Scheduled backups routes (/api/admin/backup-schedule, /api/admin/backup-now) — extracted from server.js
// (P06). Same paths, chains and answers; the inline super_admin check is now the named guard
// services/namedGuards.requireSuperAdminInline (same test, same 403 body), visible to the authz walker.
// ─────────────────────────────────────────────────────────────────────────
const { fail } = require('../services/httpError');
const backupSchedule = require('../services/backupSchedule');
const { requireSuperAdminInline } = require('../services/namedGuards');

module.exports = function backupScheduleRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  // ── Scheduled backups (admin card) — bridges to Manage-SDP.ps1 / schtasks ───
  // super_admin only. The app only CONFIGURES the Task Scheduler jobs; they run
  // even when the app is down (the whole point of the Task Scheduler choice).
  router.get('/api/admin/backup-schedule', requireReportSession, async (req, res) => {
    if (!requireSuperAdminInline(req, res)) return;
    try {
      const [status, restorePoints] = await Promise.all([
        backupSchedule.getStatus(),
        backupSchedule.listRestorePoints(),
      ]);
      res.json({ status, restorePoints: restorePoints.slice(0, 20) });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/admin/backup-schedule', requireReportSession, express.json(), async (req, res) => {
    if (!requireSuperAdminInline(req, res)) return;
    try {
      const r = await backupSchedule.setSchedule(req.body || {});
      console.log(`[backup-schedule] updated by ${req.reportUser.username}:`, JSON.stringify(req.body));
      res.json(r);
    } catch (e) { fail(res, e, 400); }
  });
  router.post('/api/admin/backup-now', requireReportSession, express.json(), async (req, res) => {
    if (!requireSuperAdminInline(req, res)) return;
    try {
      const r = await backupSchedule.backupNow({ dbOnly: !!(req.body && req.body.dbOnly) });
      console.log(`[backup-schedule] manual backup by ${req.reportUser.username} (dbOnly=${!!(req.body && req.body.dbOnly)})`);
      res.json(r);
    } catch (e) { fail(res, e); }
  });

  return router;
};
