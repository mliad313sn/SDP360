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
      const viewId = cfg && cfg.opm_availability_view_id;
      if (!viewId) return res.json({ available: false, reason: 'opm_availability_view_id not configured' });
      const { readDailyRows, coverageSummary } = require('../services/opmAnalytics');
      const rows = await readDailyRows({ fetchView: deps.fetchView, viewId });
      const codes = (await rdb.listSiteModuleCodes('opmanager')) || [];
      const byProbe = {}; for (const c of codes) byProbe[String(c.code).trim().toLowerCase()] = c.site_id;
      const probeToSite = p => { const k = String(p == null ? '' : p).trim().toLowerCase(); return byProbe[k] != null ? byProbe[k] : null; };
      const cov = coverageSummary(rows, { classify: classifyKpiFamily, probeToSite });
      return res.json({ available: true, ...cov });
    } catch (e) { return res.json({ available: false, reason: e.message }); }
  });

  router.post('/api/analytics/opmanager/sync', requireAdmin, async (req, res) => {
    try {
      const r = await require('../tools/opmanager/sync-availability').main({ fetchView: deps.fetchView });
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
