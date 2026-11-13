'use strict';
const xpGate = require('../services/exportPolicy').gate;   // P9 / B7 — one export policy (allow / mask / deny + export log + watermark)
// ─────────────────────────────────────────────────────────────────────────
// Sites routes — extracted from server.js (E-D02, expert audit 2026-11-05; X-SEC-03 frees server.js budget).
// GET/PUT/POST/DELETE /api/reports/sites* — same paths, chains and answers (`app.` → `router.`), plus:
// PUT /:id accepts `time_zone` (validated, audited) and GET /master is the site master export.
// ─────────────────────────────────────────────────────────────────────────
const { fail } = require('../services/httpError');

module.exports = function sitesRoutes(deps) {
  const { express, rdb, requireReportSession, requireSuperAdmin, requireExecutiveOrSuperAdmin, jsonBody } = deps;
  const router = express.Router();

  // GET /api/reports/sites/master[?format=csv] — E-D02 site master export (super_admin): id, name, codes per
  // module, country, business unit, time zone, asset currency (report_config asset_site_currency), Zoho group,
  // active. Unmapped = null, never guessed.
  router.get('/api/reports/sites/master', requireReportSession, requireSuperAdmin, xpGate('reports.site_master'), async (req, res) => {
    try {
      const SM = require('../services/siteMaster'), CUR = require('../services/currency');
      const { sites, codes } = await rdb.getSiteMasterRows();
      const curMap = CUR.parseCurrencyMap((await require('../services/reportConfig').getConfig(rdb.db)).asset_site_currency);
      const rows = SM.buildSiteMaster({ sites, codes, currencyFor: (s) => CUR.resolveSiteCurrency(s.name, curMap) });
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="site-master.csv"');
        return res.send(SM.toCsv(rows));
      }
      res.json({ ok: true, generated_at: new Date().toISOString(), sites: rows });
    } catch(e) { fail(res, e); }
  });

  router.get('/api/reports/sites', requireReportSession, async (req, res) => {
    try {
      const includeInactive = req.query.include_inactive === '1';
      if (includeInactive && !['executive','super_admin'].includes(req.reportUser?.role)) {
        return res.status(403).json({ error: 'Executive or super_admin only for include_inactive' });
      }
      res.json(await rdb.listSites({ includeInactive }));
    } catch(e) { fail(res, e); }
  });

  // PUT /api/reports/sites/:id — partial update.
  // - admin/executive/super_admin can update zoho_group (existing behavior, used by inline Save).
  // - executive+ required for sort_order or active changes (broader site config).
  // `name` is intentionally NOT editable here — see reports-db.js updateSite() comment.
  router.put('/api/reports/sites/:id', requireReportSession, requireSuperAdmin, jsonBody, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { zoho_group, sort_order, active, time_zone } = req.body || {};

      // RBAC: edits beyond zoho_group require executive+
      const broaderUpdate = (sort_order !== undefined) || (active !== undefined);
      if (broaderUpdate && !['executive','super_admin'].includes(req.reportUser?.role)) {
        return res.status(403).json({ error: 'Executive or super_admin only to change sort_order / active' });
      }

      const before = (await rdb.listSites({ includeInactive: true })).find(s => s.id === id);
      if (!before) return res.status(404).json({ error: 'Site not found' });

      // E-D02: time_zone (super_admin, validated in updateSite → 400) is audited before/after like the broader edits
      const tzBefore = time_zone !== undefined ? ((await rdb.getSiteMasterRows()).sites.find(s => s.id === id) || {}).time_zone || null : undefined;
      const after = await rdb.updateSite(id, { zoho_group, sort_order, active, time_zone });

      // Audit only the broader updates; legacy zoho_group inline edits stay quiet to keep audit_log focused
      if (broaderUpdate || time_zone !== undefined) {
        const action = (before.active && !after.active) ? 'site_disabled'
                     : (!before.active && after.active) ? 'site_enabled'
                     : 'site_updated';
        await rdb.logAudit({
          site_id: id, user_id: req.reportUser.id, username: req.reportUser.username,
          action, details: { before: { zoho_group: before.zoho_group, sort_order: before.sort_order, active: before.active, ...(time_zone !== undefined ? { time_zone: tzBefore } : {}) },
                              after:  { zoho_group: after.zoho_group,  sort_order: after.sort_order,  active: after.active, ...(time_zone !== undefined ? { time_zone: after.time_zone || null } : {}) } }
        });
      }
      res.json({ ok: true, ...after });
    } catch(e) { fail(res, e); }
  });

  // POST /api/reports/sites — create a new site (executive+).
  // If a site with the same name already exists but is inactive, it's reactivated
  // instead of failing the UNIQUE constraint (matches Departments behavior).
  router.post('/api/reports/sites', requireReportSession, requireExecutiveOrSuperAdmin, jsonBody, async (req, res) => {
    try {
      const { name, zoho_group, sort_order } = req.body || {};
      const result = await rdb.createSite({ name, zoho_group, sort_order });
      await rdb.logAudit({
        site_id: result.id, user_id: req.reportUser.id, username: req.reportUser.username,
        action: result.reactivated ? 'site_enabled' : 'site_created',
        details: { id: result.id, name: result.name, zoho_group: zoho_group || null }
      });
      res.json(result);
    } catch(e) { fail(res, e, 400); }
  });

  // DELETE /api/reports/sites/:id — soft-delete (sets active=0).
  // Historical reports keep their site_id link and remain accessible.
  router.delete('/api/reports/sites/:id', requireReportSession, requireExecutiveOrSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const before = (await rdb.listSites({ includeInactive: true })).find(s => s.id === id);
      if (!before) return res.status(404).json({ error: 'Site not found' });
      const after = await rdb.setSiteActive(id, 0);
      await rdb.logAudit({
        site_id: id, user_id: req.reportUser.id, username: req.reportUser.username,
        action: 'site_disabled',
        details: { id, name: before.name }
      });
      res.json({ ok: true, ...after });
    } catch(e) { fail(res, e, 400); }
  });

  return router;
};
