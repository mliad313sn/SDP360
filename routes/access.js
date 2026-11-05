'use strict';
const { fail, typed } = require('../services/httpError');
// C-17 / C-18 (G37 G38 G39 G40 G42 G50 G51 · A02 A03 A07 A09) — access self-service and approvals.
//   GET  /api/access/me/why?cap=<id> | ?need=<role|role>         why a page/capability is refused (C-17)       session
//   GET  /api/access/me                                          my roles, sites, live grants (+expiry), my requests, deputies   session
//   GET  /api/access/templates                                   published templates (super_admin: drafts + retired too)          session
//   POST /api/access/templates                                   { key, title_en, title_fr, intended_position }                  super_admin
//   POST /api/access/templates/:id/versions                      { roles[], site_rule, max_days } → draft                       super_admin
//   PUT  /api/access/templates/versions/:vid                     edit a DRAFT (a published version is immutable)                super_admin
//   POST /api/access/templates/versions/:vid/publish                                                                          super_admin
//   POST /api/access/templates/:id/retire                                                                                      super_admin
//   POST /api/access/requests                                    { subject_user_id?, template_version_id?, roles[], site_ids[], valid_from, valid_to, justification }
//                                                                for yourself: any session; for someone else: admin tier
//   GET  /api/access/requests/:id                                subject, requester, super_admin or an R7 approver (with history)
//   POST /api/access/requests/:id/{review,approve,reject,revoke} { reason } — rules in services/accessRequestLifecycle.js
//   GET  /api/access/approvals                                   requests the caller may decide now (R7: super_admin, or admin tier holding the site)
// Every error goes through httpError.fail. Answers about another user are never served to a plain session.
module.exports = function accessRoutes(deps) {
  const { express, requireReportSession } = deps;
  const router = express.Router();
  const json = express.json({ limit: '16kb' });
  const authz = () => deps.authz || require('../services/authorizationService');
  const rdb = () => deps.rdb || require('../reports-db');
  const store = () => deps.store || (deps._store = deps._store || require('../services/accessStore').forRdb(rdb()));
  const clean = (s, max) => String(s == null ? '' : s).replace(/[^\w.\-|]/g, '').slice(0, max);
  const isSuper = (u) => rdb().userHasRole(u, 'super_admin');
  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const requireSuper = (req, res, next) => (isSuper(req.reportUser) ? next() : fail(res, typed('FORBIDDEN', 'super_admin role required')));
  requireSuper.legacyRoles = ['super_admin'];   // C-17 tag → capability platform.identity.manage
  const log = (req, action, target, details, risk = 0) => { try { Promise.resolve(rdb().logEvent({ category: 'identity', action, target: String(target), details, risk, ...rdb()._logCtx(req) })).catch(() => {}); } catch (_) {} };

  router.get('/api/access/me/why', requireReportSession, (req, res) => {
    try {
      const cap = clean(req.query.cap, 80) || null;
      const need = clean(req.query.need, 160).split('|').filter(Boolean);
      if (!cap && !need.length) return fail(res, typed('VALIDATION', 'cap or need is required'));
      res.json({ ok: true, ...authz().why(req.reportUser, { cap, need }) });
    } catch (e) { fail(res, e); }
  });

  router.get('/api/access/me', requireReportSession, async (req, res) => {
    try {
      const u = req.reportUser; const s = store();
      const grants = await s.liveGrants(u.id);
      const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
      res.json({ ok: true, user: { id: Number(u.id), username: u.username, full_name: u.full_name, roles: u.roles || [], site_ids: u.site_ids || (u.site_id != null ? [u.site_id] : []) },
        grants, expiring_soon: grants.filter((g) => g.valid_to <= soon), requests: await s.requestsFor(u.id), deputies: await s.deputiesOf(u.id),
        can_approve: isAdmin(u), can_manage_templates: isSuper(u), can_request_for_others: isAdmin(u) });
    } catch (e) { fail(res, e); }
  });

  // ── templates ─────────────────────────────────────────────────────
  router.get('/api/access/templates', requireReportSession, async (req, res) => {
    try { res.json({ ok: true, templates: await store().listTemplates({ includeDrafts: isSuper(req.reportUser) }) }); } catch (e) { fail(res, e); }
  });
  router.post('/api/access/templates', requireReportSession, requireSuper, json, async (req, res) => {
    try { const id = await store().createTemplate(req.body, { actorId: req.reportUser.id }); log(req, 'access_template_created', id, { key: (req.body || {}).key }); res.status(201).json({ ok: true, id }); } catch (e) { fail(res, e); }
  });
  router.post('/api/access/templates/:id/versions', requireReportSession, requireSuper, json, async (req, res) => {
    try { const id = await store().addVersion(req.params.id, req.body, { actorId: req.reportUser.id }); res.status(201).json({ ok: true, id }); } catch (e) { fail(res, e); }
  });
  router.put('/api/access/templates/versions/:vid', requireReportSession, requireSuper, json, async (req, res) => {
    try { await store().updateDraft(req.params.vid, req.body); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });
  router.post('/api/access/templates/versions/:vid/publish', requireReportSession, requireSuper, async (req, res) => {
    try { await store().publish(req.params.vid, { actorId: req.reportUser.id }); log(req, 'access_template_published', req.params.vid, {}); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });
  router.post('/api/access/templates/:id/retire', requireReportSession, requireSuper, async (req, res) => {
    try { await store().retire(req.params.id, { actorId: req.reportUser.id }); log(req, 'access_template_retired', req.params.id, {}); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });

  // ── requests ──────────────────────────────────────────────────────
  router.post('/api/access/requests', requireReportSession, json, async (req, res) => {
    try {
      const b = { ...(req.body || {}) };
      const me = Number(req.reportUser.id);
      if (b.subject_user_id == null || b.subject_user_id === '') b.subject_user_id = me;
      if (Number(b.subject_user_id) !== me && !isAdmin(req.reportUser)) return fail(res, typed('FORBIDDEN', 'only the admin tier may request access for someone else'));
      const id = await store().createRequest(b, { actorId: me });
      log(req, 'access_requested', id, { subject: Number(b.subject_user_id) });
      res.status(201).json({ ok: true, id });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/access/requests/:id', requireReportSession, async (req, res) => {
    try {
      const r = await store().getRequest(req.params.id);
      const me = Number(req.reportUser.id);
      const mayDecide = r && isAdmin(req.reportUser) && (await store().approverCtx(r, req.reportUser)).isApprover;
      if (!r || (r.subject_user_id !== me && r.requested_by !== me && !isSuper(req.reportUser) && !mayDecide)) return fail(res, typed('NOT_FOUND', 'request not found'));
      res.json({ ok: true, request: r, events: await store().events(r.id) });
    } catch (e) { fail(res, e); }
  });
  for (const action of ['review', 'approve', 'reject', 'revoke']) {
    router.post(`/api/access/requests/:id/${action}`, requireReportSession, json, async (req, res) => {
      try {
        const out = await store().decide(req.params.id, action, req.reportUser, { reason: (req.body || {}).reason });   // approver rule R7 inside the store
        log(req, 'access_request_' + action, req.params.id, { status: out.status }, action === 'revoke' ? 1 : 0);
        res.json({ ok: true, ...out });
      } catch (e) { fail(res, e); }
    });
  }
  router.get('/api/access/approvals', requireReportSession, async (req, res) => {
    try { res.json({ ok: true, requests: isAdmin(req.reportUser) ? await store().approvalsFor(req.reportUser) : [] }); } catch (e) { fail(res, e); }
  });
  require('./qualifications')(deps, router);   // C-19 qualification evidence, same router
  return router;
};
