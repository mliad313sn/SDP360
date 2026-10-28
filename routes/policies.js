'use strict';
// Governance policies — Admin ▸ Governance policies (validation request 2026-10-28).
//
//   GET  /api/governance/policies                 registry + global value + per-site values + effective   committee | admin
//   GET  /api/governance/policies/effective?site= resolved values for one context (who sees which rules)   any session (own sites)
//   PUT  /api/governance/policies                 { scope:'global'|'site:<id>', key, value|null, reason }  admin tier
//                                                 relaxing a PROTECTED rule needs a super_admin + 10-char reason (risk event)
//   GET  /api/governance/policies/history?key=    append-only change history                               committee | admin
//   GET  /policies.html
// The rules, bounds and defaults live in services/governancePolicy.js; nothing here decides a value.

const { fail: httpFail } = require('../services/httpError');

module.exports = function policyRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const json = express.json({ limit: '32kb' });
  const rdb = () => deps.rdb || require('../reports-db');
  const GP = require('../services/governancePolicy');
  const store = () => deps.policyStore || GP.shared();
  const userSites = require('../services/userSites');
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false });
  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const isSuper = (u) => rdb().userHasRole(u, 'super_admin');
  const isCommittee = (u) => isAdmin(u) || rdb().userHasRole(u, 'committee-member');
  const requireCommittee = (req, res, next) => (isCommittee(req.reportUser) ? next() : res.status(403).json({ ok: false, error: 'committee or admin role required' }));
  const requireAdminTier = (req, res, next) => (isAdmin(req.reportUser) ? next() : res.status(403).json({ ok: false, error: 'admin role required' }));

  router.get('/policies.html', (req, res) => deps.sendHtmlPage(res, 'policies.html', false, 'Policies page unavailable'));

  router.get('/api/governance/policies', requireReportSession, requireCommittee, async (req, res) => {
    try {
      const sites = ((await rdb().listSites({ includeInactive: false })) || []).map((s) => ({ id: Number(s.id), name: s.name }));
      res.json({ ok: true, can_write: isAdmin(req.reportUser), is_super: isSuper(req.reportUser), areas: GP.AREAS, sites,
        policies: await store().view({ siteIds: sites.map((s) => s.id) }) });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/policies/effective', requireReportSession, async (req, res) => {
    try {
      const u = req.reportUser; const site = req.query.site == null || req.query.site === '' ? null : Number(req.query.site);
      if (site != null && !isAdmin(u) && !userSites.hasSite(u, site)) return res.status(403).json({ ok: false, error: 'site not in your scope' });
      res.json({ ok: true, site, values: await store().snapshot({ siteId: site }) });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/policies', requireReportSession, requireAdminTier, json, async (req, res) => {
    try {
      const b = req.body || {}; const u = req.reportUser;
      const out = await store().set({ scope: String(b.scope || 'global'), key: String(b.key || ''), value: b.value === undefined ? null : b.value, reason: b.reason,
        actor: { id: u.id, isAdmin: isAdmin(u), isSuper: isSuper(u) } });
      try { rdb().logEvent({ category: 'governance', action: out.relaxes ? 'policy_relaxed' : 'policy_changed', target: `${out.scope}:${out.key}`, details: { before: out.before, after: out.after, reason: String(b.reason || '').slice(0, 300) }, risk: out.relaxes ? 1 : 0, ...rdb()._logCtx(req) }); } catch (_) {}
      res.json({ ok: true, change: out });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/policies/history', requireReportSession, requireCommittee, async (req, res) => {
    try { res.json({ ok: true, history: await store().history({ key: req.query.key || null, limit: req.query.limit }) }); } catch (e) { fail(res, e); }
  });
  return router;
};
