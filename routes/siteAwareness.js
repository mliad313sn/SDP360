'use strict';
// Site Awareness — read-only, per-site business view. Scoping is server-enforced: a site-business
// user's site comes from the SESSION, never the request. PII-safe: every field is whitelisted
// (the exec-view pattern) — no requester/technician/subject names leave the server.
const { resolveSite, listAuthorizedSites } = require('../services/siteResolve');

module.exports = function siteAwarenessRoutes({ express, requireReportSession, rdb }) {
  const router = express.Router();
  const deps = { listSites: rdb.listSites, listSiteModuleCodes: rdb.listSiteModuleCodes, userHasRole: rdb.userHasRole,
                 inspectionSiteCode: rdb.inspectionSiteCode, trackerSiteCode: rdb.trackerSiteCode };

  function authorizedSiteId(user, requestedRaw) {
    const authorized = listAuthorizedSites(deps, user);
    if (!authorized.length) return { status: 403 };
    const ids = new Set(authorized.map((s) => s.site_id));
    const isGroup = rdb.userHasRole(user, 'group-business') || rdb.userHasRole(user, 'executive') || rdb.userHasRole(user, 'super_admin');
    const requested = requestedRaw != null && requestedRaw !== '' ? Number(requestedRaw) : null;
    if (isGroup) return { site_id: (requested != null && ids.has(requested)) ? requested : authorized[0].site_id, authorized };
    if (requested != null && requested !== authorized[0].site_id) return { status: 403 };
    return { site_id: authorized[0].site_id, authorized };
  }

  router.get('/api/site-awareness/summary', requireReportSession, async (req, res) => {
    try {
      const gate = authorizedSiteId(req.reportUser, req.query.site);
      if (gate.status) return res.status(gate.status).json({ error: 'forbidden' });
      const rs = resolveSite(deps, gate.site_id) || {};
      const isGroup = rdb.userHasRole(req.reportUser, 'group-business') || rdb.userHasRole(req.reportUser, 'executive') || rdb.userHasRole(req.reportUser, 'super_admin');
      res.json({
        site_id: gate.site_id, site_name: rs.site_name || null, is_group_view: !!isGroup,
        authorized_sites: gate.authorized,
        tabs: { helpdesk: true, inspections: false, meetings: false, actions: false, tracker: false },
      });
    } catch (_) { res.json({ site_id: null, authorized_sites: [], tabs: { helpdesk: true } }); }
  });

  router.get('/api/site-awareness/helpdesk', requireReportSession, async (req, res) => {
    try {
      const gate = authorizedSiteId(req.reportUser, req.query.site);
      if (gate.status) return res.status(gate.status).json({ error: 'forbidden' });
      const rs = resolveSite(deps, gate.site_id) || {};
      const now = new Date();
      const mEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      const mStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
      const snap = await rdb.getSiteHelpdeskWindow(gate.site_id, mStart, mEnd);

      const { _lastIsoWeeks } = require('../services/siteReportDeps');
      const weekly = [];
      // _lastIsoWeeks expects a BARE 'YYYY-MM-DD' — a full ISO timestamp throws Invalid Date.
      for (const w of _lastIsoWeeks(now.toISOString().slice(0, 10), 6)) {
        const h = await rdb.getSiteHelpdeskWindow(gate.site_id, w.from, w.to);
        weekly.push({ label: w.label, inbound: h.created, closed: h.resolved,
          missed_pct: h.created ? Math.round((h.sla_overdue / h.created) * 1000) / 10 : null });
      }

      const groups = String(rs.helpdesk_group || '').split(',').map((g) => g.trim()).filter(Boolean);
      const miRaw = (groups.length ? await rdb.getActiveMajorIncidentsForSite(groups) : []) || [];
      const major_incidents = miRaw.map((m) => ({ id: m.id, status: m.status || null, created_time: m.created_time || null, p_label: m['P-Label'] || null }));

      res.json({
        applicable: true, site_id: gate.site_id, site_name: rs.site_name || null,
        snapshot: { created: snap.created, resolved: snap.resolved, backlog: snap.backlog,
          sla_overdue: snap.sla_overdue, major_incidents: snap.major_incidents,
          top_categories: snap.top_categories || [] },
        weekly, major_incidents,
      });
    } catch (_) { res.json({ applicable: true, snapshot: null, weekly: [], major_incidents: [] }); }
  });

  return router;
};
