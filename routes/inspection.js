'use strict';

const tableExcel = require('../services/tableExcel');

// ─────────────────────────────────────────────────────────────────────────
// Inspection routes — extracted from server.js (split-server.js PILOT, 2026-06-21).
//
// First module pulled out of the 6.7k-line server.js into its own router, to
// prove the dependency-injection pattern for future extractions. The handlers
// are byte-for-byte the same as before; only `app.` → `router.` and the
// server-internal warm ticket cache is read via getRawCache() instead of the
// closure variable `_rawCache`.
//
// Wiring in server.js:
//   app.use(require('./routes/inspection')({
//     express, inspectionDb, inspectionPptx, rdb,
//     requireReportSession, requireAdmin, requireExecutiveOrSuperAdmin, requireRole,
//     getRawCache: () => _rawCache,
//   }));
//
// inspectionDb / inspectionPptx are still require()'d in server.js (they are
// also used by the meetings routes) and passed in here — single instances.
// ─────────────────────────────────────────────────────────────────────────

module.exports = function inspectionRoutes(deps) {
  const {
    express, inspectionDb, inspectionPptx, rdb,
    requireReportSession, requireAdmin, requireExecutiveOrSuperAdmin, requireRole,
    getRawCache,
  } = deps;

  const router = express.Router();

  // Photos + signatures are base64 inside the request body. Give the write
  // routes their own larger json parser (100 mb) so the regular jsonBody
  // (2 mb) isn't bumped globally. See CLAUDE.md § inspection 413 history.
  const inspectionJsonBody = express.json({ limit: '100mb' });

  // Resolve the user's inspection site code (form code, e.g. 'MGO').
  // Returns null for unrestricted users (super_admin / executive / admin).
  async function _userInspectionSite(user) {
    if (!user) return null;
    if (rdb.userHasRole(user, 'admin')) return null;  // admin+ can write any site
    const siteId = user.site_id;
    if (!siteId) return null;
    // MUST await: listSites() is async under REPORTS_BACKEND=postgres (live in
    // prod). A bare call returned a Promise, .find() threw, and an editor-role
    // inspector's cross-site write guard broke (500 / wrong scope). await is a
    // no-op under sqlite.
    const sites = (await rdb.listSites()) || [];
    const site  = sites.find(s => s.id === siteId);
    return inspectionDb.siteNameToCode(site ? site.name : null);
  }

  // RBAC audit 2026-10-02, lot 4b — "open everything to coordinators, locked to their
  // site". Resolves the caller's scope for an inspection WRITE or EXPORT: { site: null }
  // for the admin tier (every site), { site: CODE } for an editor, or sends 403 and
  // returns null (no editor role / no resolvable site).
  async function _scopeOr403(req, res) {
    if (!rdb.userHasRole(req.reportUser, 'editor')) { res.status(403).json({ error: 'editor role or higher required' }); return null; }
    if (rdb.userHasRole(req.reportUser, 'admin')) return { site: null };
    const site = await _userInspectionSite(req.reportUser);
    if (!site) { res.status(403).json({ error: 'Your account has no site assigned for this module. Contact your administrator.' }); return null; }
    return { site };
  }
  // Same, plus "the stored inspection belongs to that site". Sends 404/403 itself.
  async function _ownInspectionOr403(req, res, id) {
    const scope = await _scopeOr403(req, res); if (!scope) return null;
    const head = await inspectionDb.getInspectionHeader(id);
    if (!head) { res.status(404).json({ error: 'Not found' }); return null; }
    if (scope.site && head.site_code !== scope.site) { res.status(403).json({ error: `Inspection belongs to ${head.site_code}; you are scoped to ${scope.site}` }); return null; }
    return { scope, head };
  }

  // GET /api/inspection/lookups — hydrate the form (sites + areas + types + categories)
  router.get('/api/inspection/lookups', requireReportSession, async (req, res) => {
    try {
      if (!inspectionDb) return res.status(503).json({ error: 'Inspection module not available' });
      // `scope` (lot 4b): the caller's inspection site code, null for the admin tier —
      // lets the dashboard offer Delete only on the editor's own site rows.
      const scope = rdb.userHasRole(req.reportUser, 'admin') ? null : (await _userInspectionSite(req.reportUser));
      res.json({ ...(await inspectionDb.loadLookups()), scope });
    } catch(e) {
      console.error('[Inspection] lookups error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/inspection/people — autocomplete source for the Lead Inspector
  // and Accompanied-By fields. Merges reports.db users with the Zoho-ticket
  // technician roster (from the warm ticket cache). Optional ?site=CODE
  // surfaces that site's members first.
  router.get('/api/inspection/people', requireReportSession, async (req, res) => {
    try {
      if (!inspectionDb) return res.status(503).json({ error: 'Inspection module not available' });
      const wantedCode = req.query.site || null;

      // 1) Admin / editor users from reports.db
      const fromUsers = await inspectionDb.listPeople({ site_code: wantedCode }) || [];

      // 2) Technicians extracted from the warm ticket cache.
      const techMap = {};
      const _rawCache = getRawCache ? getRawCache() : null;
      const rows = (_rawCache && _rawCache.data && Array.isArray(_rawCache.data.rows)) ? _rawCache.data.rows : [];
      for (const r of rows) {
        const name = ((r['Technician'] || r['Assigned To'] || '') + '').trim();
        if (!name || name === 'Unassigned' || name === '-No Value-') continue;
        const site = ((r['Site'] || '') + '').trim();
        const key  = name.toLowerCase();
        if (!techMap[key]) techMap[key] = { full_name: name, site_name: site, tickets: 0 };
        techMap[key].tickets += 1;
      }

      // 3) Merge — reports.db user wins on duplicate names; technicians fill the rest
      const seen = new Set(fromUsers.map(p => (p.full_name || '').toLowerCase()));
      const fromTickets = Object.values(techMap)
        .filter(t => !seen.has(t.full_name.toLowerCase()))
        .map(t => ({
          full_name: t.full_name,
          role:      'IT Technician',           // synthesised — not in users table
          site_name: t.site_name || '',
          site_code: inspectionDb.siteNameToCode(t.site_name) || null,
          tickets:   t.tickets,
          source:    'tickets'
        }));

      // 4) Sort: requested-site first, then by ticket count desc, then name
      const merged = fromUsers.concat(fromTickets).sort((a, b) => {
        const aHere = wantedCode && a.site_code === wantedCode ? 0 : 1;
        const bHere = wantedCode && b.site_code === wantedCode ? 0 : 1;
        if (aHere !== bHere) return aHere - bHere;
        const at = a.tickets || 0, bt = b.tickets || 0;
        if (at !== bt) return bt - at;
        return (a.full_name || '').localeCompare(b.full_name || '');
      });

      res.json({ people: merged, sources: { users: fromUsers.length, tickets: fromTickets.length } });
    } catch(e) {
      console.error('[Inspection] people error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/inspection/list — paginated header list with optional filters
  router.get('/api/inspection/list', requireReportSession, async (req, res) => {
    try {
      if (!inspectionDb) return res.status(503).json({ error: 'Inspection module not available' });
      const rows = await inspectionDb.listInspections({
        site:   req.query.site   || undefined,
        from:   req.query.from   || undefined,
        to:     req.query.to     || undefined,
        risk:   req.query.risk   || undefined,
        status: req.query.status || undefined,
        limit:  parseInt(req.query.limit  || '200', 10),
        offset: parseInt(req.query.offset || '0',   10)
      });
      res.json({ rows });
    } catch(e) {
      console.error('[Inspection] list error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/inspection/aggregate — KPI roll-up for the dashboard tiles
  router.get('/api/inspection/aggregate', requireReportSession, async (req, res) => {
    try {
      if (!inspectionDb) return res.status(503).json({ error: 'Inspection module not available' });
      res.json(await inspectionDb.aggregate({
        site: req.query.site || undefined,
        from: req.query.from || undefined,
        to:   req.query.to   || undefined
      }));
    } catch(e) {
      console.error('[Inspection] aggregate error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/inspection/actions — flat Corrective-Actions Register across all
  // inspections. viewer+. MUST be registered BEFORE /api/inspection/:id
  // (inspection ids are TEXT, so no numeric guard — order disambiguates).
  router.get('/api/inspection/actions', requireReportSession, async (req, res) => {
    try {
      if (!inspectionDb) return res.status(503).json({ error: 'Inspection module not available' });
      res.json({ rows: await inspectionDb.listActions({
        site:     req.query.site     || undefined,
        status:   req.query.status   || undefined,
        priority: req.query.priority || undefined,
        owner:    req.query.owner    || undefined,
        overdue:  req.query.overdue === '1' || req.query.overdue === 'true' || undefined,
        from:     req.query.from     || undefined,
        to:       req.query.to       || undefined,
        q:        req.query.q        || undefined,
      }) });
    } catch(e) {
      console.error('[Inspection] actions list error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/inspection/actions/:id/update — change one corrective action's
  // status + log an audit comment. editor+ ; editors scoped to their own site.
  // Allowed EVEN WHEN the parent inspection is submitted/closed.
  router.post('/api/inspection/actions/:id/update', requireReportSession, inspectionJsonBody, async (req, res) => {
    try {
      if (!inspectionDb) return res.status(503).json({ error: 'Inspection module not available' });
      if (!rdb.userHasRole(req.reportUser, 'editor')) {
        return res.status(403).json({ error: 'editor role or higher required' });
      }
      const actionId = parseInt(req.params.id, 10);
      if (!Number.isFinite(actionId)) return res.status(400).json({ error: 'Invalid action id' });
      const parent = await inspectionDb.getActionParent(actionId);
      if (!parent) return res.status(404).json({ error: 'Action not found' });
      const userSite = await _userInspectionSite(req.reportUser);
      if (!userSite && !rdb.userHasRole(req.reportUser, 'admin')) return res.status(403).json({ error: 'Your account has no site assigned for this module. Contact your administrator.' });
      if (userSite && parent.site_code !== userSite) {
        return res.status(403).json({ error: `Action belongs to ${parent.site_code}; you are scoped to ${userSite}` });
      }
      const body = req.body || {};
      await inspectionDb.addActionUpdate(actionId, {
        author_id:     req.reportUser.id || null,
        author_name:   req.reportUser.full_name || req.reportUser.username,
        body:          body.body || '',
        status_change: body.status_change || null,
      });
      res.json({ ok: true });
    } catch(e) {
      console.error('[Inspection] action update error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/inspection/export.xlsx — full-table Excel dump (Inspections /
  // Findings / Actions sheets). admin+ (bulk data export). MUST be registered
  // BEFORE /api/inspection/:id (ids are TEXT → :id would swallow "export.xlsx").
  // Lot 4b: open to an editor, limited to their site (admin tier: every site).
  router.get('/api/inspection/export.xlsx', requireReportSession, async (req, res) => {
    try {
      if (!inspectionDb) return res.status(503).json({ error: 'Inspection module not available' });
      const scope = await _scopeOr403(req, res); if (!scope) return;
      const data = await inspectionDb.exportRows({ site: scope.site });
      const buf = tableExcel.buildWorkbook([
        { name: 'Inspections', rows: data.inspections },
        { name: 'Findings',    rows: data.findings },
        { name: 'Actions',     rows: data.actions },
      ]);
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Inspections_${scope.site || 'full'}_${stamp}.xlsx"`);
      res.send(buf);
    } catch (e) {
      console.error('[Inspection] excel export error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/inspection/:id — full record (header + findings + actions + photos + sigs)
  router.get('/api/inspection/:id', requireReportSession, async (req, res) => {
    try {
      if (!inspectionDb) return res.status(503).json({ error: 'Inspection module not available' });
      const rec = await inspectionDb.getInspection(req.params.id);
      if (!rec) return res.status(404).json({ error: 'Not found' });
      res.json(rec);
    } catch(e) {
      console.error('[Inspection] get error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/inspection/save — upsert. Editors scoped to their own site;
  // admin+ can write any site. Submission-lock RBAC: editors cannot modify a
  // submitted/closed record (admin+ unrestricted).
  router.post('/api/inspection/save', requireReportSession, inspectionJsonBody, async (req, res) => {
    try {
      if (!inspectionDb) return res.status(503).json({ error: 'Inspection module not available' });
      if (!rdb.userHasRole(req.reportUser, 'editor')) {
        return res.status(403).json({ error: 'editor role or higher required' });
      }
      const state = req.body && req.body.state;
      if (!state || !state.meta) return res.status(400).json({ error: 'Missing state.meta in body' });

      // Lot 4b: a submitted / closed inspection may be modified or re-opened by an
      // editor of ITS site (was admin-only). The site of both the incoming form and the
      // stored row is enforced by saveInspection (cross-site → 403 below).

      const userSite = await _userInspectionSite(req.reportUser);
      if (!userSite && !rdb.userHasRole(req.reportUser, 'admin')) return res.status(403).json({ error: 'Your account has no site assigned for this module. Contact your administrator.' });
      const out      = await inspectionDb.saveInspection(state, userSite, req.reportUser.id || null);
      // Audit log — grep-friendly: pm2 logs … | findstr Inspection
      const itemCount  = Object.keys(state.items || {}).length;
      const actCount   = (state.actions || []).length;
      let photoCount = 0;
      Object.values(state.items || {}).forEach(it => {
        if (Array.isArray(it?.photos)) photoCount += it.photos.length;
      });
      const sizeMB = req.headers['content-length']
        ? (parseInt(req.headers['content-length'], 10) / (1024 * 1024)).toFixed(1)
        : '?';
      console.log(`[Inspection] save ok id=${out.id} user=${req.reportUser.username || '?'} site=${state.meta.f_site || '—'} status=${state.status || 'draft'} items=${itemCount} actions=${actCount} photos=${photoCount} size=${sizeMB}MB`);
      res.json({ ok: true, ...out, scope: userSite || 'all', status: state.status || 'draft' });
    } catch(e) {
      console.error('[Inspection] save error:', e.message, '| user=' + (req.reportUser && req.reportUser.username) + ' meta=' + JSON.stringify((req.body && req.body.state && req.body.state.meta) || {}).slice(0, 200));
      const isScope = /Cross-site/i.test(e.message);
      res.status(isScope ? 403 : 500).json({ error: e.message });
    }
  });

  // DELETE /api/inspection/:id — lot 4b: an editor on their own site, admin tier anywhere.
  router.delete('/api/inspection/:id', requireReportSession, async (req, res) => {
    try {
      if (!inspectionDb) return res.status(503).json({ error: 'Inspection module not available' });
      const id = req.params.id;
      const own = await _ownInspectionOr403(req, res, id); if (!own) return;
      // (The audit line used to read getInspectionStatus as a row and always printed "?"/"—".)
      const status = own.head.status || '?', site = own.head.site_code || '—';
      const ok = await inspectionDb.deleteInspection(id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      console.log(`[Inspection] DELETE id=${id} user=${req.reportUser.username || '?'} site=${site} prior_status=${status}`);
      res.json({ ok: true });
    } catch(e) {
      console.error('[Inspection] delete error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/inspection/aggregate/export — roll-up PPTX (executive+).
  // MUST be registered BEFORE /api/inspection/:id/export, otherwise the
  // parametric route swallows it (:id="aggregate" → getInspection('aggregate')
  // → 404 "Not found"). Same route-ordering class as the /actions vs /:id pitfall.
  // Lot 4b: open to an editor, forced to their site (admin tier: any filter).
  router.post('/api/inspection/aggregate/export', requireReportSession, inspectionJsonBody, async (req, res) => {
    try {
      if (!inspectionDb)   return res.status(503).json({ error: 'Inspection module not available' });
      if (!inspectionPptx) return res.status(503).json({ error: 'PPTX module not available' });
      const scope = await _scopeOr403(req, res); if (!scope) return;
      const filters = { ...((req.body && req.body.filters) || {}) };
      if (scope.site) filters.site = scope.site;
      const agg     = await inspectionDb.aggregate(filters);
      const rows    = await inspectionDb.listInspections({ ...filters, limit: 500 });
      const buf     = await inspectionPptx.generateAggregatePptx({ filters, aggregate: agg, rows }, await inspectionDb.loadLookups());
      const tag     = (filters.site || 'GROUP') + '_' + (filters.from || '') + '_' + (filters.to || '');
      res.setHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="Inspections_${tag.replace(/[^A-Za-z0-9_-]/g, '_')}.pptx"`);
      res.send(buf);
    } catch(e) {
      console.error('[Inspection] aggregate export error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/inspection/:id/export — single-inspection PPTX
  // Lot 4b: an editor on their own site, admin tier anywhere.
  router.post('/api/inspection/:id/export', requireReportSession, async (req, res) => {
    try {
      if (!inspectionDb)   return res.status(503).json({ error: 'Inspection module not available' });
      if (!inspectionPptx) return res.status(503).json({ error: 'PPTX module not available' });
      if (!(await _ownInspectionOr403(req, res, req.params.id))) return;
      const rec = await inspectionDb.getInspection(req.params.id);
      if (!rec) return res.status(404).json({ error: 'Not found' });
      const buf = await inspectionPptx.generateInspectionPptx(rec, await inspectionDb.loadLookups());
      const safeId = String(req.params.id).replace(/[^A-Za-z0-9_-]/g, '_');
      res.setHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="Inspection_${safeId}.pptx"`);
      res.send(buf);
    } catch(e) {
      console.error('[Inspection] export error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/inspection/reset — wipe + re-seed lookup tables (super_admin only)
  router.post('/api/inspection/reset', requireReportSession, requireRole('super_admin'), async (req, res) => {
    try {
      if (!inspectionDb) return res.status(503).json({ error: 'Inspection module not available' });
      await inspectionDb.resetLookups();
      res.json({ ok: true, lookups: await inspectionDb.loadLookups() });
    } catch(e) {
      console.error('[Inspection] reset error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
