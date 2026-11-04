'use strict';
// A-19 — restore routes + the admin trash listing for soft-deleted records (services/softDelete.js).
// Restore and trash are the ADMIN TIER only (rdb.userHasRole(user, 'admin')); who may DELETE is unchanged and
// stays in each module's own route. A restore past soft_delete_retention_days is refused (409).
const { fail } = require('../services/httpError');
const softDelete = require('../services/softDelete');
const ops = require('../services/softDeleteOps');

module.exports = function softDeleteRoutes(deps) {
  const { express, requireReportSession } = deps;
  const rdb = deps.rdb || require('../reports-db');
  const idb = () => deps.inspectionDb || require('../inspection-db');
  const mdb = () => deps.meetingsDb || require('../meetings-db');
  const gov = () => (typeof deps.getGovStore === 'function' ? deps.getGovStore() : null);
  const router = express.Router();
  const jsonBody = express.json({ limit: '64kb' });

  function adminOr403(req, res) {
    if (rdb.userHasRole(req.reportUser, 'admin')) return true;
    res.status(403).json({ error: 'Restoring or listing deleted records is reserved to the admin tier' });
    return false;
  }
  const log = (req, category, action, target, details) => {
    try { rdb.logEvent({ category, action, target: String(target), details, ...rdb._logCtx(req) }); } catch (_) { /* best-effort */ }
  };

  // POST /api/inspection/:id/restore
  router.post('/api/inspection/:id/restore', requireReportSession, jsonBody, async (req, res) => {
    try {
      if (!adminOr403(req, res)) return;
      const cfg = await softDelete.readConfig(rdb);
      const row = softDelete.assertRestorable(await idb().getInspectionTrashRow(req.params.id), cfg, { what: 'inspection' });
      if (!(await idb().restoreInspection(row.id))) return res.status(409).json({ error: 'This inspection is not deleted' });
      log(req, 'inspection', 'inspection_restored', row.id, { site: row.site_code, deleted_at: row.deleted_at });
      res.json({ ok: true, id: row.id });
    } catch (e) { fail(res, e); }
  });

  // POST /api/meetings/:id/restore — a restored PV comes back with its issues / actions (never removed), so the
  // action_items.origin_id references to its actions resolve again.
  router.post('/api/meetings/:id/restore', requireReportSession, jsonBody, async (req, res) => {
    try {
      if (!adminOr403(req, res)) return;
      const cfg = await softDelete.readConfig(rdb);
      const row = softDelete.assertRestorable(await mdb().getMeetingTrashRow(req.params.id), cfg, { what: 'PV' });
      if (!(await mdb().restoreMeeting(row.id))) return res.status(409).json({ error: 'This PV is not deleted' });
      log(req, 'meetings', 'meeting_restored', row.id, { site: row.site_code, reference: row.reference, deleted_at: row.deleted_at });
      res.json({ ok: true, id: Number(row.id) });
    } catch (e) { fail(res, e); }
  });

  // POST /api/governance/portfolio/:kind/:id/restore — the node comes back with its (never stamped) subtree.
  router.post('/api/governance/portfolio/:kind/:id/restore', requireReportSession, jsonBody, async (req, res) => {
    try {
      if (!adminOr403(req, res)) return;
      const st = gov(); if (!st) return res.status(503).json({ error: 'Governance module not available' });
      const cfg = await softDelete.readConfig(rdb);
      const row = softDelete.assertRestorable(await st.getPortfolioTrashRow(req.params.kind, req.params.id), cfg, { what: req.params.kind });
      if (!(await st.restorePortfolio(req.params.kind, row.id, { user: req.reportUser }))) return res.status(409).json({ error: `This ${req.params.kind} is not deleted` });
      log(req, 'portfolio', 'portfolio_restored', `${req.params.kind}:${row.id}`, { deleted_at: row.deleted_at });
      res.json({ ok: true, kind: req.params.kind, id: row.id });
    } catch (e) { fail(res, e); }
  });

  // POST /api/governance/cadences/:id/restore — its sessions, actions and decision links come back with it.
  router.post('/api/governance/cadences/:id/restore', requireReportSession, jsonBody, async (req, res) => {
    try {
      if (!adminOr403(req, res)) return;
      const st = gov(); if (!st) return res.status(503).json({ error: 'Governance module not available' });
      const cfg = await softDelete.readConfig(rdb);
      const row = softDelete.assertRestorable(await st.getCadenceTrashRow(req.params.id), cfg, { what: 'cadence' });
      if (!(await st.restoreCadence(row.id))) return res.status(409).json({ error: 'This cadence is not deleted' });
      log(req, 'portfolio', 'cadence_restored', row.id, { key: row.key, deleted_at: row.deleted_at });
      res.json({ ok: true, id: row.id });
    } catch (e) { fail(res, e); }
  });

  // GET /api/admin/trash?module=inspection — deleted rows with who / when / why and whether still restorable.
  router.get('/api/admin/trash', requireReportSession, async (req, res) => {
    try {
      if (!adminOr403(req, res)) return;
      const module = req.query.module ? String(req.query.module) : null;
      if (module && !ops.moduleNames().includes(module)) return res.status(400).json({ error: `unknown module (expected one of ${ops.moduleNames().join(', ')})` });
      const cfg = await softDelete.readConfig(rdb);
      const days = softDelete.retentionDays(cfg);
      const rows = await ops.trash({ module, govStore: gov() });
      let names = new Map();
      try { names = new Map(((await rdb.listUsers()) || []).map((u) => [Number(u.id), u.username || u.full_name || null])); } catch (_) { /* names are optional */ }
      const now = new Date();
      res.json({
        enabled: softDelete.isEnabled(cfg), purge_enabled: softDelete.purgeEnabled(cfg), retention_days: days, modules: ops.moduleNames(),
        rows: rows.map((r) => ({ ...r, deleted_by_name: r.deleted_by == null ? null : (names.get(r.deleted_by) || null), restorable: softDelete.withinRetention(r, days, now) })),
      });
    } catch (e) { fail(res, e); }
  });

  return router;
};
