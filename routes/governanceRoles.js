'use strict';
// ADR-006 — roles, deputies and the escalation matrix as configuration data (migration 035).
//
//   GET  /api/governance/roles                       catalogue + assignments + deputies + matrix + coverage gaps + people   committee | admin
//   GET  /api/governance/roles/events                append-only, hash-chained change history                               committee | admin
//   POST /api/governance/roles/assignments           { role, site_id|null, user_id, effective_from, effective_to?, reason }   super_admin
//   POST /api/governance/roles/assignments/:id/end   { reason }                                                              super_admin
//   POST /api/governance/roles/deputies              { user_id, deputy_id, start_date, end_date, reason }                    admin tier
//   POST /api/governance/roles/deputies/:id/revoke   { reason }                                                              admin tier
//   POST /api/governance/roles/matrix                { register, severity, site_id|null, after_days, role, reason }         super_admin
//   POST /api/governance/roles/matrix/:id/retire     { reason }                                                              super_admin
// Who holds authority is a super_admin decision; standing in for an absent colleague is operational (admin
// tier). A deputy must be active and share a site with the person they replace (or be in the admin tier).
// Empty tables = the behaviour until now.

const { fail: httpFail, typed } = require('../services/httpError');
const R = require('../services/governanceRoles');

function createStore(rdbMod) {
  return require('../services/governanceRolesStore').makeGovernanceRolesStore({ prepare: (sql) => rdbMod.pgHandle().prepare(sql), runTransaction: (fn) => rdbMod.pgHandle().runTransaction(fn) });
}

module.exports = function governanceRoleRoutes(deps) {
  const { express, requireReportSession, store } = deps;
  const router = express.Router();
  const json = express.json({ limit: '16kb' });
  const rdb = () => deps.rdb || require('../reports-db');
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false });
  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const isSuper = (u) => rdb().userHasRole(u, 'super_admin');
  const isCommittee = (u) => isAdmin(u) || rdb().userHasRole(u, 'committee-member');
  const requireCommittee = (req, res, next) => (isCommittee(req.reportUser) ? next() : res.status(403).json({ ok: false, error: 'committee or admin role required' }));
  const requireAdminTier = (req, res, next) => (isAdmin(req.reportUser) ? next() : res.status(403).json({ ok: false, error: 'admin role required' }));
  const requireSuper = (req, res, next) => (isSuper(req.reportUser) ? next() : res.status(403).json({ ok: false, error: 'super_admin role required' }));
  const log = (req, action, target, details) => { try { Promise.resolve(rdb().logEvent({ category: 'governance', action, target: String(target), details, risk: 0, ...rdb()._logCtx(req) })).catch(() => {}); } catch (_) {} };
  const today = () => new Date().toISOString().slice(0, 10);
  const siteIdsOf = (u) => [u.site_id, ...((u.extra_site_ids) || [])].filter((x) => x != null).map(Number);

  async function activeUser(id) {
    const u = ((await rdb().listUsers()) || []).find((x) => Number(x.id) === Number(id));
    if (!u || u.active === 0 || u.active === false) throw typed('VALIDATION', 'no active account with this id', 400);
    return u;
  }

  router.get('/api/governance/roles', requireReportSession, requireCommittee, async (req, res) => {
    try {
      const snap = await store.snapshot();
      const sites = ((await rdb().listSites({ includeInactive: false })) || []).map((s) => ({ id: Number(s.id), name: s.name }));
      const people = ((await rdb().listUsers()) || []).filter((x) => x.active !== 0 && x.active !== false)
        .map((x) => ({ id: Number(x.id), name: x.full_name || x.username, sites: siteIdsOf(x) }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
      res.json({ ok: true, today: today(), can_write_roles: isSuper(req.reportUser), can_write_deputies: isAdmin(req.reportUser),
        roles: R.ROLES, registers: R.REGISTERS, required: R.REQUIRED, deputy_max_days: R.DEPUTY_MAX_DAYS,
        ...snap, gaps: R.coverageGaps(snap, sites, today()), sites, people });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/roles/events', requireReportSession, requireCommittee, async (req, res) => {
    try { res.json({ ok: true, events: await store.events(req.query.limit) }); } catch (e) { fail(res, e); }
  });

  router.post('/api/governance/roles/assignments', requireReportSession, requireSuper, json, async (req, res) => {
    try {
      const b = req.body || {}; await activeUser(b.user_id);
      const id = await store.assign(b, { actorId: req.reportUser.id });
      log(req, 'role_assigned', b.role, { id, site_id: b.site_id == null ? null : Number(b.site_id), user_id: Number(b.user_id) });
      res.status(201).json({ ok: true, id });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/roles/assignments/:id/end', requireReportSession, requireSuper, json, async (req, res) => {
    try { await store.endAssignment(req.params.id, { actorId: req.reportUser.id, reason: (req.body || {}).reason }); log(req, 'role_ended', req.params.id, {}); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });

  router.post('/api/governance/roles/deputies', requireReportSession, requireAdminTier, json, async (req, res) => {
    try {
      const b = req.body || {};
      const c = R.validateDeputy(b); if (c) return res.status(c.status).json({ ok: false, code: c.code, error: c.error });
      const [who, dep] = [await activeUser(b.user_id), await activeUser(b.deputy_id)];
      // a deputy works where the absent person works: shared site, or the admin tier (unscoped anyway)
      if (!isAdmin(dep) && !siteIdsOf(dep).some((s) => siteIdsOf(who).includes(s))) return res.status(400).json({ ok: false, code: 'VALIDATION', error: 'the deputy must work on one of the sites of the person they replace' });
      const id = await store.addDeputy(b, { actorId: req.reportUser.id });
      log(req, 'deputy_named', b.user_id, { id, deputy_id: Number(b.deputy_id), from: b.start_date, to: b.end_date });
      res.status(201).json({ ok: true, id });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/roles/deputies/:id/revoke', requireReportSession, requireAdminTier, json, async (req, res) => {
    try { await store.revokeDeputy(req.params.id, { actorId: req.reportUser.id, reason: (req.body || {}).reason }); log(req, 'deputy_revoked', req.params.id, {}); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });

  router.post('/api/governance/roles/matrix', requireReportSession, requireSuper, json, async (req, res) => {
    try {
      const b = req.body || {}; const id = await store.addMatrixRow(b, { actorId: req.reportUser.id });
      log(req, 'escalation_rule_added', b.register, { id, role: b.role, site_id: b.site_id == null ? null : Number(b.site_id), after_days: Number(b.after_days || 0) });
      res.status(201).json({ ok: true, id });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/roles/matrix/:id/retire', requireReportSession, requireSuper, json, async (req, res) => {
    try { await store.retireMatrixRow(req.params.id, { actorId: req.reportUser.id, reason: (req.body || {}).reason }); log(req, 'escalation_rule_retired', req.params.id, {}); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });
  return router;
};
module.exports.createStore = createStore;
