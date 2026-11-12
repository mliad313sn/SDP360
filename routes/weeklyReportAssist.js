'use strict';
// P4 / B9 — weekly report assistance (extracted from server.js; same DI pattern as routes/inspection.js).
//
//   GET /api/reports/:id/infra-auto       prefill descriptors for the report's site + Zoho week (V1b-C).
//                                         Best-effort: no snapshot → { fills: [] }, never 500. Mounted AFTER the
//                                         central report read guard (server.js), and re-checks the site perimeter
//                                         itself: admin tier anywhere, otherwise one of the account's sites.
//   GET /api/value-metrics/weekly-report  time-to-complete (median, per site), % on-time, % KPI auto-prefilled,
//                                         minutes saved (null until the stopwatch baseline is entered). Admin tier =
//                                         every site; anyone else = only their own sites; a site-less account = none.
//
//   verifyInfraProvenance(rdb, reportConfig, reportId, kpis)  used by PUT /api/reports/:id/infra: a claimed
//                                         Meraki/OpManager provenance is kept only when the value equals the snapshot.
const { fail } = require('../services/httpError');
const userSites = require('../services/userSites');

async function verifyInfraProvenance(rdb, reportConfig, reportId, kpis) {
  const P = require('../public/lib/infraPrefill');
  const claims = (kpis || []).some((k) => k && (k.value_source === 'meraki' || k.value_source === 'opmanager'));
  let auto = { fills: [], tokens: [] };
  if (claims) {
    try {
      const report = await rdb.getReport(Number(reportId));
      if (report) auto = await require('../services/infraAutoFill').computeInfraAuto(rdb, report, await reportConfig.getConfig(rdb.db));
    } catch (_) { auto = { fills: [], tokens: [] }; }   // snapshots unreadable → every claim becomes 'manual'
  }
  return P.verifySources(kpis, auto.fills, auto.tokens);
}

const _dateOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

module.exports = function weeklyReportAssist(deps) {
  const { express, requireReportSession, rdb, reportConfig } = deps;
  const logError = deps.logError || (() => null);
  const router = express.Router();
  const isAdmin = (u) => { try { return !!rdb.userHasRole(u, 'admin'); } catch (_) { return false; } };

  router.get('/api/reports/:id/infra-auto', requireReportSession, async (req, res) => {
    try {
      const report = await rdb.getReport(parseInt(req.params.id, 10));
      if (!report) return res.status(404).json({ error: 'Report not found', fills: [] });
      if (!isAdmin(req.reportUser) && !userSites.hasSite(req.reportUser, report.site_id)) return res.status(403).json({ error: 'Access denied', fills: [] });
      const cfg = await reportConfig.getConfig(rdb.db);
      res.json(await require('../services/infraAutoFill').computeInfraAuto(rdb, report, cfg));
    } catch (e) { res.json({ fills: [], reason: 'internal_error', correlation_id: logError(e, req) }); }
  });

  router.get('/api/value-metrics/weekly-report', requireReportSession, async (req, res) => {
    try {
      const to = _dateOk(req.query.to) ? String(req.query.to) : new Date().toISOString().slice(0, 10);
      const from = _dateOk(req.query.from) ? String(req.query.from) : new Date(Date.parse(to) - 90 * 864e5).toISOString().slice(0, 10);
      const siteIds = isAdmin(req.reportUser) ? null : userSites.siteIds(req.reportUser);
      const V = require('../services/weeklyReportValue');
      const cfg = await reportConfig.getConfig(rdb.db);
      const { timingRows, prefillRows } = await V.loadWeeklyValue(rdb.pgHandle(), { from, to, siteIds });
      res.json({ ok: true, window: { from, to }, scope: siteIds == null ? 'all sites' : `${siteIds.length} site(s)`,
        timing: V.composeTiming(timingRows, { dueDays: cfg.weekly_report_due_days }),
        prefill: V.composePrefill(prefillRows, { minutesPerCell: cfg.weekly_report_minutes_per_kpi_cell }) });
    } catch (e) { fail(res, e, 500, { ok: false }); }
  });

  return router;
};
module.exports.verifyInfraProvenance = verifyInfraProvenance;
