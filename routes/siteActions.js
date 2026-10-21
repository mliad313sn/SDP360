'use strict';
const { fail } = require('../services/httpError');
// Site Actions register hub — GET /api/reports/site-actions?site=CODE[&closed=1] (moved out of
// server.js, handler unchanged: composes the three action sources + open issues, folds Meridian links).
module.exports = function siteActionsRoutes(deps) {
  const { express, requireReportSession, siteCodeReadDenied, reportConfig } = deps;
  const router = express.Router();
  router.get('/api/reports/site-actions', requireReportSession, async (req, res) => {
  try {
    const { buildSiteActions } = require('../services/siteActionsRegister');
    const rdb = require('../reports-db');
    const meetingsDb = require('../meetings-db');
    const inspectionDb = require('../inspection-db');
    const code = String(req.query.site || '').trim();
    if (await siteCodeReadDenied(req.reportUser, code)) return res.status(403).json({ error: 'Access denied: another site' });
    const asOf = new Date().toISOString().slice(0, 10);
    if (!code || code === 'all') {
      return res.json({ site: code || null, week_label: null, ...buildSiteActions({ asOf }) });
    }
    // meetings + inspection share the 'meetings' namespace code (SMI/MGO/HGO…).
    const meetings = await meetingsDb.listActions({ site: code });
    const inspection = await inspectionDb.listActions({ site: code });
    // Report follow-ups = every open, non-merged follow-up across ALL the site's
    // reports, deduped by carry-forward lineage (SP1b-lignée) — so an open item
    // on an old report never carried forward still surfaces, once. Each row
    // carries its own report_id/week_label. resolved.site_id (NOT .id) — the
    // documented falsy-id pitfall.
    let report = null;
    const resolved = await rdb.getSiteIdByModuleCode('meetings', code);
    if (resolved && resolved.site_id) {
      report = { actions: (await rdb.getSiteOpenReportActions(resolved.site_id)).actions };
    }
    // Open issues of the site (resolved/cancelled are dropped by the engine) — the hub
    // shows who has no action yet and lets the user add one from the issue.
    const issues = await meetingsDb.listIssues({ site: code, limit: 1000 });
    const sa = buildSiteActions({ meetings, inspection, report, issues, asOf });
    // "Show closed / cancelled" (2026-10-16): the last 30 days, so a wrong click can be reopened.
    if (req.query.closed === '1') {
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const closedReport = (resolved && resolved.site_id) ? await rdb.getSiteClosedReportActions(resolved.site_id, since) : null;
      sa.recent_closed = require('../services/siteActionsRegister').buildRecentlyClosed(
        { meetings, inspection, issues, report: closedReport, since });
      sa.recent_since = since;
    }
    // Best-effort: fold Meridian project links onto matching rows for the "▸ Projet: X"
    // badge (F1). NEVER blocks the hub — a Meridian outage/misconfig leaves every
    // it.project null. getConfig is a Promise on pg → await it.
    let links = {}, baseUrl = '';
    try {
      const cfg = await reportConfig.getConfig(rdb.db);
      baseUrl = cfg.meridian_base_url || '';
      links = await require('../services/meridianLinks').getLinksForSite(code, { config: cfg });
    } catch (_) { links = {}; }
    require('../services/meridianActions').attachProjectLinks(sa, links, baseUrl);
    // 2027 Goal 02 — commitment status + "awaiting verification" badge on linked rows (flag
    // commitments_enabled). Best-effort, never blocks the hub; flag off → no field added.
    try {
      const cfg = await reportConfig.getConfig(rdb.db);
      const store = String(cfg.commitments_enabled) === '1' && deps.getCommitmentStore && deps.getCommitmentStore();
      if (store) require('../services/commitmentBackfill').attachCommitments(sa, await store.linksFor(require('../services/commitmentBackfill').hubPairs(sa)));
    } catch (_) { /* hub renders without the badge */ }
    res.json({ site: code, ...sa });
  } catch (e) { fail(res, e); }
});
  return router;
};
