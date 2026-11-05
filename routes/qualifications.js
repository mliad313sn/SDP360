'use strict';
const { fail, typed } = require('../services/httpError');
// C-19 (G41 · R10) — qualification EVIDENCE. Registered on the access router (routes/access.js).
// SDP360 records evidence only; it never grants a physical authorisation (permit, habilitation…).
//   GET  /api/qualifications/kinds                    active kinds (super_admin: inactive too)               session
//   PUT  /api/qualifications/kinds/:key               { name_en, name_fr, active, display_order }           super_admin
//   GET  /api/qualifications[?user_id=]               mine; the admin tier may read anyone's (or all)        session
//   POST /api/qualifications                          { user_id, kind, issuer, issued_on, expires_on, evidence_ref, notes }   admin tier
//   POST /api/qualifications/:id/{verify,reject,revoke}  { reason } — verifier ≠ holder ≠ recorder (sodPolicy)   admin tier
//   GET  /api/qualifications/check?cap=<capability>   does MY evidence satisfy a capability's requirement?  session
// Every error goes through httpError.fail.
module.exports = function qualificationRoutes(deps, router) {
  const { express, requireReportSession } = deps;
  const json = express.json({ limit: '16kb' });
  const rdb = () => deps.rdb || require('../reports-db');
  const store = () => deps.qualStore || (deps._qualStore = deps._qualStore || require('../services/qualificationStore').forRdb(rdb()));
  const isSuper = (u) => rdb().userHasRole(u, 'super_admin');
  const isAdmin = (u) => rdb().userHasRole(u, 'admin');
  const requireSuper = (req, res, next) => (isSuper(req.reportUser) ? next() : fail(res, typed('FORBIDDEN', 'super_admin role required')));
  requireSuper.legacyRoles = ['super_admin'];   // C-17 tag → platform.reference_data.manage

  router.get('/api/qualifications/kinds', requireReportSession, async (req, res) => {
    try { res.json({ ok: true, kinds: await store().listKinds({ includeInactive: isSuper(req.reportUser) }), note: 'evidence only — SDP360 never grants a physical authorisation' }); } catch (e) { fail(res, e); }
  });
  router.put('/api/qualifications/kinds/:key', requireReportSession, requireSuper, json, async (req, res) => {
    try { await store().upsertKind(req.params.key, req.body, { actorId: req.reportUser.id }); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });
  router.get('/api/qualifications/check', requireReportSession, async (req, res) => {
    try {
      const cap = String(req.query.cap || '').replace(/[^\w.-]/g, '').slice(0, 80);
      if (!cap) return fail(res, typed('VALIDATION', 'cap is required'));
      res.json({ ok: true, ...(await store().checkCapability(req.reportUser, cap)) });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/qualifications', requireReportSession, async (req, res) => {
    try {
      const me = Number(req.reportUser.id);
      const want = req.query.user_id == null || req.query.user_id === '' ? null : Number(req.query.user_id);
      if (!isAdmin(req.reportUser) && want != null && want !== me) return fail(res, typed('FORBIDDEN', 'you may read only your own qualification evidence'));
      const userId = isAdmin(req.reportUser) ? want : me;
      res.json({ ok: true, records: await store().list({ userId }), can_record: isAdmin(req.reportUser) });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/qualifications', requireReportSession, json, async (req, res) => {
    try {
      if (!isAdmin(req.reportUser)) return fail(res, typed('FORBIDDEN', 'only the admin tier may record qualification evidence'));
      res.status(201).json({ ok: true, id: await store().record(req.body, { actorId: req.reportUser.id }) });
    } catch (e) { fail(res, e); }
  });
  for (const action of ['verify', 'reject', 'revoke']) {
    router.post(`/api/qualifications/:id/${action}`, requireReportSession, json, async (req, res) => {
      try { res.json({ ok: true, ...(await store().decide(req.params.id, action, req.reportUser, { reason: (req.body || {}).reason })) }); } catch (e) { fail(res, e); }
    });
  }
  return router;
};
