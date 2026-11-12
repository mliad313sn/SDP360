'use strict';
// R2-WORKBENCH (REBUILD-SPEC R5) — project workbench additions, registered by routes/governancePpm.js on the
// governance router with the SAME helpers (committee, money-read rule, A-15 read scope, plan-write rule). Every
// action exists only while its PROPOSED switch is '1' (404 while '0' = today):
//   R2-WB-04 ppm_project_team_enabled  GET /api/governance/ppm/project/:id/team · PUT …/team · DELETE …/team/:mid
//                                      read scope / plan-write rule
//   R2-WB-02 ppm_time_entries_enabled  GET /api/governance/ppm/task/:id/time · POST …/time · DELETE …/time/:eid
//                                      GET /api/governance/ppm/project/:id/actual-hours (planned / actual / variance)
//                                      read scope; writes = plan-write rule (recording one's OWN time on a readable
//                                      project without plan-write is a PO decision — not built)
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

  // ---- R2-WB-02 time entries and actual hours -------------------------------------------------------------------
  const SCH = require('../services/projectSchedule');
  const timeOn = async (res) => { if (!on(await cfg(), 'ppm_time_entries_enabled')) { notFound(res); return false; } return true; };
  /** The live task and its project if this user may read that project, else null (404 for the caller). */
  async function readableTask(u, taskId) {
    if (!Number.isInteger(Number(taskId))) return null;
    const row = await store.planRow('task', Number(taskId)); if (!row) return null;
    const p = await readableProject(u, row.project_id);
    return p ? { task_id: row.id, project: p } : null;
  }
  router.get('/api/governance/ppm/task/:id/time', requireReportSession, async (req, res) => {
    try {
      if (!(await timeOn(res))) return;
      const t = await readableTask(req.reportUser, req.params.id); if (!t) return notFound(res);
      const entries = await wb().listTimeEntries(t.task_id);
      const d = await store.projectDetail(t.project.id); const task = (d.tasks || []).find((x) => x.id === t.task_id) || { id: t.task_id };
      res.json({ ok: true, entries, hours: SCH.actualHours([task], entries)[0] });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/task/:id/time', requireReportSession, json, async (req, res) => {
    try {
      if (!(await timeOn(res))) return;
      const t = await readableTask(req.reportUser, req.params.id); if (!t) return notFound(res);
      if (await refusePlanWrite(req, res, 'task', { id: t.task_id })) return;
      const e = await wb().addTimeEntry(t.task_id, t.project.id, req.body || {}, { user: req.reportUser });
      log(req, 'time_entry_added', `task:${t.task_id}`, { hours: e.hours, day: e.day });
      res.json({ ok: true, entry: e, entries: await wb().listTimeEntries(t.task_id) });
    } catch (e) { fail(res, e); }
  });
  router.delete('/api/governance/ppm/task/:id/time/:eid', requireReportSession, async (req, res) => {
    try {
      if (!(await timeOn(res))) return;
      const t = await readableTask(req.reportUser, req.params.id); if (!t) return notFound(res);
      if (await refusePlanWrite(req, res, 'task', { id: t.task_id })) return;
      await wb().removeTimeEntry(t.task_id, req.params.eid, t.project.id, { user: req.reportUser });
      log(req, 'time_entry_removed', `task:${t.task_id}`, { entry: Number(req.params.eid) });
      res.json({ ok: true, entries: await wb().listTimeEntries(t.task_id) });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/ppm/project/:id/actual-hours', requireReportSession, async (req, res) => {
    try {
      if (!(await timeOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      const d = await store.projectDetail(p.id);
      res.json({ ok: true, hours: SCH.actualHours(d.tasks || [], await wb().listProjectTimeEntries(p.id)) });
    } catch (e) { fail(res, e); }
  });
};
