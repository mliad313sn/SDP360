'use strict';
// Site Awareness — read-only, per-site business view. Scoping is server-enforced: a site-business
// user's site comes from the SESSION, never the request. PII-safe: every field is whitelisted
// (the exec-view pattern) — no requester/technician/subject names leave the server.
const { resolveSite, listAuthorizedSites } = require('../services/siteResolve');

module.exports = function siteAwarenessRoutes({ express, requireReportSession, rdb, meetingsDb, inspectionDb, trackerDb, trackerScore }) {
  const router = express.Router();
  // Module DBs are injected (SP2). inspection/tracker site CODES come from THOSE modules'
  // own name→code maps (siteNameToCode), NOT rdb — reports-db has no such function.
  meetingsDb = meetingsDb || null; inspectionDb = inspectionDb || null; trackerDb = trackerDb || null; trackerScore = trackerScore || null;
  const deps = { listSites: rdb.listSites, listSiteModuleCodes: rdb.listSiteModuleCodes, userHasRole: rdb.userHasRole,
                 inspectionSiteCode: inspectionDb ? inspectionDb.siteNameToCode : rdb.inspectionSiteCode,
                 trackerSiteCode: trackerDb ? trackerDb.siteNameToCode : rdb.trackerSiteCode };

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
        tabs: { helpdesk: true, inspections: true, meetings: true, actions: false, tracker: false },
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

      // Changes — a 90-day window (low volume; the house convention). Counts only, PII-safe.
      const _d = (ms) => new Date(ms).toISOString().slice(0, 10);
      const c1 = _d(Date.now());
      const c0 = _d(Date.now() - 90 * 86400000);
      const chg = (typeof rdb.getSiteChangesWindow === 'function'
        ? (await rdb.getSiteChangesWindow(gate.site_id, c0, c1)) : null) || {};

      res.json({
        applicable: true, site_id: gate.site_id, site_name: rs.site_name || null,
        snapshot: { created: snap.created, resolved: snap.resolved, backlog: snap.backlog,
          sla_overdue: snap.sla_overdue, major_incidents: snap.major_incidents,
          top_categories: snap.top_categories || [] },
        weekly, major_incidents,
        changes: { total: chg.total || 0, executed: chg.executed || 0, successful: chg.successful || 0,
          failed: chg.failed || 0, cancelled: chg.cancelled || 0, pending: chg.pending || 0,
          emergency: chg.emergency || 0, success_pct: (chg.success_pct == null ? null : chg.success_pct), window_days: 90 },
      });
    } catch (_) { res.json({ applicable: true, snapshot: null, weekly: [], major_incidents: [] }); }
  });

  router.get('/api/site-awareness/inspections', requireReportSession, async (req, res) => {
    try {
      const gate = authorizedSiteId(req.reportUser, req.query.site);
      if (gate.status) return res.status(gate.status).json({ error: 'forbidden' });
      const rs = resolveSite(deps, gate.site_id) || {};
      const code = rs.inspection_code;
      // No inspection code → the site has no facilities-inspection programme. Non applicable
      // (never a false 0 — a fabricated conformity would false-green an unmonitored site).
      if (!code) return res.json({ applicable: false, site_id: gate.site_id, site_name: rs.site_name || null });

      // 90-day window (house convention, mirrors the changes block).
      const _d = (ms) => new Date(ms).toISOString().slice(0, 10);
      const to = _d(Date.now());
      const from = _d(Date.now() - 90 * 86400000);

      const agg = (inspectionDb && typeof inspectionDb.aggregate === 'function'
        ? await inspectionDb.aggregate({ site: code, from, to }) : {}) || {};
      const recent = (inspectionDb && typeof inspectionDb.listInspections === 'function'
        ? await inspectionDb.listInspections({ site: code, limit: 5 }) : []) || [];
      const acts = (inspectionDb && typeof inspectionDb.listActions === 'function'
        ? await inspectionDb.listActions({ site: code }) : []) || [];

      // Conformity % = ok findings / (all findings EXCLUDING 'na'). null when the applicable
      // base is 0 — never a false 0. findingStatus is [{status, n}], status ∈ ok/minor/major/critical/opp/na.
      const fs = Array.isArray(agg.findingStatus) ? agg.findingStatus : [];
      const findings = { ok: 0, minor: 0, major: 0, critical: 0, opp: 0, na: 0 };
      for (const r of fs) { const k = String(r.status || '').toLowerCase(); if (k in findings) findings[k] += Number(r.n) || 0; }
      const base = findings.ok + findings.minor + findings.major + findings.critical + findings.opp;
      const conformity_pct = base > 0 ? Math.round((findings.ok / base) * 1000) / 10 : null;

      // Open corrective actions — non-terminal (exclude Closed/Cancelled, the aggregate's own vocabulary).
      const _term = (s) => { const t = String(s || '').toLowerCase(); return t === 'closed' || t === 'cancelled'; };
      const openActs = acts.filter((a) => !_term(a.status));

      const counts = agg.counts || {};
      res.json({
        applicable: true, site_id: gate.site_id, site_name: rs.site_name || null,
        snapshot: {
          conformity_pct,
          inspections: (counts.total != null ? counts.total : (agg.total || 0)),
          critical: (counts.critical_count != null ? counts.critical_count : (agg.critical_count || 0)),
          open_actions: openActs.length,
        },
        findings,
        recent: recent.map((r) => ({ id: r.id, date: r.inspection_date || null,
          area: r.area_text || r.area_code || null, risk: r.overall_risk || null, status: r.status || null })),
        // owner = internal staff accountability (allowed). No requester/technician free-text — inspections carry none.
        open_actions: openActs.map((a) => ({ id: a.id, description: a.description || null, priority: a.priority || null,
          due_date: a.due_date || null, owner: a.owner || null, status: a.status || null })),
      });
    } catch (_) { res.json({ applicable: true, snapshot: null, findings: {}, recent: [], open_actions: [] }); }
  });

  router.get('/api/site-awareness/meetings', requireReportSession, async (req, res) => {
    try {
      const gate = authorizedSiteId(req.reportUser, req.query.site);
      if (gate.status) return res.status(gate.status).json({ error: 'forbidden' });
      const rs = resolveSite(deps, gate.site_id) || {};
      const code = rs.meetings_code;
      // No meetings code → the site runs no departmental-meetings programme. Non applicable
      // (never a false 0 — a fabricated cadence would false-green an unmonitored site).
      if (!code) return res.json({ applicable: false, site_id: gate.site_id, site_name: rs.site_name || null });

      // Current calendar month (the reader's cadence window).
      const now = new Date();
      const y = now.getUTCFullYear();
      const mo = now.getUTCMonth() + 1;
      const sum = (meetingsDb && typeof meetingsDb.getSiteMonthlyMeetingSummary === 'function'
        ? await meetingsDb.getSiteMonthlyMeetingSummary(code, y, mo) : {}) || {};

      // Whitelist: kpis are all counts (PII-safe); departments carry a dept name + status;
      // commentary is an auto-generated justification string. No requester/technician free-text.
      const k = sum.kpis || {};
      res.json({
        applicable: true, site_id: gate.site_id, site_name: rs.site_name || null,
        month_label: sum.month_label || null,
        snapshot: {
          pvs: k.pvs_held || 0,
          dept_target: (k.dept_target != null ? k.dept_target : (k.depts_with_pv != null ? k.depts_with_pv : null)),
          open: k.open_issues || 0,
          high_open: k.high_open || 0,
          escalations: k.escalations_open || 0,
          resolved: k.resolved_month || 0,
          new: k.new_month || 0,
        },
        departments: (Array.isArray(sum.departments) ? sum.departments : []).map((d) => ({ department: d.department || null, status: d.status || null })),
        trend: { months: (sum.trend && sum.trend.months) || [], opened: (sum.trend && sum.trend.opened) || [], closed: (sum.trend && sum.trend.closed) || [] },
        commentary: sum.commentary || null,
      });
    } catch (_) { res.json({ applicable: true, snapshot: null, departments: [], trend: { months: [], opened: [], closed: [] } }); }
  });

  return router;
};
