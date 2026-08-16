'use strict';
// V1a — OPManager infrastructure availability READ API. Serves the snapshots the sync
// composed from the prepared Analytics view; OPS never polls devices. DI factory like
// routes/meridian.js: server.js passes { express, requireReportSession, requireAdmin,
// fetchView }. Every getSiteIdByModuleCode/getInfraSnapshots/getConfig/listSites call is
// AWAITED — all return Promises on postgres (prod). Absence is rendered as
// {metric_value:null, status_color:'none'}, NEVER 0. Staleness is derived from
// data_through vs opm_stale_days; opm_targets drives status_color, not staleness.
module.exports = function opmanagerRoutes(deps) {
  const { express, requireReportSession, requireAdmin } = deps;
  const requireSuperAdmin = deps.requireSuperAdmin || requireAdmin;   // fallback if not injected
  const router = express.Router();
  const rdb = require('../reports-db');
  const reportConfig = require('../services/reportConfig');
  const { classifyKpiFamily } = require('../services/opmClassify');

  const FAMILIES = ['lan', 'wifi', 'wan', 'servers'];

  function _safeParse(s, d) { try { return JSON.parse(s); } catch { return d; } }
  function _numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  function _isStale(ref, staleDays, nowMs) {
    if (!ref) return false;
    const t = Date.parse(String(ref).slice(0, 10));
    if (Number.isNaN(t)) return false;
    return Math.floor((nowMs - t) / 86400000) > staleDays;
  }

  // Tolerant: probe name (opmanager, the complete namespace) → meetings code
  // (HGO/MGO/… convenience) → site name. Works for sites with no meetings code
  // (Tanda/Abidjan are addressed by their probe name). Returns {site_id, name} or null.
  async function resolveSiteParam(code) {
    if (!code) return null;
    let r = await rdb.getSiteIdByModuleCode('opmanager', code);
    if (r && r.site_id) return { site_id: r.site_id, name: r.name };
    r = await rdb.getSiteIdByModuleCode('meetings', code);
    if (r && r.site_id) return { site_id: r.site_id, name: r.name };
    const sites = (await rdb.listSites({ includeInactive: true })) || [];
    const lc = code.trim().toLowerCase();
    const s = sites.find(x => String(x.name || '').trim().toLowerCase() === lc);
    return s ? { site_id: s.id, name: s.name } : null;
  }

  // Fill the 4 families from the snapshot rows: present → mapped row; absent → null/none.
  function fillFamilies(snaps, targets, staleDays, nowMs) {
    const byFam = {};
    for (const r of (snaps || [])) if (r.metric_name === 'availability') byFam[r.kpi_family] = r;
    return FAMILIES.map(fam => {
      const r = byFam[fam];
      if (!r) return {
        kpi_family: fam, metric_value: null, target: _numOrNull(targets[fam]),
        status_color: 'none', trend: null, stale: false, source: 'analytics_opmanager',
      };
      const ref = r.data_through || r.collected_at;
      return {
        kpi_family: fam,
        metric_value: r.metric_value,
        target: r.target_value != null ? r.target_value : _numOrNull(targets[fam]),
        status_color: r.status_color || 'none',
        trend: r.trend || null,
        stale: _isStale(ref, staleDays, nowMs),
        source: r.source || 'analytics_opmanager',
        period_start: r.period_start, period_end: r.period_end,
        data_through: r.data_through || null,
        collected_at: r.collected_at || null,
        device_count: r.device_count, included_device_count: r.included_device_count,
      };
    });
  }

  router.get('/api/analytics/opmanager/availability', requireReportSession, async (req, res) => {
    try {
      const period = req.query.period === 'month' ? 'month' : 'week';
      const cfg = await reportConfig.getConfig(rdb.db);          // Promise on pg — MUST await
      const targets = _safeParse(cfg.opm_targets, {});
      const staleDays = parseInt(cfg.opm_stale_days, 10) || 9;
      const asOf = new Date().toISOString().slice(0, 10);
      const nowMs = Date.now();
      const code = String(req.query.site || '').trim();

      if (!code || code === 'all') {
        const snaps = await rdb.getInfraSnapshots({ period_type: period });
        const siteList = (await rdb.listSites({ includeInactive: true })) || [];
        const nameById = {}; for (const s of siteList) nameById[s.id] = s.name;
        const bySite = {};
        for (const r of snaps) (bySite[r.site_id] = bySite[r.site_id] || []).push(r);
        const sites = Object.keys(bySite).map(sid => ({
          site_id: Number(sid), site_name: nameById[sid] || null,
          families: fillFamilies(bySite[sid], targets, staleDays, nowMs),
        }));
        return res.json({ period, as_of: asOf, sites });
      }

      const site = await resolveSiteParam(code);
      if (!site) return res.json({ site: code, site_id: null, period, as_of: asOf, families: [] });
      const snaps = await rdb.getInfraSnapshots({ site_id: site.site_id, period_type: period });
      return res.json({
        site: code, site_id: site.site_id, site_name: site.name, period, as_of: asOf,
        families: fillFamilies(snaps, targets, staleDays, nowMs),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/analytics/opmanager/coverage', requireReportSession, async (req, res) => {
    try {
      const cfg = await reportConfig.getConfig(rdb.db);
      const { coverageSummary } = require('../services/opmAnalytics');
      const codes = (await rdb.listSiteModuleCodes('opmanager')) || [];
      const byProbe = {}; for (const c of codes) byProbe[String(c.code).trim().toLowerCase()] = c.site_id;
      const probeToSite = p => { const k = String(p == null ? '' : p).trim().toLowerCase(); return byProbe[k] != null ? byProbe[k] : null; };

      // V1b-B — coverage from the REST device list when OpManager REST is configured
      // (else the availability snapshots + this governance view would derive from two sources).
      if (cfg && cfg.opmanager_api_key && cfg.opmanager_base_url) {
        const client = deps.opmanagerClient || require('../services/opmanagerClient').makeOpmanagerClient({
          apiKey: cfg.opmanager_api_key, baseUrl: cfg.opmanager_base_url, tlsInsecure: cfg.opmanager_tls_insecure !== '0' });
        const raw = (await client.listDevices({ rows: 5000, page: 1 })) || [];
        const rows = raw.map(d => ({ device_key: d.name || d.deviceName || d.displayName, probe: d.probeName, type: d.type, category: d.category }));
        const cov = coverageSummary(rows, { classify: classifyKpiFamily, probeToSite });
        return res.json({ available: true, source: 'opmanager_rest', ...cov });
      }

      // V1a fallback — the prepared Analytics view (dormant).
      const viewId = cfg && cfg.opm_availability_view_id;
      if (!viewId) return res.json({ available: false, reason: 'opmanager REST or opm_availability_view_id not configured' });
      const { readDailyRows } = require('../services/opmAnalytics');
      const rows = await readDailyRows({ fetchView: deps.fetchView, viewId });
      const cov = coverageSummary(rows, { classify: classifyKpiFamily, probeToSite });
      return res.json({ available: true, source: 'analytics', ...cov });
    } catch (e) { return res.json({ available: false, reason: e.message }); }
  });

  router.post('/api/analytics/opmanager/sync', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const r = await require('../tools/opmanager/sync-availability').main({ fetchView: deps.fetchView });
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── V1b-D — WAN Health dashboard (reads wan_link_snapshots, the Meraki WAN archive) ──
  router.get('/api/analytics/wan/summary', requireReportSession, async (req, res) => {
    try {
      const { latestPerSite } = require('../services/wanDashboard');
      const period = req.query.period === 'month' ? 'month' : 'week';
      const rows = await rdb.getWanSnapshots({ period_type: period });
      const siteList = (await rdb.listSites({ includeInactive: true })) || [];
      const nameById = {}; for (const s of siteList) nameById[s.id] = s.name;
      const sites = latestPerSite(rows).map(s => ({ ...s, site_name: nameById[s.site_id] || null }));
      res.json({ period, as_of: new Date().toISOString().slice(0, 10), sites });
    } catch (e) { res.json({ sites: [], reason: e.message }); }
  });

  router.get('/api/analytics/wan/trend', requireReportSession, async (req, res) => {
    try {
      const { trendSeries } = require('../services/wanDashboard');
      const period = req.query.period === 'month' ? 'month' : 'week';
      const code = String(req.query.site || '').trim();
      const site = await resolveSiteParam(code);
      if (!site) return res.json({ site: code, site_id: null, period, series: [] });
      const rows = await rdb.getWanSnapshots({ site_id: site.site_id, period_type: period });
      res.json({ site: code, site_id: site.site_id, site_name: site.name, period, series: trendSeries(rows) });
    } catch (e) { res.json({ series: [], reason: e.message }); }
  });

  router.post('/api/analytics/wan/sync', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const r = await require('../tools/meraki/sync-wan').main({});
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Editable Site ↔ Meraki-network map (the sync's own source). super_admin — this
  // is admin config. GET lists every active site (mapped or not); PUT saves rows.
  router.get('/api/analytics/wan/mappings', requireReportSession, requireSuperAdmin, async (req, res) => {
    try {
      res.json({
        sites: (await rdb.listSiteMerakiMap()) || [],
        subsites: (await rdb.listWanSubsiteNetworks()) || [],
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.put('/api/analytics/wan/mappings', requireReportSession, requireSuperAdmin, express.json(), async (req, res) => {
    try {
      const list = Array.isArray(req.body && req.body.mappings) ? req.body.mappings : [];
      for (const m of list) {
        const sid = Number(m && m.site_id);
        if (Number.isFinite(sid)) await rdb.setSiteMerakiCode(sid, m.network);
      }
      await rdb.setWanSubsiteNetworks((req.body && req.body.subsites) || []);
      res.json({
        ok: true,
        sites: (await rdb.listSiteMerakiMap()) || [],
        subsites: (await rdb.listWanSubsiteNetworks()) || [],
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
