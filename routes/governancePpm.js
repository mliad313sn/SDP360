'use strict';
// Plan E wave 2 (W2-PPM) — PPM additions registered on the governance router (routes/governance.js calls this with
// its own helpers, so the access rules are the SAME functions: committee, money-read rule, A-15 read scope, plan writes).
// Every action exists only while its PROPOSED switch is '1' (404 while '0' = today):
//   E-P03 ppm_capacity_view          GET  /api/governance/ppm/capacity                capacity per site × week + conflicts (no money)
//   E-P04 ppm_budget_periods_enabled GET/PUT /api/governance/ppm/project/:id/budget-periods  money readers / committee
//   E-P05 benefit_owner_link_enabled  (PUT /portfolio/benefit accepts owner_user_id; GET /api/me/work lists owned benefits)
//   GET  /api/governance/ppm/features  which of these switches are on (the pages show a tab / panel only then)
// Paths live under /api/governance/ppm/ so they never collide with /portfolio/:kind.
const { fail: httpFail } = require('../services/httpError');

module.exports = function governancePpmRoutes(router, h) {
  const { store, rdb, reportConfig, requireReportSession, json, viewFor, isCommittee, canSeeMoney, readableProject, log } = h;
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false, ...(e && e.reason ? { code: e.reason } : {}) });
  const cfg = async () => reportConfig.getConfig(rdb().db);
  const on = (c, k) => String(c[k]) === '1';
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });
  const forbidden = (res, msg, code) => httpFail(res, Object.assign(new Error(msg), { reason: code }), 403, { ok: false, ...(code ? { code } : {}) });

  router.get('/api/governance/ppm/features', requireReportSession, async (req, res) => {
    try {
      const c = await cfg();
      res.json({ ok: true, capacity: on(c, 'ppm_capacity_view'), budget_periods: on(c, 'ppm_budget_periods_enabled'), benefit_owner_link: on(c, 'benefit_owner_link_enabled') });
    } catch (e) { fail(res, e); }
  });

  // ---- E-P03 capacity per site and week (no money, the reader's scoped portfolio) -------------------------------
  router.get('/api/governance/ppm/capacity', requireReportSession, async (req, res) => {
    try {
      if (!on(await cfg(), 'ppm_capacity_view')) return notFound(res);
      const PV = require('../public/lib/ppmVisuals');
      const { v } = await viewFor(req.reportUser);
      const capacity = PV.capacityBySite(v.tasks || [], (v.projects || []).map((p) => ({ id: p.id, site_id: p.site_id })), { today: new Date().toISOString().slice(0, 10) });
      const site_names = {};
      for (const s of (await rdb().listSites({ includeInactive: true })) || []) site_names[String(s.id)] = s.name;
      res.json({ ok: true, capacity, site_names, as_of: new Date().toISOString() });
    } catch (e) { fail(res, e); }
  });

  // ---- E-P04 budget periods (money rule unchanged: committee, admin tier, finance-viewer read; the committee writes) --
  const BP = require('../services/ppmBudgetPeriods');
  router.get('/api/governance/ppm/project/:id/budget-periods', requireReportSession, async (req, res) => {
    try {
      if (!on(await cfg(), 'ppm_budget_periods_enabled')) return notFound(res);
      if (!(await readableProject(req.reportUser, req.params.id))) return notFound(res);
      if (!canSeeMoney(req.reportUser)) return res.json({ ok: true, money_hidden: true, view: null, certification: BP.CERTIFICATION });
      const view = BP.view(await store.listBudgetPeriods(req.params.id), { asOf: new Date().toISOString() });
      res.json({ ok: true, money_hidden: false, can_edit: !!isCommittee(req.reportUser), view, certification: BP.CERTIFICATION });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/project/:id/budget-periods', requireReportSession, json, async (req, res) => {
    try {
      if (!on(await cfg(), 'ppm_budget_periods_enabled')) return notFound(res);
      if (!isCommittee(req.reportUser)) return forbidden(res, 'committee-member or admin role required');
      if (!(await readableProject(req.reportUser, req.params.id))) return notFound(res);
      const rows = await store.saveBudgetPeriod(req.params.id, req.body || {}, { user: req.reportUser });
      log(req, 'budget_period_saved', `project:${req.params.id}`, { kind: req.body && req.body.kind, period: req.body && req.body.period, currency: req.body && req.body.currency });
      res.json({ ok: true, view: BP.view(rows, { asOf: new Date().toISOString() }), certification: BP.CERTIFICATION });
    } catch (e) { fail(res, e); }
  });
};
