'use strict';
// PPM parity W4 (enterprise) — project roles and comments with @mentions, registered by routes/governancePpm.js on the
// governance router with the SAME helpers (committee, A-15 read scope incl. sensitive projects, plan-write rule). Every
// action exists only while its PROPOSED switch is '1' (404 while '0' = today):
//   ppm_project_roles_enabled  GET  /api/governance/ppm/project/:id/roles        members + their project role, my role
//                              PUT  /api/governance/ppm/project/:id/roles/:mid    {ppm_role|null} — the committee or the
//                                   project's pm (a member must be linked to an account, else 409 NO_ACCOUNT); ppm_events row
//   ppm_comments_enabled       GET  /api/governance/ppm/project/:id/comments[?task_id=]   readers of the project
//                              POST /api/governance/ppm/project/:id/comments {body, task_id?} readers of the project, never
//                                   a client project role (403 CLIENT_READ_ONLY); @mentions resolved only among readers;
//                                   in-app notices (nothing while notifications_stop = '1'); append-only (no edit route)
const { fail: httpFail } = require('../services/httpError');

module.exports = function governanceCollabRoutes(router, h) {
  const { store, rdb, reportConfig, requireReportSession, json, readableProject, isCommittee, log } = h;
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false, ...(e && e.reason ? { code: e.reason } : {}) });
  const cfg = async () => reportConfig.getConfig(rdb().db);
  const on = (c, k) => String(c[k]) === '1';
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });
  const forbidden = (res, code, msg) => httpFail(res, Object.assign(new Error(msg), { reason: code }), 403, { ok: false, code });
  const CS = () => require('../services/ppm/collabStore').makeCollabStore(rdb().pgHandle(), store);
  const PR = require('../services/ppm/projectRoles');
  const CM = require('../services/ppm/comments');
  const gate = (key) => async (res) => { if (!on(await cfg(), key)) { notFound(res); return false; } return true; };
  const rolesOn = gate('ppm_project_roles_enabled'), commentsOn = gate('ppm_comments_enabled');

  // ---- project roles ---------------------------------------------------------------------------------------------
  router.get('/api/governance/ppm/project/:id/roles', requireReportSession, async (req, res) => {
    try {
      if (!(await rolesOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      const s = CS(), mine = await s.roleOf(p.id, req.reportUser.id);
      res.json({ ok: true, roles: PR.ROLES, labels: PR.LABELS, members: await s.listRoles(p.id), my_role: mine, can_assign: !!isCommittee(req.reportUser) || mine === 'pm' });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/project/:id/roles/:mid', requireReportSession, json, async (req, res) => {
    try {
      if (!(await rolesOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      const s = CS();
      if (!isCommittee(req.reportUser) && (await s.roleOf(p.id, req.reportUser.id)) !== 'pm') return forbidden(res, 'ROLE_ASSIGN', 'the committee or the project manager assigns project roles');
      if (!Number.isInteger(Number(req.params.mid))) return notFound(res);
      const m = await s.setRole(p.id, Number(req.params.mid), req.body && req.body.ppm_role, { user: req.reportUser });
      log(req, 'project_role_set', `project:${p.id}`, { member: m.id, ppm_role: m.ppm_role });
      res.json({ ok: true, member: m, members: await s.listRoles(p.id) });
    } catch (e) { fail(res, e); }
  });

  // ---- comments with @mentions -------------------------------------------------------------------------------------
  const taskParam = (v) => (v == null || v === '' ? null : Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : NaN);
  router.get('/api/governance/ppm/project/:id/comments', requireReportSession, async (req, res) => {
    try {
      if (!(await commentsOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      const taskId = taskParam(req.query.task_id);
      if (Number.isNaN(taskId)) return httpFail(res, Object.assign(new Error('task_id must be a task id'), { reason: 'BAD_TASK' }), 400, { ok: false, code: 'BAD_TASK' });
      res.json({ ok: true, comments: await CS().listComments(p.id, { taskId }) });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/project/:id/comments', requireReportSession, json, async (req, res) => {
    try {
      if (!(await commentsOn(res))) return;
      const u = req.reportUser;
      const p = await readableProject(u, req.params.id); if (!p) return notFound(res);
      const c = await cfg(), s = CS();
      if (on(c, 'ppm_project_roles_enabled') && !isCommittee(u) && (await s.roleOf(p.id, u.id)) === 'client') return forbidden(res, 'CLIENT_READ_ONLY', 'a client of the project reads it; they do not comment');
      const b = req.body || {};
      const taskId = taskParam(b.task_id);
      if (Number.isNaN(taskId)) return httpFail(res, Object.assign(new Error('task_id must be a task id'), { reason: 'BAD_TASK' }), 400, { ok: false, code: 'BAD_TASK' });
      const body = CM.normaliseBody(b.body);
      // @mentions: only accounts that may READ this project (the same rule as the project page), others reach nobody
      const tokens = CM.parseMentions(body);
      const users = tokens.length ? ((await rdb().listUsers()) || []) : [];
      const readers = new Set();
      for (const x of users.filter((y) => tokens.includes(String(y.username || '').toLowerCase()) && y.active !== 0 && y.active !== false)) {
        const cand = { ...x, site_ids: [x.site_id, ...(x.extra_site_ids || [])].filter((v) => v != null) };
        if (await readableProject(cand, p.id)) readers.add(Number(x.id));
      }
      const { mentioned, unresolved } = CM.resolveMentions(tokens, users, readers);
      const comment = await s.addComment(p.id, { taskId, body, mentions: mentioned }, { user: u });
      let notified = 0;
      if (mentioned.length && String(c.notifications_stop || '0') !== '1') {
        try {
          const eng = require('../services/engagementStore').makeEngagementStore({ prepare: (sql) => rdb().pgHandle().prepare(sql) }, { isPg: true });
          for (const n of CM.noticesFor(comment, mentioned, { actorId: u.id, authorName: u.full_name || u.username, projectKey: p.key })) { await eng.notify(n); notified++; }
        } catch (e) { console.warn('[ppm] mention notice skipped:', e.message); }
      }
      log(req, 'ppm_comment_added', `project:${p.id}`, { comment: comment.id, task: taskId, mentioned: mentioned.length });
      res.json({ ok: true, comment, unresolved, notified });
    } catch (e) { if (e && e.status === 404) return notFound(res); fail(res, e); }
  });
};
