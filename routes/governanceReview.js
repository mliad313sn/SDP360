'use strict';
// PORTFOLIO LOT 5 (IT portfolio reconstruction spec §26, §27) — review workflow on a project, registered on the
// governance router with ITS helpers (A-15 read scope through readableProject, committee rule). Every route answers
// 404 while report_config ppm_review_workflow_enabled = '0' (PROPOSED, default = today). ADR: ADR-PORTFOLIO-LOT5.
//
//   GET  /api/governance/portfolio/project/:id/review                 review state (reviewers, information requests,
//                                                                       returns), steps, who may act   project readers
//   POST /api/governance/portfolio/project/:id/review/assign          {step, user_id}   committee; the reviewer may be
//                                                                       neither the requester, the owner nor the sponsor
//   POST /api/governance/portfolio/project/:id/review/request-info    {step, question}  committee or an assigned reviewer
//   POST /api/governance/portfolio/project/:id/review/respond         {request_id, answer}  the owner or the committee
//   POST /api/governance/portfolio/project/:id/review/return          {reason}  committee: return for correction
//                                                                       (approval → proposal; extended: assessment → idea)
//   POST /api/governance/portfolio/project/:id/review/apply-template  committee, needs ppm_gate_checklist_enabled: the
//                                                                       PROPOSED six review steps become the checklist of
//                                                                       the decision gate (entering in_progress)
//   GET  /api/governance/portfolio/roles-catalogue                    spec §27 roles mapped to existing roles  session
// Every write is a row of the existing ppm_events ledger. Nothing here approves or moves a project forward.
const { fail: httpFail } = require('../services/httpError');
const RW = require('../services/ppm/reviewWorkflow');

module.exports = function governanceReviewRoutes(router, h) {
  const { store, rdb, reportConfig, requireReportSession, json, isCommittee, readableProject, log } = h;
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false, ...(e && e.reason ? { code: e.reason } : {}) });
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });
  const refuse = (res, status, r) => httpFail(res, Object.assign(new Error(r.error), { reason: r.code }), status, { ok: false, code: r.code });
  const cfg = async () => reportConfig.getConfig(rdb().db);
  const sw = async (req, res, next) => { try { if (String((await cfg()).ppm_review_workflow_enabled) === '1') return next(); return notFound(res); } catch (e) { return fail(res, e); } };
  const rv = () => require('../services/ppm/reviewStore').makeReviewStore(rdb().pgHandle(), store, { provenanceDb: rdb().db });
  /** Readable project + review facts, else 404 (the A-15 read scope hides it). */
  async function project(req, res) {
    const p = await readableProject(req.reportUser, req.params.id); if (!p) { notFound(res); return null; }
    const f = await rv().projectFacts(p.id); if (!f) { notFound(res); return null; }
    return f;
  }
  const isReviewer = (st, u) => st.reviewers.some((r) => r.user_id != null && Number(r.user_id) === Number(u && u.id));
  const isOwner = (p, u) => require('../services/portfolioAccess').ownerMatches(p, u);

  /** P11 r5 F-19 — the accounts the committee may assign (the same rule the assign route enforces: active, neither
   *  the requester, the owner nor the sponsor). Name + hierarchical role only — the committee already assigns by id. */
  async function reviewerCandidates(p, requester) {
    const users = await rdb().pgHandle().prepare(`SELECT id, username, full_name, email, role FROM users
      WHERE COALESCE(active, 1) <> 0 ORDER BY lower(COALESCE(NULLIF(full_name, ''), username)) LIMIT 500`).all();
    return users.filter((x) => {
      const r = RW.selfApprovalRefusal({ id: Number(x.id), username: x.username, full_name: x.full_name, email: x.email }, p, requester);
      return !r || r.code === 'REVIEW_REQUESTER_UNKNOWN';
    }).map((x) => ({ id: Number(x.id), name: x.full_name || x.username, role: x.role || null }));
  }

  router.get('/api/governance/portfolio/roles-catalogue', requireReportSession, sw, async (req, res) => {
    res.json({ ok: true, proposed: true, roles: RW.ROLE_CATALOGUE, note: 'PROPOSED mapping of the spec roles onto existing roles; no new authorisation system' });
  });

  router.get('/api/governance/portfolio/project/:id/review', requireReportSession, sw, async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      const u = req.reportUser; const st = await rv().state(p.id); const committee = !!isCommittee(u);
      const requester = await rv().requesterOf(p);
      res.json({ ok: true, proposed: true, stage: p.stage || 'proposal', steps: RW.REVIEW_STEPS, decision_gate: RW.REVIEW_GATE, ...st,
        requester: requester ? { name: requester.name || null, known: requester.id != null } : null,
        can_assign: committee, can_request: committee || isReviewer(st, u), can_respond: committee || isOwner(p, u), can_return: committee,
        ...(committee ? { candidates: await reviewerCandidates(p, requester) } : {}) });
    } catch (e) { fail(res, e); }
  });

  router.post('/api/governance/portfolio/project/:id/review/assign', requireReportSession, sw, json, async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      if (!isCommittee(req.reportUser)) return refuse(res, 403, { code: 'COMMITTEE_ONLY', error: 'the committee assigns reviewers' });
      const step = RW.normaliseStep(req.body && req.body.step);
      const uid = Number(req.body && req.body.user_id);
      if (!Number.isInteger(uid) || uid <= 0) return refuse(res, 400, { code: 'BAD_USER', error: 'user_id must be a user id' });
      const target = await rdb().pgHandle().prepare(`SELECT id, username, full_name, email, active FROM users WHERE id=?`).get(uid);
      if (!target || Number(target.active) === 0) return refuse(res, 400, { code: 'BAD_USER', error: 'no active user with this id' });
      const indep = RW.selfApprovalRefusal({ id: Number(target.id), username: target.username, full_name: target.full_name, email: target.email }, p, await rv().requesterOf(p));
      if (indep && indep.code !== 'REVIEW_REQUESTER_UNKNOWN') return refuse(res, 409, { code: 'REVIEWER_NOT_INDEPENDENT', error: `this person cannot review the project: ${indep.error}` });
      await rv().assign(p.id, { step, user: target }, req.reportUser);
      log(req, 'review_assign', `project:${p.id}`, { step, user_id: uid });
      res.json({ ok: true, review: await rv().state(p.id) });
    } catch (e) { fail(res, e); }
  });

  router.post('/api/governance/portfolio/project/:id/review/request-info', requireReportSession, sw, json, async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      const st = await rv().state(p.id);
      if (!isCommittee(req.reportUser) && !isReviewer(st, req.reportUser)) return refuse(res, 403, { code: 'NOT_A_REVIEWER', error: 'the committee or an assigned reviewer requests information' });
      const step = RW.normaliseStep(req.body && req.body.step); const question = RW.normaliseQuestion(req.body && req.body.question);
      await rv().requestInfo(p.id, { step, question }, req.reportUser);
      log(req, 'review_info_request', `project:${p.id}`, { step });
      res.json({ ok: true, review: await rv().state(p.id) });
    } catch (e) { fail(res, e); }
  });

  router.post('/api/governance/portfolio/project/:id/review/respond', requireReportSession, sw, json, async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      if (!isCommittee(req.reportUser) && !isOwner(p, req.reportUser)) return refuse(res, 403, { code: 'OWNER_ONLY', error: 'the project owner or the committee answers an information request' });
      const answer = RW.normaliseAnswer(req.body && req.body.answer);
      const st = await rv().state(p.id); const rid = Number(req.body && req.body.request_id);
      const q = st.requests.find((r) => r.id === rid);
      if (!q) return notFound(res);
      if (q.answer != null) return refuse(res, 409, { code: 'ALREADY_ANSWERED', error: 'this request is already answered' });
      await rv().respond(p.id, { requestId: rid, answer }, req.reportUser);
      log(req, 'review_info_response', `project:${p.id}`, { request_id: rid });
      res.json({ ok: true, review: await rv().state(p.id) });
    } catch (e) { fail(res, e); }
  });

  router.post('/api/governance/portfolio/project/:id/review/return', requireReportSession, sw, json, async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      if (!isCommittee(req.reportUser)) return refuse(res, 403, { code: 'COMMITTEE_ONLY', error: 'the committee returns a project for correction' });
      const reason = RW.normaliseReason(req.body && req.body.reason);
      const c = await cfg(); const extended = String(c.ppm_extended_lifecycle_enabled) === '1';
      const from = p.stage || 'proposal';
      const to = from === 'approval' ? 'proposal' : (extended && from === 'assessment' ? 'idea' : null);
      if (!to) return refuse(res, 409, { code: 'NOT_UNDER_REVIEW', error: 'only a project under review (approval, or assessment with the extended lifecycle) can be returned for correction' });
      const stamp = String(c.ppm_field_audit_enabled) === '1' || String(c.ppm_review_workflow_enabled) === '1';
      const moved = await store.moveProjectStage(p.id, to, { user: req.reportUser, note: reason, extended, stampUser: stamp });
      await rv().recordReturn(p.id, { from, reason }, req.reportUser);
      log(req, 'review_return', `project:${p.id}`, { from, to });
      res.json({ ok: true, stage: moved.stage, review: await rv().state(p.id) });
    } catch (e) { fail(res, e); }
  });

  router.post('/api/governance/portfolio/project/:id/review/apply-template', requireReportSession, sw, json, async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      if (!isCommittee(req.reportUser)) return refuse(res, 403, { code: 'COMMITTEE_ONLY', error: 'the committee defines a gate checklist' });
      if (String((await cfg()).ppm_gate_checklist_enabled) !== '1') return refuse(res, 409, { code: 'CHECKLIST_OFF', error: 'gate checklists (ppm_gate_checklist_enabled) are off' });
      const w3 = require('../services/ppm/governanceW3Store').makeW3Store(rdb().pgHandle(), store);
      const cl = await w3.saveChecklist(p.id, RW.REVIEW_GATE, RW.reviewTemplate(), { user: req.reportUser });
      log(req, 'review_template_applied', `project:${p.id}`, { gate: RW.REVIEW_GATE, version: cl.version });
      res.json({ ok: true, checklist: cl, proposed: true });
    } catch (e) { fail(res, e); }
  });
};
