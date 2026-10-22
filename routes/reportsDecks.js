'use strict';
// ---------------------------------------------------------------------------
// Report deck routes - extracted from server.js (SDP-DASH-2.0 step 5, lot 5.3b, 2026-10-22).
// Weekly / monthly / all-sites / weekly-summary / v2 / site-template PPTX, the monthly
// overview + edits, yearly summary, annual objectives, /api/executive-new-pptx, notes
// persistence and the chart/PPTX save endpoints. Handlers unchanged (`app.` became
// `router.`, files under data/ are resolved from the repository root). The helpers that read
// meetingsDb / assets / report state stay in server.js and arrive through deps.
// ---------------------------------------------------------------------------
const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

module.exports = function reportsDecksRoutes(deps) {
  const {
    express, rdb, requireReportSession, requireAdmin, requireRole, CONFIG,
    rpptx, rpptxMonthly, rpptxSiteTemplate, rExecNewReport,
    meetingsSummaryForSite: _meetingsSummaryForSite, assetReviewForPptx: _assetReviewForPptx,
    validateActionItems, authorizeSiteWrite: _authorizeSiteWrite,
  } = deps;
  const router = express.Router();

  // GET /api/reports/:id/pptx  — download weekly PPTX
  router.get('/api/reports/:id/pptx', requireReportSession, async (req, res) => {
    if (!rpptx) return res.status(503).json({ error: 'PPTX module not available' });
    try {
      const report = await rdb.getReport(parseInt(req.params.id));
      if (!report) return res.status(404).json({ error: 'Report not found' });
      // Fetch previous week's report for auto-trend computation
      const prevData = await rdb.getPreviousWeekInfraKpis(report.site_id, report.id);
      const prevReport = prevData && prevData.kpis && prevData.kpis.length
        ? { infra_kpis: prevData.kpis } : null;
      // Fetch open changes + active major incidents for this site's group(s).
      // Both ride into slideLights so the deck mirrors the on-screen panels
      // in the report editor (Active Changes + Active Major Incidents).
      const _wSite = (await rdb.listSites()).find(s => s.id === report.site_id);
      const _wGroups = _wSite ? (_wSite.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean) : [];
      const openChanges     = await rdb.getOpenChangesForSite(_wGroups);
      const activeIncidents = await rdb.getActiveMajorIncidentsForSite(_wGroups);
      // Department-meetings monthly snapshot for the report's site + month —
      // drives the new "Department Meetings" slide.
      const _wRef = report.end_date || report.start_date || '';
      const meetingsSummary = await _meetingsSummaryForSite(report.site_name, String(_wRef).slice(0, 4), String(_wRef).slice(5, 7));
      const assetReview = await _assetReviewForPptx(report);
      const buf = await rpptx.generateWeeklyPptx(report, prevReport, openChanges, activeIncidents, meetingsSummary, assetReview);
      const filename = `Endeavour_${report.site_name}_${report.week_label.replace(/\s/g,'_')}_Report.pptx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buf);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/monthly/all-sites/:year/:month/pptx  — combined all-sites monthly deck
  // NOTE: must be registered BEFORE the /:site_id route so Express does not treat "all-sites" as a site_id
  router.get('/api/reports/monthly/all-sites/:year/:month/pptx', requireReportSession, requireAdmin, async (req, res) => {
    if (!rpptxMonthly) return res.status(503).json({ error: 'Monthly PPTX module not available' });
    try {
      const { year, month } = req.params;
      const sites = (await rdb.listSites()).filter(s => s.active);
      const allData = [];
      for (const site of sites) {
        const monthlyData = await rdb.getMonthlyData(site.id, parseInt(year), parseInt(month));
        const edits      = await rdb.getMonthlyEdits(site.id, parseInt(year), parseInt(month));
        const objectives = await rdb.getAnnualObjectives(site.id, parseInt(year));
        const yearlyData = await rdb.getYearlySummary(site.id, parseInt(year));
        const _aGroups   = (site.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
        const openChanges     = await rdb.getOpenChangesForSite(_aGroups);
        const activeIncidents = await rdb.getActiveMajorIncidentsForSite(_aGroups);
        allData.push({ site, monthlyData, edits, objectives, yearlyData, openChanges, activeIncidents,
          meetingsSummary: await _meetingsSummaryForSite(site.name, year, month) });
      }
      if (allData.length === 0) return res.status(404).json({ error: 'No active sites found' });
      const buf = await rpptxMonthly.generateAllSitesMonthlyPptx(allData, parseInt(year), parseInt(month));
      const monthName = new Date(parseInt(year), parseInt(month)-1, 1).toLocaleString('en', { month: 'long' });
      const filename = `Endeavour_AllSites_${year}_${monthName}_Monthly_Report.pptx`;
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buf);
    } catch(e) {
      console.error('[monthly/all-sites/pptx] Error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/reports/monthly/:site_id/:year/:month/pptx  — download monthly PPTX
  router.get('/api/reports/monthly/:site_id/:year/:month/pptx', requireReportSession, async (req, res) => {
    if (!rpptx) return res.status(503).json({ error: 'PPTX module not available' });
    try {
      const { site_id, year, month } = req.params;
      const sites = await rdb.listSites();
      const site  = sites.find(s => s.id === parseInt(site_id));
      if (!site) return res.status(404).json({ error: 'Site not found' });
      const monthlyData = await rdb.getMonthlyData(parseInt(site_id), parseInt(year), parseInt(month));
      // Attach current open changes + active major incidents to every weekly
      // report inside monthlyData so each per-week Lights slide renders the
      // same panels the editor shows. Both lists are point-in-time (now),
      // not historical — every week's slide gets the same snapshot, which
      // matches how the editor preview behaves.
      const _mGroups        = (site.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
      const _openChanges    = await rdb.getOpenChangesForSite(_mGroups);
      const _activeIncidents= await rdb.getActiveMajorIncidentsForSite(_mGroups);
      if (Array.isArray(monthlyData.reports)) {
        monthlyData.reports = monthlyData.reports.map(r =>
          r ? { ...r, openChanges: _openChanges, activeIncidents: _activeIncidents } : r
        );
      }
      monthlyData.meetingsSummary = await _meetingsSummaryForSite(site.name, year, month);
      const buf = await rpptx.generateMonthlyPptx(monthlyData, site.name, parseInt(year), parseInt(month));
      const monthName = new Date(parseInt(year), parseInt(month)-1, 1).toLocaleString('en',{month:'long'});
      const filename = `Endeavour_${site.name}_${monthName}_${year}_Monthly_Report.pptx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buf);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/weekly-summary/:year/:week/pptx  — all-sites aggregated weekly PPTX
  router.get('/api/reports/weekly-summary/:year/:week/pptx', requireReportSession, requireAdmin, async (req, res) => {
    if (!rpptx) return res.status(503).json({ error: 'PPTX module not available' });
    try {
      const { year, week } = req.params;
      const summaryData = await rdb.getWeekSummaryData(parseInt(year), parseInt(week));
      if (!summaryData.reports.length) {
        return res.status(404).json({ error: `No submitted reports found for ${summaryData.week_label}` });
      }
      // Attach open changes + active major incidents per site to each
      // report so generateWeeklySummaryPptx → slideLights renders both
      // panels for every site's slide.
      const _wsSites = await rdb.listSites();
      const _wsRange = rdb.getWeekRange(parseInt(year), parseInt(week));
      const _wsRef   = (_wsRange && (_wsRange.end || _wsRange.start)) || '';
      summaryData.reports = await Promise.all(summaryData.reports.map(async r => {
        const _s = _wsSites.find(s => s.id === r.site_id);
        const _g = _s ? (_s.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean) : [];
        return {
          ...r,
          openChanges:     await rdb.getOpenChangesForSite(_g),
          activeIncidents: await rdb.getActiveMajorIncidentsForSite(_g),
          meetingsSummary: await _meetingsSummaryForSite(_s ? _s.name : null, String(_wsRef).slice(0, 4), String(_wsRef).slice(5, 7)),
          assetReviewPptx: await _assetReviewForPptx(r),
        };
      }));
      const buf = await rpptx.generateWeeklySummaryPptx(summaryData);
      const filename = `Endeavour_AllSites_${summaryData.week_label.replace(/\s+/g, '_')}_Weekly_Summary.pptx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buf);
    } catch(e) {
      console.error('[weekly-summary pptx]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/reports/monthly/:site_id/:year/:month  — monthly overview (no PPTX)
  router.get('/api/reports/monthly/:site_id/:year/:month', requireReportSession, async (req, res) => {
    try {
      const { site_id, year, month } = req.params;
      const data = await rdb.getMonthlyData(parseInt(site_id), parseInt(year), parseInt(month));
      res.json(data);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── MONTHLY REPORT EDITS ──────────────────────────────────────────
  // GET /api/reports/monthly/:site_id/:year/:month/edits
  // Returns merged lights+actions with week labels (saved edits or auto-merged from weekly)
  router.get('/api/reports/monthly/:site_id/:year/:month/edits', requireReportSession, async (req, res) => {
    try {
      const { site_id, year, month } = req.params;
      const data = await rdb.getMonthlyEdits(parseInt(site_id), parseInt(year), parseInt(month));
      res.json(data);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/reports/monthly/:site_id/:year/:month/edits
  // Save user-edited lights/actions for the monthly report.
  // Applies the same validateActionItems guard as the weekly PUT — spec §9.1-9.2
  // (defense-in-depth on every action-item write path, not just the weekly one).
  router.post('/api/reports/monthly/:site_id/:year/:month/edits', requireReportSession, express.json({ limit: '2mb' }), async (req, res) => {
    try {
      if (!_authorizeSiteWrite(req, res, req.params.site_id)) return;
      const { site_id, year, month } = req.params;
      const { edited_lights, edited_actions, notes, status } = req.body || {};

      let cleanedActions = edited_actions;
      if (Array.isArray(edited_actions) && edited_actions.length) {
        const { errors, cleaned } = await validateActionItems(edited_actions);
        if (errors.length) {
          return res.status(400).json({ error: 'validation', details: errors });
        }
        cleanedActions = cleaned;
      }

      await rdb.saveMonthlyEdits(parseInt(site_id), parseInt(year), parseInt(month), { edited_lights, edited_actions: cleanedActions, notes, status });
      await rdb.logAudit({ site_id: parseInt(site_id), user_id: req.reportUser.id, username: req.reportUser.username, action: 'edited_monthly', details: { year, month, lights: (edited_lights||[]).length, actions: (cleanedActions||[]).length } });
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/yearly/:site_id/:year
  // Returns 12-month summary: infra KPIs (last week each month) + helpdesk totals
  router.get('/api/reports/yearly/:site_id/:year', requireReportSession, async (req, res) => {
    try {
      const { site_id, year } = req.params;
      const data = await rdb.getYearlySummary(parseInt(site_id), parseInt(year));
      res.json(data);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/objectives/:site_id/:year
  // Return annual objectives for site+year
  router.get('/api/reports/objectives/:site_id/:year', requireReportSession, async (req, res) => {
    try {
      const { site_id, year } = req.params;
      const rows = await rdb.getAnnualObjectives(parseInt(site_id), parseInt(year));
      res.json(rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/reports/objectives/:site_id/:year
  // Replace all objectives for site+year
  router.post('/api/reports/objectives/:site_id/:year', requireReportSession, express.json({ limit: '1mb' }), async (req, res) => {
    try {
      if (!_authorizeSiteWrite(req, res, req.params.site_id)) return;
      const { site_id, year } = req.params;
      const objectives = Array.isArray(req.body) ? req.body : [];
      await rdb.saveAnnualObjectives(parseInt(site_id), parseInt(year), objectives);
      await rdb.logAudit({ site_id: parseInt(site_id), user_id: req.reportUser.id, username: req.reportUser.username, action: 'edited_objectives', details: { year, count: objectives.length } });
      res.json({ ok: true, saved: objectives.length });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/reports/monthly/:site_id/:year/:month/pptx-v2  — new 7-slide monthly format
  router.get('/api/reports/monthly/:site_id/:year/:month/pptx-v2', requireReportSession, async (req, res) => {
    if (!rpptxMonthly) return res.status(503).json({ error: 'Monthly PPTX module not available' });
    try {
      const { site_id, year, month } = req.params;
      const sites = await rdb.listSites();
      const site  = sites.find(s => s.id === parseInt(site_id));
      if (!site) return res.status(404).json({ error: 'Site not found' });
      const monthlyData = await rdb.getMonthlyData(parseInt(site_id), parseInt(year), parseInt(month));
      const edits       = await rdb.getMonthlyEdits(parseInt(site_id), parseInt(year), parseInt(month));
      const objectives  = await rdb.getAnnualObjectives(parseInt(site_id), parseInt(year));
      const yearlyData  = await rdb.getYearlySummary(parseInt(site_id), parseInt(year));
      const _mGroups       = (site.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
      const openChanges    = await rdb.getOpenChangesForSite(_mGroups);
      const activeIncidents= await rdb.getActiveMajorIncidentsForSite(_mGroups);
      monthlyData.meetingsSummary = await _meetingsSummaryForSite(site.name, year, month);
      const buf = await rpptxMonthly.generateMonthlyPptxV2(monthlyData, site.name, parseInt(year), parseInt(month), edits, objectives, yearlyData, openChanges, activeIncidents);
      const monthName = new Date(parseInt(year), parseInt(month)-1, 1).toLocaleString('en', { month: 'long' });
      const filename = `Endeavour_${site.name}_${year}_${monthName}_Monthly_Report.pptx`;
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buf);
    } catch(e) {
      console.error('[monthly/pptx-v2] Error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/reports/monthly/:site_id/:year/:month/site-template/pptx
  // 19-slide mine-site template PPTX — auto-fills all data-driven sections
  router.get('/api/reports/monthly/:site_id/:year/:month/site-template/pptx', requireReportSession, async (req, res) => {
    if (!rpptxSiteTemplate) return res.status(503).json({ error: 'Site template PPTX module not available' });
    try {
      const { site_id, year, month } = req.params;
      const sites = await rdb.listSites();
      const site  = sites.find(s => s.id === parseInt(site_id));
      if (!site) return res.status(404).json({ error: 'Site not found' });
      const monthlyData = await rdb.getMonthlyData(parseInt(site_id), parseInt(year), parseInt(month));
      console.log(`[site-template/pptx] Generating for ${site.name} ${year}-${month}`);
      const buf = await rpptxSiteTemplate.generateSiteMonthlyPptx(monthlyData, site.name, parseInt(year), parseInt(month));
      const monthName = new Date(parseInt(year), parseInt(month)-1, 1).toLocaleString('en', { month: 'long' });
      const filename = `Endeavour_${site.name}_${monthName}_${year}_Monthly_IT_Report.pptx`;
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buf);
    } catch(e) {
      console.error('[site-template/pptx] Error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/executive-new-pptx  — 8-slide executive report with native charts + AI
  // Protected by the standard API key guard (X-Dash-Key), same as other executive-report.html calls.
  // Body: { site_id, year, month, period, siteFilter, groupFilter, groups, helpdesk, changes, incidents, csat,
  //         ageing, categoryBreakdown, siteSummary, monthlyTrend, savedComments }
  router.post('/api/executive-new-pptx', requireReportSession, requireRole('report-author'), express.json({ limit: '256kb' }), async (req, res) => {
    if (!rExecNewReport) return res.status(503).json({ error: 'Executive new report module not available' });
    try {
      const payload = req.body || {};
      if (!payload.period) return res.status(400).json({ error: 'period is required' });

      // Resolve site_id from groups if not supplied
      if (!payload.site_id && Array.isArray(payload.groups) && payload.groups.length > 0 && rdb) {
        const sites = await rdb.listSites();
        const firstGroup = payload.groups[0];
        const matched = sites.find(s =>
          (s.zoho_group || '').split(',').map(g => g.trim()).includes(firstGroup)
        );
        if (matched) payload.site_id = matched.id;
      }
      // Use site 1 as fallback when all-sites filter is active
      if (!payload.site_id && rdb) {
        const sites = await rdb.listSites();
        if (sites.length > 0) payload.site_id = sites[0].id;
      }

      const anthropicKey = CONFIG.anthropicKey || '';
      const buf = await rExecNewReport.generateExecNewReport(payload, anthropicKey);

      const year      = payload.year  || new Date().getFullYear();
      const month     = payload.month || (new Date().getMonth() + 1);
      const monthName = new Date(parseInt(year), parseInt(month) - 1, 1)
                          .toLocaleString('en', { month: 'long' });
      const sitePart  = (payload.siteFilter && payload.siteFilter !== 'All Sites')
                          ? '_' + payload.siteFilter.replace(/[^a-zA-Z0-9]/g, '_')
                          : '';
      const filename  = `Endeavour_Executive_Report_${year}_${monthName}${sitePart}.pptx`;

      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buf);
    } catch(e) {
      console.error('[executive-new-pptx] Error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── NOTES PERSISTENCE ─────────────────────────────────────────────
  // Stores all editable insight field content in data/notes.json
  const NOTES_FILE = path.join(ROOT, 'data', 'notes.json');

  router.get('/api/notes', requireReportSession, (req, res) => {
    try {
      if (!fs.existsSync(NOTES_FILE)) return res.json({});
      const raw = fs.readFileSync(NOTES_FILE, 'utf8');
      res.json(JSON.parse(raw));
    } catch (err) {
      console.error('[Notes] Read error:', err.message);
      res.json({});
    }
  });

  router.post('/api/notes', requireReportSession, express.json({ limit: '1mb' }), (req, res) => {
    try {
      const dataDir = path.join(ROOT, 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const payload = { savedAt: new Date().toISOString(), fields: req.body || {} };
      fs.writeFileSync(NOTES_FILE, JSON.stringify(payload, null, 2), 'utf8');
      res.json({ ok: true, savedAt: payload.savedAt });
    } catch (err) {
      console.error('[Notes] Write error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── CHART IMAGE EXPORT (temporary — for PPTX generation) ─────────
  router.post('/api/save-charts', requireReportSession, express.json({ limit: '50mb' }), (req, res) => {
    try {
      const outPath = path.join(ROOT, 'data', 'chart_images.json');
      fs.writeFileSync(outPath, JSON.stringify(req.body));
      res.json({ ok: true, path: outPath });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Save PPTX binary from browser export (for server-side access)
  router.post('/api/save-pptx', requireReportSession, requireRole('report-author'), express.raw({ type: 'application/octet-stream', limit: '30mb' }), (req, res) => {
    try {
      // Sanitise the client-supplied filename — basename only, forced .pptx,
      // and guaranteed to stay inside data/ (was a path-traversal hole:
      // ?name=../../x escaped the directory). See services/safeFilename.js.
      const { safeJoin } = require('../services/safeFilename');
      const outPath = safeJoin(path.join(ROOT, 'data'), req.query.name, { ext: '.pptx', fallback: 'export.pptx' });
      fs.writeFileSync(outPath, req.body);
      res.json({ ok: true, path: outPath });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
