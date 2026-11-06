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
//   C-22 emergency access (404 while report_config emergency_access_enabled = '0'), all super_admin:
//   GET  /api/access/emergencies[?overdue=1]                     emergency grants (live, ended), review state; ends those past their hour
//   GET  /api/access/emergencies/overdue                         reviews overdue (more than 2 working days)
//   POST /api/access/emergencies                                 { subject_user_id, roles[], site_ids[], hours ≤ 24, reason } — never to yourself
//   POST /api/access/emergencies/:id/review                      { outcome: justified|not_justified, notes } — not the granter, not the beneficiary
//   E-S03 access recertification (404 while report_config access_recert_enabled = '0'):
//   GET  /api/access/recert/campaigns                            campaigns + progress                                          super_admin
//   POST /api/access/recert/campaigns                            { title, scope_site_id? } → lines account × role / site        super_admin
//   GET  /api/access/recert/campaigns/:id                        super_admin: every line; another approver: the lines assigned to them
//   POST /api/access/recert/campaigns/:id/close                                                                               super_admin
//   GET  /api/access/recert/orphans                              no sign-in for N days · editor without site · inactive site · role no template grants   super_admin
//   GET  /api/access/recert/mine                                 open lines assigned to me                                     session
//   POST /api/access/recert/lines/:id/answer                     { answer: keep|revoke|unknown, reason } — R7 approver, never the subject;
//                                                                revoke applied only when access_recert_apply = '1'
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
  const cfg = async () => (deps.getConfig ? deps.getConfig() : require('../services/reportConfig').getConfig(rdb().db));
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
        can_approve: isAdmin(u), can_manage_templates: isSuper(u), can_request_for_others: isAdmin(u),
        emergency_enabled: isSuper(u) ? !!(await em().enabled()) : false,
        recert_enabled: String((await cfg()).access_recert_enabled) === '1' });   // E-S03: the page shows the Recertification tab only when on   // C-23: the page asks the emergency list only when it exists for the caller
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
  // ── C-22 emergency access ─────────────────────────────────────────
  const em = () => deps.emergencyStore || (deps._em = deps._em || require('../services/emergencyAccessStore').forRdb(rdb()));
  const emOn = async (req, res, next) => { try { return (await em().enabled()) ? next() : fail(res, typed('NOT_FOUND', 'emergency access is not enabled')); } catch (e) { fail(res, e); } };
  router.get('/api/access/emergencies/overdue', requireReportSession, requireSuper, emOn, async (req, res) => {
    try { await em().expireDue({ actorId: null }); res.json({ ok: true, emergencies: await em().list({ overdueOnly: true }) }); } catch (e) { fail(res, e); }
  });
  router.get('/api/access/emergencies', requireReportSession, requireSuper, emOn, async (req, res) => {
    try { await em().expireDue({ actorId: null }); res.json({ ok: true, emergencies: await em().list({ overdueOnly: req.query.overdue === '1' }), max_hours: 24, review_working_days: 2 }); } catch (e) { fail(res, e); }
  });
  router.post('/api/access/emergencies', requireReportSession, requireSuper, emOn, json, async (req, res) => {
    try { const out = await em().grant(req.body, req.reportUser); res.status(201).json({ ok: true, ...out }); } catch (e) { fail(res, e); }
  });
  router.post('/api/access/emergencies/:id/review', requireReportSession, requireSuper, emOn, json, async (req, res) => {
    try { const b = req.body || {}; res.json({ ok: true, ...(await em().review(req.params.id, req.reportUser, { outcome: b.outcome, notes: b.notes })) }); } catch (e) { fail(res, e); }
  });
  // ── E-S03 recertification campaigns ───────────────────────────────
  const recertOn = async (req, res, next) => { try { return String((await cfg()).access_recert_enabled) === '1' ? next() : fail(res, typed('NOT_FOUND', 'access recertification is not enabled')); } catch (e) { fail(res, e); } };
  router.get('/api/access/recert/campaigns', requireReportSession, recertOn, requireSuper, async (req, res) => {
    try { res.json({ ok: true, campaigns: await store().listCampaigns(), apply: String((await cfg()).access_recert_apply) === '1' }); } catch (e) { fail(res, e); }
  });
  router.post('/api/access/recert/campaigns', requireReportSession, recertOn, requireSuper, json, async (req, res) => {
    try {
      const c = await cfg();
      const out = await store().openCampaign({ ...(req.body || {}), orphan_days: c.access_recert_orphan_days }, { actorId: req.reportUser.id });
      log(req, 'access_recert_opened', out.id, { lines: out.lines, scope_site_id: (req.body || {}).scope_site_id ?? null });
      res.status(201).json({ ok: true, ...out });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/access/recert/orphans', requireReportSession, recertOn, requireSuper, async (req, res) => {
    try { res.json({ ok: true, ...(await store().recertOrphans({ days: (await cfg()).access_recert_orphan_days })) }); } catch (e) { fail(res, e); }
  });
  router.get('/api/access/recert/mine', requireReportSession, recertOn, async (req, res) => {
    try { res.json({ ok: true, lines: await store().linesAssignedTo(req.reportUser.id) }); } catch (e) { fail(res, e); }
  });
  router.get('/api/access/recert/campaigns/:id', requireReportSession, recertOn, async (req, res) => {
    try {
      const sup = isSuper(req.reportUser);
      const c = await store().getCampaign(req.params.id, { approverId: sup ? null : req.reportUser.id });
      if (!c || (!sup && !c.lines.length)) return fail(res, typed('NOT_FOUND', 'campaign not found'));
      res.json({ ok: true, campaign: c, apply: String((await cfg()).access_recert_apply) === '1' });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/access/recert/campaigns/:id/close', requireReportSession, recertOn, requireSuper, async (req, res) => {
    try { await store().closeCampaign(req.params.id, { actorId: req.reportUser.id }); log(req, 'access_recert_closed', req.params.id, {}); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });
  router.post('/api/access/recert/lines/:id/answer', requireReportSession, recertOn, json, async (req, res) => {
    try {
      const apply = String((await cfg()).access_recert_apply) === '1';
      const out = await store().answerLine(req.params.id, req.reportUser, req.body || {}, { apply });
      log(req, 'access_recert_answered', req.params.id, { answer: out.answer, applied: out.applied }, out.applied ? 1 : 0);
      res.json({ ok: true, ...out });
    } catch (e) { fail(res, e); }
  });
  require('./qualifications')(deps, router);   // C-19 qualification evidence, same router
  return router;
};
