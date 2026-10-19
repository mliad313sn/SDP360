'use strict';
// Step 3 (SDP-DASH-2.0) — KPI dictionary + per-KPI API + site registry.
//   GET /api/metrics/registry            every KPI with its definition (any session)
//   GET /api/metrics/:key?site=&month=   one KPI for one site (site-scoped like every site read)
//   GET /api/registry/sites              the site registry, every vocabulary side by side (admin)
// Distinct prefixes: nothing here can be shadowed by /api/reports/:id or the /api/sites guard.
const registry = require('../services/metrics/registry');
const { computeMetric, resolveWindow } = require('../services/metrics/dispatch');
const { buildSiteRegistry, MODULE_ORDER } = require('../services/siteRegistry');

module.exports = function metricsRoutes(d) {
  const { express, requireReportSession, requireAdmin, siteCodeReadDenied } = d;
  const router = express.Router();
  const rdb = () => d.rdb || require('../reports-db');

  router.get('/api/metrics/registry', requireReportSession, (req, res) => {
    res.json({ count: registry.METRICS.length, metrics: registry.list() });
  });

  router.get('/api/metrics/:key', requireReportSession, async (req, res) => {
    try {
      const key = String(req.params.key);
      if (!registry.get(key)) return res.status(404).json({ error: 'unknown metric' });
      const code = String(req.query.site || '').trim().toUpperCase();
      if (!/^[A-Z0-9_-]{2,16}$/.test(code)) return res.status(400).json({ error: 'site must be a site code (meetings namespace)' });
      if (await siteCodeReadDenied(req.reportUser, code)) return res.status(403).json({ error: 'Access denied: another site' });
      const hit = await rdb().getSiteIdByModuleCode('meetings', code);
      if (!hit) return res.status(404).json({ error: 'unknown site code' });
      const window = resolveWindow(req.query);
      if (window.error) return res.status(400).json({ error: window.error });
      const deps = d.metricDeps || {
        getCalendarMonthlyHelpdesk: rdb().getCalendarMonthlyHelpdesk,
        getSiteHelpdeskWindow: rdb().getSiteHelpdeskWindow,
        getSiteChangesWindow: rdb().getSiteChangesWindow,
        getSiteMonthlyMeetingSummary: require('../meetings-db').getSiteMonthlyMeetingSummary,
        getInspectionAggregate: require('../inspection-db').aggregate,
        getEffortLeaderboard: require('../assets-db').getEffortLeaderboard,
        effortForSite: require('../services/assetEffortForSite').effortForSite,
      };
      const out = await computeMetric(key, { site: { code, site_id: hit.site_id }, window }, deps);
      const { status, ...body } = out;
      res.status(status).json(body);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/registry/sites', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const r = rdb();
      const sites = await r.listSites();
      const moduleCodes = {};
      for (const m of MODULE_ORDER) {
        try { moduleCodes[m] = await r.listSiteModuleCodes(m); } catch (_) { moduleCodes[m] = []; }
      }
      let assetLabels = [];
      try { const lk = await require('../assets-db').getAssetLookups(); assetLabels = (lk && lk.sites) || []; } catch (_) {}
      let rrAliases = {};
      try { rrAliases = await require('../risk-register-export').getSiteAliases(r.db); } catch (_) {}
      const tracker = require('../tracker-db'), insp = require('../inspection-db');
      res.json(buildSiteRegistry({
        sites, moduleCodes, assetLabels, rrAliases,
        trackerResolve: s => tracker.siteToCode(s),
        inspectionResolve: n => insp.siteNameToCode(n),
        assetLabelToCode: require('../services/scoreboardAliases').assetLabelToCode,
      }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
