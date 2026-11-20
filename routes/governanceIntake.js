'use strict';
// PORTFOLIO LOT 1 (IT portfolio reconstruction spec §4, §19) — registered by routes/governance.js on the governance
// router. Every action exists only while report_config ppm_intake_register_enabled = '1' (PROPOSED; 404 while '0' =
// today). ADR: docs/ai-decisions/ADR-PORTFOLIO-LOT1-intake-register.md.
//   GET  /api/governance/intake/catalogue                      any session: field guidance (EN + FR), sections, value
//                                                               states, the ACTIVE reference-list values per list
//   GET  /api/governance/intake/lookups                        admin tier: every value incl. retired + live usage count
//   PUT  /api/governance/intake/lookups/:domain                admin tier: create (new code) or update a value
//   POST /api/governance/intake/lookups/:domain/:code/retire   admin tier: soft retire (never a physical delete)
//   POST /api/governance/intake/lookups/:domain/:code/restore  admin tier
//   PUT  /api/governance/intake/lookups/:domain/order          admin tier: {codes:[…]} new display order
// The project fields themselves are written through the existing PUT /api/governance/portfolio/project (committee
// only — who may create or edit a project is NOT widened here).
const { fail: httpFail } = require('../services/httpError');
const LK = require('../services/ppm/portfolioLookups');
const IF = require('../services/ppm/intakeFields');

module.exports = function governanceIntakeRoutes(router, h) {
  const { rdb, reportConfig, requireReportSession, json, isAdmin, log } = h;
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false, ...(e && e.reason ? { code: e.reason } : {}) });
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });
  const sw = async (req, res, next) => {
    try { if (String((await reportConfig.getConfig(rdb().db)).ppm_intake_register_enabled) === '1') return next(); return notFound(res); } catch (e) { return fail(res, e); }
  };
  const requireAdminTier = (req, res, next) => (isAdmin(req.reportUser) ? next() : httpFail(res, new Error('admin role required'), 403, { ok: false }));
  requireAdminTier.legacyRoles = ['admin'];   // C-17 capability catalogue tag
  const store = () => LK.makeLookupStore(rdb().pgHandle());
  const domainOk = (req, res) => { if (LK.DOMAINS.includes(req.params.domain)) return true; httpFail(res, Object.assign(new Error('unknown reference list'), { reason: 'LOOKUP_DOMAIN' }), 404, { ok: false, code: 'LOOKUP_DOMAIN' }); return false; };

  router.get('/api/governance/intake/catalogue', requireReportSession, sw, async (req, res) => {
    try {
      res.json({ ok: true, proposed: true, fields: IF.GUIDE, sections: IF.SECTIONS, value_states: IF.STATES, state_fields: IF.STATE_FIELDS, none_known_only: IF.NONE_KNOWN_ONLY,
        business_need_parts: IF.NEED_PARTS, lookups: await store().byDomain(), colors: LK.COLORS, can_admin_lookups: !!isAdmin(req.reportUser) });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/intake/lookups', requireReportSession, sw, requireAdminTier, async (req, res) => {
    try {
      const s = store(); const all = await s.byDomain({ includeRetired: true });
      for (const d of Object.keys(all)) for (const v of all[d]) v.referenced_by = await s.referencedCount(d, v.code);
      res.json({ ok: true, domains: LK.DOMAINS, locked: LK.LOCKED, colors: LK.COLORS, lookups: all });
    } catch (e) { fail(res, e); }
  });
  // registered before /:domain so "order" is never read as a code-less save
  router.put('/api/governance/intake/lookups/:domain/order', requireReportSession, sw, requireAdminTier, json, async (req, res) => {
    try { if (!domainOk(req, res)) return; const values = await store().reorder(req.params.domain, req.body && req.body.codes, { user: req.reportUser }); log(req, 'portfolio_lookup_reordered', req.params.domain); res.json({ ok: true, values }); }
    catch (e) { fail(res, e); }
  });
  router.put('/api/governance/intake/lookups/:domain', requireReportSession, sw, requireAdminTier, json, async (req, res) => {
    try { if (!domainOk(req, res)) return; const value = await store().save(req.params.domain, req.body || {}, { user: req.reportUser }); log(req, 'portfolio_lookup_saved', `${req.params.domain}:${value.code}`); res.json({ ok: true, value }); }
    catch (e) { fail(res, e); }
  });
  for (const op of ['retire', 'restore']) {
    router.post(`/api/governance/intake/lookups/:domain/:code/${op}`, requireReportSession, sw, requireAdminTier, json, async (req, res) => {
      try {
        if (!domainOk(req, res)) return;
        const out = await store()[op](req.params.domain, req.params.code, { user: req.reportUser });
        log(req, `portfolio_lookup_${op}d`, `${req.params.domain}:${req.params.code}`);
        res.json({ ok: true, ...(op === 'retire' ? out : { value: out }) });
      } catch (e) { fail(res, e); }
    });
  }
};
