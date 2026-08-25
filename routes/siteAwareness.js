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

  // siteResolve is PURE/SYNC, but rdb.listSites / listSiteModuleCodes return a **Promise on
  // postgres** (prod). So we PRE-FETCH them here (awaited) and hand siteResolve sync wrappers over
  // the resolved arrays — otherwise `.map` on a Promise throws and every response degrades to the
  // empty fallback (the documented dual-backend sync-vs-async pitfall). Built per request.
  async function siteDeps() {
    const sites = (await rdb.listSites({ includeInactive: false })) || [];
    const meetingsCodes = (typeof rdb.listSiteModuleCodes === 'function' ? (await rdb.listSiteModuleCodes('meetings')) : []) || [];
    return {
      listSites: () => sites,
      listSiteModuleCodes: (m) => (m === 'meetings' ? meetingsCodes : []),
      userHasRole: rdb.userHasRole,
      meetingsSiteCode: meetingsDb ? meetingsDb.siteNameToCode : null,
      inspectionSiteCode: inspectionDb ? inspectionDb.siteNameToCode : rdb.inspectionSiteCode,
      trackerSiteCode: trackerDb ? trackerDb.siteNameToCode : rdb.trackerSiteCode,
    };
  }

  // ── Fleet-view RAG helpers (DISPLAY-only thresholds; grey 'na' when no code/no data) ──
  const _cell = (rag, value) => ({ rag: rag || 'na', value: (value == null ? null : value) });
  // helpdesk: SLA-overdue share of last-30-day created. na when no created.
  function ragHelpdesk(created, sla_overdue) {
    if (!created) return _cell('na', (sla_overdue || 0) + '/' + (created || 0));
    const rate = sla_overdue / created;
    const rag = rate < 0.05 ? 'green' : (rate < 0.15 ? 'amber' : 'red');
    return _cell(rag, sla_overdue + '/' + created);
  }
  // inspections: conformity = ok/(ok+minor+major+critical+opp). na when base 0.
  function ragInspections(findingStatus) {
    const f = { ok: 0, minor: 0, major: 0, critical: 0, opp: 0 };
    for (const r of (Array.isArray(findingStatus) ? findingStatus : [])) {
      const k = String(r.status || '').toLowerCase(); if (k in f) f[k] += Number(r.n) || 0;
    }
    const base = f.ok + f.minor + f.major + f.critical + f.opp;
    if (!base) return _cell('na', null);
    const c = f.ok / base;
    const rag = c >= 0.9 ? 'green' : (c >= 0.75 ? 'amber' : 'red');
    return _cell(rag, Math.round(c * 100) + '%');
  }
  // A site "participates" in meetings iff it has ANY footprint (a PV, an open/high/escalated issue,
  // or a department on the register). An office with a code but no meetings programme has none →
  // it must read 'na' (non applicable), NOT red 0/3 (which would unfairly tank its overall).
  function meetingsFootprint(kpis, departments) {
    const k = kpis || {};
    return (Number(k.pvs_held) || 0) > 0 || (Number(k.open_issues) || 0) > 0 || (Number(k.high_open) || 0) > 0 ||
      (Number(k.escalations_open) || 0) > 0 || (Array.isArray(departments) && departments.length > 0);
  }
  // meetings: PVs held vs department target — 'na' when the site has no meetings footprint.
  function ragMeetings(kpis, departments) {
    if (!meetingsFootprint(kpis, departments)) return _cell('na', null);
    const k = kpis || {};
    const held = Number(k.pvs_held) || 0;
    const target = Number(k.dept_target) || 0;
    const rag = (held >= target && target > 0) ? 'green' : (held >= 1 ? 'amber' : 'red');
    return _cell(rag, held + '/' + target);
  }
  // actions: overdue open actions across the 3 sources.
  function ragActions(overdueCount) {
    const n = Number(overdueCount) || 0;
    const rag = n === 0 ? 'green' : (n <= 2 ? 'amber' : 'red');
    return _cell(rag, n);
  }
  // tracker: ss().avg (0-1) → %.
  function ragTracker(avg) {
    if (avg == null) return _cell('na', null);
    const pct = avg * 100;
    const rag = pct >= 65 ? 'green' : (pct >= 50 ? 'amber' : 'red');
    return _cell(rag, Math.round(pct) + '%');
  }
  // overall roll-up over NON-na cells (green=2/amber=1/red=0). all-na → na.
  function rollupRag(cells) {
    const scored = Object.values(cells).map((c) => c && c.rag)
      .filter((r) => r === 'green' || r === 'amber' || r === 'red')
      .map((r) => (r === 'green' ? 2 : (r === 'amber' ? 1 : 0)));
    if (!scored.length) return 'na';
    const pct = (scored.reduce((a, b) => a + b, 0) / scored.length) / 2;
    return pct >= 0.75 ? 'green' : (pct >= 0.5 ? 'amber' : 'red');
  }

  // The tracker is PER-YEAR and the config's currentMonth is unreliable (prod points at an EMPTY
  // 2027-03 structure while the real scores sit in 2026). So anchor on the CURRENT calendar month
  // and scan BACK to the latest month that actually has SCORED data (avg > 0) for the site — the
  // tracker UI's "last month with data" behaviour (which showed e.g. Jul 2026 = 73%). Starting from
  // "now" also avoids the future 2027 structure entirely. Falls back to the current month if none.
  function latestTrackerPeriod(D, code) {
    const now = new Date();
    let y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
    for (let i = 0; i < 24; i++) {
      try { const s = trackerScore && trackerScore.ss(D, code, y, m); if (s && s.avg > 0) return { yr: y, mo: m, found: true }; } catch (_) {}
      m--; if (m < 1) { m = 12; y--; }
    }
    return { yr: now.getUTCFullYear(), mo: now.getUTCMonth() + 1, found: false };
  }

  function authorizedSiteId(deps, user, requestedRaw) {
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
      const deps = await siteDeps();
      const gate = authorizedSiteId(deps, req.reportUser, req.query.site);
      if (gate.status) return res.status(gate.status).json({ error: 'forbidden' });
      const rs = resolveSite(deps, gate.site_id) || {};
      const isGroup = rdb.userHasRole(req.reportUser, 'group-business') || rdb.userHasRole(req.reportUser, 'executive') || rdb.userHasRole(req.reportUser, 'super_admin');
      res.json({
        site_id: gate.site_id, site_name: rs.site_name || null, is_group_view: !!isGroup,
        authorized_sites: gate.authorized,
        tabs: { fleet: !!isGroup, helpdesk: true, inspections: true, meetings: true, actions: true, tracker: true },
      });
    } catch (_) { res.json({ site_id: null, authorized_sites: [], tabs: { helpdesk: true } }); }
  });

  router.get('/api/site-awareness/helpdesk', requireReportSession, async (req, res) => {
    try {
      const deps = await siteDeps();
      const gate = authorizedSiteId(deps, req.reportUser, req.query.site);
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
      const deps = await siteDeps();
      const gate = authorizedSiteId(deps, req.reportUser, req.query.site);
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
      const deps = await siteDeps();
      const gate = authorizedSiteId(deps, req.reportUser, req.query.site);
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

      // A site with a code but NO meetings footprint (no PV, no issue, no department) isn't part of
      // the departmental-meetings programme → non applicable, not a red "0 PVs" verdict.
      if (!meetingsFootprint(sum.kpis, sum.departments)) return res.json({ applicable: false, site_id: gate.site_id, site_name: rs.site_name || null });

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

  router.get('/api/site-awareness/actions', requireReportSession, async (req, res) => {
    try {
      const deps = await siteDeps();
      const gate = authorizedSiteId(deps, req.reportUser, req.query.site);
      if (gate.status) return res.status(gate.status).json({ error: 'forbidden' });
      const rs = resolveSite(deps, gate.site_id) || {};
      const code = rs.meetings_code;
      // The Site Actions register keys on the MEETINGS namespace code (SMI/MGO/HGO…).
      // No meetings code → the site runs no departmental-meetings/actions programme.
      // Non applicable (never a false 0 — a fabricated register would false-green a site).
      if (!code) return res.json({ applicable: false, site_id: gate.site_id, site_name: rs.site_name || null });

      const { buildSiteActions } = require('../services/siteActionsRegister');
      const asOf = new Date().toISOString().slice(0, 10);

      // Compose the same three sources as /api/reports/site-actions — best-effort,
      // each guarded so a missing reader degrades to an empty list, not a 500.
      const meetings = (meetingsDb && typeof meetingsDb.listActions === 'function' ? await meetingsDb.listActions({ site: code }) : []) || [];
      const inspection = (inspectionDb && typeof inspectionDb.listActions === 'function' ? await inspectionDb.listActions({ site: code }) : []) || [];
      let report = null;
      if (typeof rdb.getSiteIdByModuleCode === 'function') {
        // resolved.site_id (NOT .id) — the documented falsy-id pitfall.
        const resolved = await rdb.getSiteIdByModuleCode('meetings', code);
        if (resolved && resolved.site_id && typeof rdb.getSiteOpenReportActions === 'function') {
          report = { actions: (await rdb.getSiteOpenReportActions(resolved.site_id)).actions };
        }
      }
      const sa = buildSiteActions({ meetings, inspection, report, asOf });

      // buildSiteActions returns { groups:{meetings,inspection,report:{items,count,oldest_days}}, totals:{open} }.
      // Flatten to a single list + derive by_source/total_open/oldest_days for the tab.
      const g = sa.groups || {};
      const grp = (name) => g[name] || { items: [], count: 0, oldest_days: null };
      const flat = [].concat(grp('meetings').items, grp('inspection').items, grp('report').items);
      const oldestVals = ['meetings', 'inspection', 'report'].map((n) => grp(n).oldest_days).filter((v) => v != null);

      // WHITELIST — PII-safe. title/owner/origin_label are internal accountability text (allowed);
      // no requester/technician free-text (the action sources carry none).
      res.json({
        applicable: true, site_id: gate.site_id, site_name: rs.site_name || null,
        snapshot: {
          total_open: (sa.totals && sa.totals.open) || 0,
          by_source: { meetings: grp('meetings').count, inspection: grp('inspection').count, report: grp('report').count },
          oldest_days: oldestVals.length ? Math.max(...oldestVals) : null,
        },
        actions: flat.map((a) => ({
          task: a.title || null,
          source: a.source || null,
          owner: a.owner || null,
          origin: a.origin_label || null,
          age_days: (a.age_days == null ? null : a.age_days),
          overdue: !!a.overdue,
          status: a.status || null,
        })),
      });
    } catch (_) { res.json({ applicable: true, snapshot: null, actions: [] }); }
  });

  router.get('/api/site-awareness/tracker', requireReportSession, async (req, res) => {
    try {
      const deps = await siteDeps();
      const gate = authorizedSiteId(deps, req.reportUser, req.query.site);
      if (gate.status) return res.status(gate.status).json({ error: 'forbidden' });
      const rs = resolveSite(deps, gate.site_id) || {};
      const code = rs.tracker_code;
      // No tracker code → the site isn't on the Activity Tracker programme. Non applicable
      // (never a false 0 — a fabricated scorecard would false-green an unmonitored site).
      if (!code) return res.json({ applicable: false, site_id: gate.site_id, site_name: rs.site_name || null });

      const D = (trackerDb && typeof trackerDb.loadTracker === 'function') ? await trackerDb.loadTracker() : null;
      if (!D || !trackerScore) return res.json({ applicable: false, site_id: gate.site_id, site_name: rs.site_name || null });

      const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const tp = latestTrackerPeriod(D, code);
      // No scored month in the site's history → the site isn't on the Activity Tracker programme
      // (offices aren't) → non applicable, not a red 0% verdict.
      if (!tp.found) return res.json({ applicable: false, site_id: gate.site_id, site_name: rs.site_name || null });
      const yr = tp.yr, mo = tp.mo;   // most recent month WITH data for this site

      // ss().avg is a 0-1 FRACTION → ×100 for %. Previous month rolls the year.
      const cur = trackerScore.ss(D, code, yr, mo) || {};
      const overall_pct = cur.avg != null ? Math.round(cur.avg * 100) : null;
      let pm = mo - 1, py = yr;
      if (pm < 1) { pm = 12; py = yr - 1; }
      const prev = trackerScore.ss(D, code, py, pm) || {};
      const delta_pp = (prev.avg != null && overall_pct != null) ? Math.round(cur.avg * 100 - prev.avg * 100) : null;

      // Pillars — gP() may not be exported (production tracker-pptx exports fleetStats/ps2/ss/score
      // only); fall back to pillarWeights keys. ps2() is a 0-1 fraction too.
      let pillars = [];
      try { pillars = trackerScore.gP(D) || []; } catch (_) {}
      if (!pillars.length && D.pillarWeights) pillars = Object.keys(D.pillarWeights);
      const pillarScores = pillars.map((p) => ({ name: p, pct: Math.round((trackerScore.ps2(D, code, p, yr, mo) || 0) * 100) }));

      // 6-month trend — null months break the line, never a false 0.
      const trend = [];
      for (let i = 5; i >= 0; i--) {
        let mm = mo - i, yy = yr;
        while (mm < 1) { mm += 12; yy--; }
        const v = trackerScore.ss(D, code, yy, mm) || {};
        trend.push({ label: MON[mm - 1] + ' ' + String(yy).slice(2), pct: (v.avg != null ? Math.round(v.avg * 100) : null) });
      }

      // WHITELIST — all numbers, PII-safe (no person/free-text anywhere in the tracker).
      res.json({
        applicable: true, site_id: gate.site_id, site_name: rs.site_name || null,
        period_label: (D && D.currentMonth ? (MON[mo - 1] + ' ' + yr) : null),
        snapshot: { overall_pct, delta_pp, green: cur.g || 0, amber: cur.a || 0, red: cur.r || 0, active: cur.active || 0 },
        pillars: pillarScores, trend,
      });
    } catch (_) { res.json({ applicable: true, snapshot: null, pillars: [], trend: [] }); }
  });

  // ── Fleet (Vue Groupe) — GROUP-only comparative RAG grid: all sites × 5 modules ──
  router.get('/api/site-awareness/fleet', requireReportSession, async (req, res) => {
    try {
      const u = req.reportUser;
      const isGroup = rdb.userHasRole(u, 'group-business') || rdb.userHasRole(u, 'executive') || rdb.userHasRole(u, 'super_admin');
      if (!isGroup) return res.status(403).json({ error: 'forbidden' });

      const deps = await siteDeps();
      const sites = listAuthorizedSites(deps, u);

      // Load the tracker ONCE (shared across all sites); derive the tracker period.
      let D = null;
      try { D = (trackerDb && trackerDb.loadTracker) ? await trackerDb.loadTracker() : null; } catch (_) {}
      const now = new Date();
      // Meetings cadence = the CURRENT calendar month (NOT the tracker config's period, which can be
      // an empty/future 2027-03). Tracker period is resolved per-site (latestTrackerPeriod) below.
      const cy = now.getUTCFullYear(), cm = now.getUTCMonth() + 1;

      const _d = (ms) => new Date(ms).toISOString().slice(0, 10);
      const h1 = _d(Date.now()), h0 = _d(Date.now() - 30 * 86400000);   // helpdesk 30-day
      const i1 = _d(Date.now()), i0 = _d(Date.now() - 90 * 86400000);   // inspections 90-day
      const asOf = _d(Date.now());

      const rows = await Promise.all(sites.map(async (s) => {
        const cells = { helpdesk: _cell('na', null), inspections: _cell('na', null),
          meetings: _cell('na', null), actions: _cell('na', null), tracker: _cell('na', null) };
        let site_name = s.site_name;
        try {
          const rs = resolveSite(deps, s.site_id) || {};
          site_name = rs.site_name || site_name;

          // helpdesk — 30-day SLA-overdue share.
          try {
            const hw = (await rdb.getSiteHelpdeskWindow(s.site_id, h0, h1)) || {};
            cells.helpdesk = ragHelpdesk(hw.created || 0, hw.sla_overdue || 0);
          } catch (_) {}

          // inspections — 90-day conformity.
          try {
            if (rs.inspection_code && inspectionDb && typeof inspectionDb.aggregate === 'function') {
              const agg = (await inspectionDb.aggregate({ site: rs.inspection_code, from: i0, to: i1 })) || {};
              cells.inspections = ragInspections(agg.findingStatus);
            }
          } catch (_) {}

          // meetings — PVs vs target this month.
          try {
            if (rs.meetings_code && meetingsDb && typeof meetingsDb.getSiteMonthlyMeetingSummary === 'function') {
              const sum = (await meetingsDb.getSiteMonthlyMeetingSummary(rs.meetings_code, cy, cm)) || {};
              cells.meetings = ragMeetings(sum.kpis, sum.departments);
            }
          } catch (_) {}

          // actions — overdue open actions across the 3 sources.
          try {
            if (rs.meetings_code) {
              const { buildSiteActions } = require('../services/siteActionsRegister');
              const meetings = (meetingsDb && typeof meetingsDb.listActions === 'function' ? await meetingsDb.listActions({ site: rs.meetings_code }) : []) || [];
              const inspection = (inspectionDb && typeof inspectionDb.listActions === 'function' ? await inspectionDb.listActions({ site: rs.meetings_code }) : []) || [];
              let report = null;
              if (typeof rdb.getSiteIdByModuleCode === 'function') {
                const resolved = await rdb.getSiteIdByModuleCode('meetings', rs.meetings_code);
                if (resolved && resolved.site_id && typeof rdb.getSiteOpenReportActions === 'function') {
                  report = { actions: (await rdb.getSiteOpenReportActions(resolved.site_id)).actions };
                }
              }
              const sa = buildSiteActions({ meetings, inspection, report, asOf });
              const g = sa.groups || {};
              const flat = [].concat((g.meetings || {}).items || [], (g.inspection || {}).items || [], (g.report || {}).items || []);
              cells.actions = ragActions(flat.filter((a) => a && a.overdue).length);
            }
          } catch (_) {}

          // tracker — ss().avg.
          try {
            if (rs.tracker_code && D && trackerScore) {
              const tp = latestTrackerPeriod(D, rs.tracker_code);   // most recent SCORED month
              if (tp.found) {   // no scored month → leave 'na' (site not on the tracker programme)
                const cur = trackerScore.ss(D, rs.tracker_code, tp.yr, tp.mo) || {};
                cells.tracker = ragTracker(cur.avg == null ? null : cur.avg);
              }
            }
          } catch (_) {}
        } catch (_) { /* per-site failure → all-na cells */ }

        return { site_id: s.site_id, site_name: site_name || null, overall_rag: rollupRag(cells), cells };
      }));

      res.json({ sites: rows });
    } catch (_) { res.json({ sites: [] }); }
  });

  // ── Linkage AUDIT (super_admin) — per site × module: resolved code + data presence. Read-only.
  // Lets an admin re-run the cross-module linkage check on prod (which sites resolve which codes,
  // and whether that module actually has data). includeInactive so stale sites (e.g. Wahgnion) show.
  router.get('/api/site-awareness/audit', requireReportSession, async (req, res) => {
    try {
      if (!rdb.userHasRole(req.reportUser, 'super_admin')) return res.status(403).json({ error: 'forbidden' });
      const deps = await siteDeps();
      const sites = (await rdb.listSites({ includeInactive: true })) || [];
      let D = null;
      try { D = (trackerDb && trackerDb.loadTracker) ? await trackerDb.loadTracker() : null; } catch (_) {}
      const now = new Date();
      const cy = now.getUTCFullYear(), cm = now.getUTCMonth() + 1;
      const _d = (ms) => new Date(ms).toISOString().slice(0, 10);
      const from90 = _d(Date.now() - 90 * 86400000), today = _d(Date.now());

      const rows = await Promise.all(sites.map(async (s) => {
        const rs = resolveSite(deps, s.id) || {};
        const out = {
          site_id: s.id, name: s.name, active: !!s.active,
          helpdesk: { group: rs.helpdesk_group || null, tickets_90d: null },
          meetings: { code: rs.meetings_code || null, available: null },
          inspections: { code: rs.inspection_code || null, count: null },
          tracker: { code: rs.tracker_code || null, pct: null, period: null },
        };
        try { const h = await rdb.getSiteHelpdeskWindow(s.id, from90, today); out.helpdesk.tickets_90d = h.created || 0; } catch (_) {}
        try { if (rs.meetings_code && meetingsDb && typeof meetingsDb.getSiteMonthlyMeetingSummary === 'function') { const sum = await meetingsDb.getSiteMonthlyMeetingSummary(rs.meetings_code, cy, cm); out.meetings.available = !!(sum && sum.available); } } catch (_) {}
        try { if (rs.inspection_code && inspectionDb && typeof inspectionDb.aggregate === 'function') { const agg = await inspectionDb.aggregate({ site: rs.inspection_code, from: from90, to: today }); out.inspections.count = (agg.counts && agg.counts.total) || agg.total || 0; } } catch (_) {}
        try {
          if (rs.tracker_code && D && trackerScore) {
            const tp = latestTrackerPeriod(D, rs.tracker_code);
            const ss = trackerScore.ss(D, rs.tracker_code, tp.yr, tp.mo) || {};
            out.tracker.pct = ss.avg != null ? Math.round(ss.avg * 100) : null;
            out.tracker.period = ss.avg > 0 ? (tp.yr + '-' + String(tp.mo).padStart(2, '0')) : null;
          }
        } catch (_) {}
        return out;
      }));
      res.json({ generated_at: today, sites: rows });
    } catch (_) { res.json({ sites: [] }); }
  });

  return router;
};
