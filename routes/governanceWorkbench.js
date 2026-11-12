'use strict';
// R2-WORKBENCH (REBUILD-SPEC R5) — project workbench additions, registered by routes/governancePpm.js on the
// governance router with the SAME helpers (committee, money-read rule, A-15 read scope, plan-write rule). Every
// action exists only while its PROPOSED switch is '1' (404 while '0' = today):
//   R2-WB-04 ppm_project_team_enabled  GET /api/governance/ppm/project/:id/team · PUT …/team · DELETE …/team/:mid
//                                      read scope / plan-write rule
const { fail: httpFail } = require('../services/httpError');

module.exports = function governanceWorkbenchRoutes(router, h) {
  const { store, rdb, reportConfig, requireReportSession, json, readableProject, refusePlanWrite, log } = h;
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false, ...(e && e.reason ? { code: e.reason } : {}) });
  const cfg = async () => reportConfig.getConfig(rdb().db);
  const on = (c, k) => String(c[k]) === '1';
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });
  const wb = () => require('../services/ppmWorkbenchStore').makeWorkbenchStore(rdb().pgHandle(), store);

  // ---- R2-WB-04 project team ------------------------------------------------------------------------------------
  const teamOn = async (res) => { if (!on(await cfg(), 'ppm_project_team_enabled')) { notFound(res); return false; } return true; };
  router.get('/api/governance/ppm/project/:id/team', requireReportSession, async (req, res) => {
    try {
      if (!(await teamOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      res.json({ ok: true, members: await wb().listMembers(p.id) });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/project/:id/team', requireReportSession, json, async (req, res) => {
    try {
      if (!(await teamOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await refusePlanWrite(req, res, 'task', { body: { project_id: p.id } })) return;
      const m = await wb().saveMember(p.id, req.body || {}, { user: req.reportUser });
      log(req, 'team_member_saved', `project:${p.id}`, { member: m.id });
      res.json({ ok: true, member: m, members: await wb().listMembers(p.id) });
    } catch (e) { fail(res, e); }
  });
  router.delete('/api/governance/ppm/project/:id/team/:mid', requireReportSession, async (req, res) => {
    try {
      if (!(await teamOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await refusePlanWrite(req, res, 'task', { body: { project_id: p.id } })) return;
      await wb().removeMember(p.id, req.params.mid, { user: req.reportUser });
      log(req, 'team_member_removed', `project:${p.id}`, { member: Number(req.params.mid) });
      res.json({ ok: true, members: await wb().listMembers(p.id) });
    } catch (e) { fail(res, e); }
  });
};
