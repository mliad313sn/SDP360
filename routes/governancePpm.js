'use strict';
// Plan E wave 2 (W2-PPM) — PPM additions registered on the governance router (routes/governance.js calls this with
// its own helpers, so the access rules are the SAME functions: committee, money-read rule, A-15 read scope, plan writes).
// Every action exists only while its PROPOSED switch is '1' (404 while '0' = today):
//   E-P03 ppm_capacity_view          GET  /api/governance/ppm/capacity                capacity per site × week + conflicts (no money)
//   GET  /api/governance/ppm/features  which of these switches are on (the pages show a tab / panel only then)
// Paths live under /api/governance/ppm/ so they never collide with /portfolio/:kind.
const { fail: httpFail } = require('../services/httpError');

module.exports = function governancePpmRoutes(router, h) {
  const { store, rdb, reportConfig, requireReportSession, viewFor } = h;
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false, ...(e && e.reason ? { code: e.reason } : {}) });
  const cfg = async () => reportConfig.getConfig(rdb().db);
  const on = (c, k) => String(c[k]) === '1';
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });
  void store;

  router.get('/api/governance/ppm/features', requireReportSession, async (req, res) => {
    try {
      const c = await cfg();
      res.json({ ok: true, capacity: on(c, 'ppm_capacity_view') });
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
};
