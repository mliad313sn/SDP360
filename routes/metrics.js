'use strict';
// Step 3 (SDP-DASH-2.0) — KPI dictionary + per-KPI API + site registry.
//   GET /api/metrics/registry                         every KPI with its definition (any session)
//   GET /api/metrics/freshness                        age of each domain's data (any session)          [step 6]
//   GET /api/metrics/:key?site=&month=                one KPI for one site (site-scoped like every site read)
//   GET /api/metrics/:key?scope=group&month=          one KPI for the whole fleet (group readers only)  [step 6]
//   GET /api/metrics/:key/series?site=|scope=group&grain=week|month&points=13&asOf=                     [step 6]
//   GET /api/registry/sites                           the site registry, every vocabulary side by side (admin)
// Distinct prefixes: nothing here can be shadowed by /api/reports/:id or the /api/sites guard.
const registry = require('../services/metrics/registry');
const { computeMetric, computeGroupMetric, computeSeries, resolveWindow, GROUP_RULE } = require('../services/metrics/dispatch');
const { freshness, domainOf } = require('../services/metrics/freshness');
const { buildSiteRegistry, MODULE_ORDER } = require('../services/siteRegistry');

// Group figures expose every site: the admin tier, the read-only direction role and the group business role.
function canReadGroup(rdb, user) {
  return !!user && ['admin', 'scorecard-viewer', 'group-business'].some(r => rdb.userHasRole(user, r));
}

module.exports = function metricsRoutes(d) {
  const { express, requireReportSession, requireAdmin, siteCodeReadDenied } = d;
  const router = express.Router();
  const rdb = () => d.rdb || require('../reports-db');

  // Ten-minute cache of computed figures (group + series loop over every site and window). Off when the
  // readers are injected (tests) so a test always sees what it seeded.
  const TTL = Number(process.env.METRICS_CACHE_TTL_MS || 600000);
  const cache = new Map();
  async function cached(key, fn) {
    if (d.metricDeps || !TTL) return fn();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    const value = await fn();
    if (value && value.status === 200) cache.set(key, { at: Date.now(), value });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return value;
  }

  function deps() {
    if (d.metricDeps) return d.metricDeps;
    const r = rdb(); let sitesP = null;
    const siteRows = () => (sitesP = sitesP || Promise.resolve(r.listSites()));
    return {
      getCalendarMonthlyHelpdesk: r.getCalendarMonthlyHelpdesk,
      getSiteHelpdeskWindow: r.getSiteHelpdeskWindow,
      getSiteChangesWindow: r.getSiteChangesWindow,
      getSurveyKpisDB: r.getSurveyKpisDB,
      getWanSnapshots: r.getWanSnapshots,
      getSiteGroups: async (siteId) => {
        const s = ((await siteRows()) || []).find(x => x.id === siteId);
        return String((s && s.zoho_group) || '').split(',').map(g => g.trim()).filter(Boolean);
      },
      getSiteMonthlyMeetingSummary: require('../meetings-db').getSiteMonthlyMeetingSummary,
      meetingsInsights: require('../meetings-db').insights,
      getInspectionAggregate: require('../inspection-db').aggregate,
      getEffortLeaderboard: require('../assets-db').getEffortLeaderboard,
      effortForSite: require('../services/assetEffortForSite').effortForSite,
    };
  }

  // Every ACTIVE site, with its meetings code when it has one (helpdesk / changes / WAN count every site).
  async function groupSites() {
    const r = rdb();
    const [sites, codes] = [await r.listSites(), await r.listSiteModuleCodes('meetings')];
    const code = new Map((codes || []).map(c => [c.site_id, c.code]));
    return (sites || []).filter(s => s.active !== 0 && s.active !== false).map(s => ({ site_id: s.id, code: code.get(s.id) || null, name: s.name }));
  }

  async function targets() {
    try {
      const cfg = await require('../services/reportConfig').getConfig(rdb().db);
      const t = JSON.parse(cfg.opm_targets || '{}');
      return { wan: Number.isFinite(Number(t.wan)) ? Number(t.wan) : 98 };
    } catch (_) { return { wan: 98 }; }
  }

  // Resolves ?site= / ?scope=group into a scope, or answers the error itself (returns null).
  async function scopeOf(req, res) {
    if (String(req.query.scope || '') === 'group') {
      if (!canReadGroup(rdb(), req.reportUser)) { res.status(403).json({ error: 'Group figures are reserved to the direction and the admin tier' }); return null; }
      return { scope: 'group', sites: await groupSites() };
    }
    const code = String(req.query.site || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,16}$/.test(code)) { res.status(400).json({ error: 'site must be a site code (meetings namespace), or scope=group' }); return null; }
    if (await siteCodeReadDenied(req.reportUser, code)) { res.status(403).json({ error: 'Access denied: another site' }); return null; }
    const hit = await rdb().getSiteIdByModuleCode('meetings', code);
    if (!hit) { res.status(404).json({ error: 'unknown site code' }); return null; }
    return { scope: 'site', site: { code, site_id: hit.site_id } };
  }

  router.get('/api/metrics/registry', requireReportSession, (req, res) => {
    const metrics = registry.list().map(m => ({ ...m, group_rule: m.serve ? (GROUP_RULE[m.serve] || null) : null, freshness_domain: domainOf(m) }));
    res.json({ count: registry.METRICS.length, metrics });
  });

  router.get('/api/metrics/freshness', requireReportSession, async (req, res) => {
    try {
      const states = d.syncStates ? await d.syncStates() : await require('../services/sync/store').listStates();
      res.json({ as_of: new Date().toISOString(), domains: freshness(states) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/metrics/:key/series', requireReportSession, async (req, res) => {
    try {
      const key = String(req.params.key);
      if (!registry.get(key)) return res.status(404).json({ error: 'unknown metric' });
      const grain = String(req.query.grain || 'week');
      if (!['week', 'month'].includes(grain)) return res.status(400).json({ error: 'grain must be week or month' });
      const points = req.query.points == null ? 13 : Number(req.query.points);
      if (!Number.isInteger(points) || points < 1 || points > 26) return res.status(400).json({ error: 'points must be 1 to 26' });
      const asOf = String(req.query.asOf || new Date().toISOString().slice(0, 10));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return res.status(400).json({ error: 'asOf must be YYYY-MM-DD' });
      const sc = await scopeOf(req, res); if (!sc) return;
      const ck = ['series', key, sc.scope, sc.site ? sc.site.code : '', grain, points, asOf].join('|');
      const out = await cached(ck, async () => computeSeries(key, { ...sc, grain, points, asOf, targets: await targets() }, deps()));
      const { status, ...body } = out;
      res.status(status).json(body);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/metrics/:key', requireReportSession, async (req, res) => {
    try {
      const key = String(req.params.key);
      if (!registry.get(key)) return res.status(404).json({ error: 'unknown metric' });
      const window = resolveWindow(req.query);
      if (window.error) return res.status(400).json({ error: window.error });
      const sc = await scopeOf(req, res); if (!sc) return;
      const ck = ['one', key, sc.scope, sc.site ? sc.site.code : '', window.from, window.to].join('|');
      const out = await cached(ck, async () => {
        const ctx = { ...sc, window, targets: await targets() };
        return sc.scope === 'group' ? computeGroupMetric(key, ctx, deps()) : computeMetric(key, ctx, deps());
      });
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

module.exports.canReadGroup = canReadGroup;
