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
//   R2-WB-01 ppm_change_requests_enabled GET/POST /api/governance/ppm/project/:id/changes
//                                      POST …/changes/:cid/{assess,approve,reject,withdraw,apply}
//                                      create = plan-write rule; assess / approve / reject / apply = committee, the author
//                                      never approves or rejects (403 SELF_REVIEW); withdraw = author or committee; apply
//                                      with a dates impact = the committee re-baseline (ppm_rebaseline_enabled, else 409).
//                                      impact_budget / currency only under the money-read rule.
//   B5 ppm_timesheet_approval_enabled (with ppm_time_entries_enabled) GET /api/governance/ppm/project/:id/timesheets
//                                      POST …/timesheets/{submit,recall,approve,reject} {week_start, person_key, note}
//                                      every step = the plan-write rule; approve / reject never by a person who entered or
//                                      submitted the hours (403 SELF_REVIEW); a submitted / approved week freezes its time
//                                      entries (POST/DELETE …/task/:id/time → 409 WEEK_FROZEN).
//   B5 ppm_cr_simulation_enabled (with ppm_change_requests_enabled) POST …/changes accepts task_changes and simulates;
//                                      POST …/changes/:cid/simulate (plan-write rule) re-runs it; assess / approve re-run it
//                                      first; apply moves the baseline by the typed dates impact, else the simulated one.
//                                      The cost part of a simulation is shown under the money-read rule only.
//   R2-WB-06 roadmap_publication_enabled POST /api/governance/roadmap-migration (routes/governance.js) gains the
//                                      duplicates report + refusal + a ppm_events 'roadmap_migrated' row, and here:
//                                      GET  /api/governance/roadmap-publication           state (super_admin)
//                                      POST /api/governance/roadmap-migration/rollback    dry run by default; ?apply=1
//                                        SOFT-deletes the migrated programme (soft_delete_enabled, else 409) after
//                                        renaming its keys (keys are unique even when deleted) and turns the read-only
//                                        switch back off — nothing is hard-deleted, the Roadmap Manager rows are untouched
//                                      POST /api/governance/roadmap-migration/archive     the EXPLICIT "Roadmap Manager is
//                                        read-only now" gesture: needs a live migrated programme, records ppm_events
//                                        'published' with the parity verdict, sets roadmap_redirect_to_portfolio = '1'.
//                                      Never automatic: nothing here runs on a timer or after an apply.
const { fail: httpFail } = require('../services/httpError');

module.exports = function governanceWorkbenchRoutes(router, h) {
  const { store, rdb, reportConfig, requireReportSession, json, readableProject, refusePlanWrite, isCommittee, canSeeMoney, log } = h;
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false, ...(e && e.reason ? { code: e.reason } : {}) });
  const cfg = async () => reportConfig.getConfig(rdb().db);
  const on = (c, k) => String(c[k]) === '1';
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });
  const wb = () => require('../services/ppmWorkbenchStore').makeWorkbenchStore(rdb().pgHandle(), store);
  const WBP = require('../services/ppmWorkbench'), pub = (ms) => (ms || []).map(WBP.publicMember);   // UAT-OI-08: no login names

  // ---- R2-WB-04 project team ------------------------------------------------------------------------------------
  const teamOn = async (res) => { if (!on(await cfg(), 'ppm_project_team_enabled')) { notFound(res); return false; } return true; };
  router.get('/api/governance/ppm/project/:id/team', requireReportSession, async (req, res) => {
    try {
      if (!(await teamOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      res.json({ ok: true, members: pub(await wb().listMembers(p.id)) });
    } catch (e) { fail(res, e); }
  });
  // UAT-OI-08 — the user picker for a member: whoever may edit this project's team gets the active users (id + display
  // name, never an e-mail); a member stays free text when no account is picked (external people).
  router.get('/api/governance/ppm/project/:id/team/people', requireReportSession, async (req, res) => {
    try {
      if (!(await teamOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await refusePlanWrite(req, res, 'team', { body: { project_id: p.id }, op: 'team' })) return;
      res.json({ ok: true, people: WBP.pickerPeople(await rdb().listUsers()) });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/project/:id/team', requireReportSession, json, async (req, res) => {
    try {
      if (!(await teamOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await refusePlanWrite(req, res, 'team', { body: { project_id: p.id }, op: 'team' })) return;
      const b = req.body || {};   // UAT-OI-08 — a linked account must be an existing user (the picker offers active ones)
      if (b.user_id != null && b.user_id !== '' && !((await rdb().listUsers()) || []).some((x) => Number(x.id) === Number(b.user_id))) return httpFail(res, Object.assign(new Error('user_id is not a known user account'), { code: 'VALIDATION' }), 400, { ok: false, code: 'UNKNOWN_USER' });
      const m = await wb().saveMember(p.id, b, { user: req.reportUser });
      log(req, 'team_member_saved', `project:${p.id}`, { member: m.id });
      res.json({ ok: true, member: WBP.publicMember(m), members: pub(await wb().listMembers(p.id)) });
    } catch (e) { fail(res, e); }
  });
  router.delete('/api/governance/ppm/project/:id/team/:mid', requireReportSession, async (req, res) => {
    try {
      if (!(await teamOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await refusePlanWrite(req, res, 'team', { body: { project_id: p.id }, op: 'team' })) return;
      await wb().removeMember(p.id, req.params.mid, { user: req.reportUser });
      log(req, 'team_member_removed', `project:${p.id}`, { member: Number(req.params.mid) });
      res.json({ ok: true, members: pub(await wb().listMembers(p.id)) });
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
      if (await refusePlanWrite(req, res, 'task', { id: t.task_id, op: 'time' })) return;
      const e = await wb().addTimeEntry(t.task_id, t.project.id, req.body || {}, { user: req.reportUser, timesheetLock: on(await cfg(), 'ppm_timesheet_approval_enabled') });
      log(req, 'time_entry_added', `task:${t.task_id}`, { hours: e.hours, day: e.day });
      res.json({ ok: true, entry: e, entries: await wb().listTimeEntries(t.task_id) });
    } catch (e) { fail(res, e); }
  });
  router.delete('/api/governance/ppm/task/:id/time/:eid', requireReportSession, async (req, res) => {
    try {
      if (!(await timeOn(res))) return;
      const t = await readableTask(req.reportUser, req.params.id); if (!t) return notFound(res);
      if (await refusePlanWrite(req, res, 'task', { id: t.task_id, op: 'time' })) return;
      await wb().removeTimeEntry(t.task_id, req.params.eid, t.project.id, { user: req.reportUser, timesheetLock: on(await cfg(), 'ppm_timesheet_approval_enabled') });
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

  // ---- B5 timesheet weeks (submit → approve / reject by another person; approved weeks frozen) --------------------
  const tsOn = async (res) => { const c = await cfg(); if (!on(c, 'ppm_time_entries_enabled') || !on(c, 'ppm_timesheet_approval_enabled')) { notFound(res); return false; } return true; };
  router.get('/api/governance/ppm/project/:id/timesheets', requireReportSession, async (req, res) => {
    try {
      if (!(await tsOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      const weeks = (await wb().timesheetView(p.id)).map(({ entrants, ...w }) => ({ ...w, i_entered: entrants.includes(Number(req.reportUser.id)) || Number(w.submitted_by) === Number(req.reportUser.id) }));
      res.json({ ok: true, me: Number(req.reportUser.id), weeks });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/project/:id/timesheets/:action', requireReportSession, json, async (req, res) => {
    try {
      if (!(await tsOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await refusePlanWrite(req, res, 'task', { body: { project_id: p.id } })) return;
      const b = req.body || {};
      const w = await wb().transitionTimesheet(p.id, b, String(req.params.action), { user: req.reportUser, canPlanWrite: true, canDecide: true, note: b.note });
      log(req, `timesheet_${w.status}`, `project:${p.id}`, { person_key: w.person_key, week_start: w.week_start });
      const { entrants, ...week } = w;
      res.json({ ok: true, week });
    } catch (e) { fail(res, e); }
  });

  // ---- R2-WB-01 change requests --------------------------------------------------------------------------------
  const crOn = async (res) => { if (!on(await cfg(), 'ppm_change_requests_enabled')) { notFound(res); return false; } return true; };
  const crView = (u) => (cr) => {
    if (canSeeMoney(u)) return cr;
    const sim = cr.simulation ? { ...cr.simulation, cost: cr.simulation.cost ? { money_hidden: true } : cr.simulation.cost } : cr.simulation;
    return { ...cr, impact_budget: undefined, currency: undefined, simulation: sim, money_hidden: true };
  };
  const simOn = (c) => on(c, 'ppm_cr_simulation_enabled');
  router.get('/api/governance/ppm/project/:id/changes', requireReportSession, async (req, res) => {
    try {
      if (!(await crOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      res.json({ ok: true, committee: !!isCommittee(req.reportUser), me: Number(req.reportUser.id), money_hidden: !canSeeMoney(req.reportUser), simulation: simOn(await cfg()), changes: (await wb().listChangeRequests(p.id)).map(crView(req.reportUser)) });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/project/:id/changes', requireReportSession, json, async (req, res) => {
    try {
      if (!(await crOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await refusePlanWrite(req, res, 'task', { body: { project_id: p.id } })) return;
      const b = req.body || {};
      if (!canSeeMoney(req.reportUser) && b.impact_budget != null && b.impact_budget !== '') return httpFail(res, Object.assign(new Error('a money impact is entered by the committee, the admin tier or the finance role'), { reason: 'MONEY_SCOPE' }), 403, { ok: false, code: 'MONEY_SCOPE' });
      // B5 — task changes are accepted (and simulated at once) only while ppm_cr_simulation_enabled is on
      const sim = simOn(await cfg());
      let taskChanges = null;
      if (b.task_changes != null && b.task_changes !== '' && !(Array.isArray(b.task_changes) && !b.task_changes.length)) {
        if (!sim) return httpFail(res, Object.assign(new Error('task changes need the change-request simulation (ppm_cr_simulation_enabled)'), { reason: 'SIMULATION_OFF' }), 409, { ok: false, code: 'SIMULATION_OFF' });
        const d = await store.projectDetail(p.id);
        taskChanges = require('../services/ppm/crSimulation').normaliseTaskChanges(b.task_changes, (d.tasks || []).map((t) => t.id));
      }
      let cr = await wb().createChangeRequest(p.id, b, { user: req.reportUser, taskChanges });
      if (taskChanges && taskChanges.length) { await wb().simulateChangeRequest(cr.id, { user: req.reportUser }); cr = await wb().getChangeRequest(cr.id); }
      log(req, 'change_request_proposed', `project:${p.id}`, { cr: cr.id, task_changes: taskChanges ? taskChanges.length : 0 });
      res.json({ ok: true, change: crView(req.reportUser)(cr) });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/project/:id/changes/:cid/simulate', requireReportSession, json, async (req, res) => {
    try {
      if (!(await crOn(res))) return;
      if (!simOn(await cfg())) return notFound(res);
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await refusePlanWrite(req, res, 'task', { body: { project_id: p.id } })) return;
      const cr0 = await wb().getChangeRequest(req.params.cid); if (!cr0 || cr0.project_id !== Number(p.id)) return notFound(res);
      await wb().simulateChangeRequest(cr0.id, { user: req.reportUser });
      const cr = await wb().getChangeRequest(cr0.id);
      log(req, 'change_request_simulated', `project:${p.id}`, { cr: cr.id, ok: !!(cr.simulation && cr.simulation.ok) });
      res.json({ ok: true, change: crView(req.reportUser)(cr) });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/project/:id/changes/:cid/:action', requireReportSession, json, async (req, res) => {
    try {
      if (!(await crOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      const c = await cfg();
      const cr = await wb().transitionChangeRequest(p.id, req.params.cid, String(req.params.action), { user: req.reportUser, isCommittee: !!isCommittee(req.reportUser), note: req.body && req.body.note, rebaselineEnabled: on(c, 'ppm_rebaseline_enabled'), simulation: simOn(c) });
      log(req, `change_request_${cr.status}`, `project:${p.id}`, { cr: cr.id, baseline_version: cr.applied_baseline_version });
      res.json({ ok: true, change: crView(req.reportUser)(cr) });
    } catch (e) { fail(res, e); }
  });

  // ---- R2-WB-06 controlled roadmap publication ---------------------------------------------------------------------
  const isSuper = (u) => rdb().userHasRole(u, 'super_admin');
  const pubGate = async (req, res) => {
    if (!(await PUB.enabled(rdb, reportConfig))) { notFound(res); return false; }
    if (!isSuper(req.reportUser)) { httpFail(res, new Error('super_admin required'), 403, { ok: false }); return false; }
    return true;
  };
  const parity = async (userId) => { const H = rdb().pgHandle(); const r = await require('../services/roadmapParity').buildReport((sql, a) => H.prepare(sql).all(...(a || [])), { userId }); return (r.users[0] && r.users[0].verdict) || 'no_roadmap'; };
  router.get('/api/governance/roadmap-publication', requireReportSession, async (req, res) => {
    try {
      if (!(await pubGate(req, res))) return;
      const c = await cfg(); const sub = await PUB.subtree(rdb);
      const events = sub ? await store.ppmEvents('programme', sub.programme.id) : [];
      res.json({ ok: true, migrated: !!sub, programme: sub ? sub.programme : null, read_only: on(c, 'roadmap_redirect_to_portfolio'), soft_delete: on(c, 'soft_delete_enabled'),
        parity: await parity(req.reportUser.id), published: events.filter((e) => e.action === 'published').slice(-1)[0] || null });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/roadmap-migration/rollback', requireReportSession, json, async (req, res) => {
    try {
      if (!(await pubGate(req, res))) return;
      const sub = await PUB.subtree(rdb); if (!sub) return httpFail(res, new Error('no migrated programme to roll back'), 404, { ok: false, code: 'NOT_MIGRATED' });
      const plan = { programme: sub.programme, objectives: sub.objectives.length, projects: sub.projects.length, deliverables: sub.deliverables.length, items: sub };
      if (req.query.apply !== '1') return res.json({ ok: true, dry_run: true, plan });
      const c = await cfg();
      if (!on(c, 'soft_delete_enabled')) return httpFail(res, new Error('rollback is a soft delete: turn soft_delete_enabled on first (nothing is ever hard-deleted here)'), 409, { ok: false, code: 'SOFT_DELETE_OFF' });
      const reason = String((req.body && req.body.reason) || '').trim();
      if (reason.length < 10) return httpFail(res, new Error('a reason of at least 10 characters is required'), 400, { ok: false, code: 'NOTE_REQUIRED' });
      const suffix = await PUB.freeKeys(rdb, sub);
      await store.removePortfolio('programme', sub.programme.id, { soft: true, user: req.reportUser, reason });
      if (on(c, 'roadmap_redirect_to_portfolio')) await reportConfig.setConfig(rdb().db, { roadmap_redirect_to_portfolio: '0' }, req.reportUser.username);
      await store.ppmEvent({ entity: 'programme', entity_id: sub.programme.id, action: 'roadmap_rollback', field: 'key', old_value: sub.programme.key, new_value: sub.programme.key + suffix, note: reason }, req.reportUser);
      log(req, 'roadmap_rollback', `programme:${sub.programme.id}`, { objectives: plan.objectives, deliverables: plan.deliverables });
      res.json({ ok: true, dry_run: false, plan, renamed_suffix: suffix, read_only: false });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/roadmap-migration/archive', requireReportSession, json, async (req, res) => {
    try {
      if (!(await pubGate(req, res))) return;
      const sub = await PUB.subtree(rdb); if (!sub) return httpFail(res, new Error('publish the roadmap first: there is no migrated programme'), 409, { ok: false, code: 'NOT_MIGRATED' });
      if (req.body == null || req.body.confirm !== true) return httpFail(res, new Error('archive needs an explicit confirmation'), 400, { ok: false, code: 'CONFIRM_REQUIRED' });
      const verdict = await parity(req.reportUser.id); const was = on(await cfg(), 'roadmap_redirect_to_portfolio') ? '1' : '0';
      await reportConfig.setConfig(rdb().db, { roadmap_redirect_to_portfolio: '1' }, req.reportUser.username);
      await store.ppmEvent({ entity: 'programme', entity_id: sub.programme.id, action: 'published', field: 'roadmap_redirect_to_portfolio', old_value: was, new_value: '1', note: `parity: ${verdict}` }, req.reportUser);
      log(req, 'roadmap_published', `programme:${sub.programme.id}`, { parity: verdict });
      res.json({ ok: true, read_only: true, parity: verdict });
    } catch (e) { fail(res, e); }
  });
};

// R2-WB-06 helpers shared with the migration route in routes/governance.js (one place for the switch and the reads).
const PUB = {
  KEY: 'itsm-roadmap',
  enabled: async (rdb, reportConfig) => String((await reportConfig.getConfig(rdb().db)).roadmap_publication_enabled) === '1',
  // objective keys already taken in the portfolio, live or soft-deleted (the unique key covers both)
  duplicates: async (rdb, plan) => {
    const H = rdb().pgHandle(); const keys = (plan.objectives || []).map((o) => o.key);
    const taken = keys.length ? (await H.prepare(`SELECT key FROM portfolio_objectives WHERE key IN (${keys.map(() => '?').join(',')})`).all(...keys)).map((r) => r.key) : [];
    return require('../services/roadmapPublication').duplicates(plan, { existingObjectiveKeys: taken });
  },
  withoutDuplicates: (plan, d) => require('../services/roadmapPublication').withoutDuplicates(plan, d),
  // the live migrated programme and its live subtree (null when not migrated / already rolled back)
  subtree: async (rdb) => {
    const H = rdb().pgHandle(); const n = (r) => ({ ...r, id: Number(r.id) });
    const p = await H.prepare(`SELECT id, key, name FROM portfolio_programmes WHERE key=? AND deleted_at IS NULL`).get(PUB.KEY); if (!p) return null;
    const objectives = (await H.prepare(`SELECT id, key, name FROM portfolio_objectives WHERE programme_id=? AND deleted_at IS NULL ORDER BY sort_order, id`).all(Number(p.id))).map(n);
    const oids = objectives.map((o) => o.id);
    const projects = oids.length ? (await H.prepare(`SELECT id, key, name, objective_id FROM portfolio_projects WHERE deleted_at IS NULL AND objective_id IN (${oids.map(() => '?').join(',')}) ORDER BY id`).all(...oids)).map(n) : [];
    const pids = projects.map((x) => x.id);
    const deliverables = pids.length ? (await H.prepare(`SELECT id, name, project_id FROM portfolio_deliverables WHERE deleted_at IS NULL AND project_id IN (${pids.map(() => '?').join(',')}) ORDER BY id`).all(...pids)).map(n) : [];
    return { programme: n(p), objectives, projects, deliverables };
  },
  // keys are unique even on soft-deleted rows: suffix them so a later publication can reuse the original keys
  freeKeys: async (rdb, sub) => {
    const H = rdb().pgHandle(); const suffix = `-rb${Date.now()}`;
    await H.runTransaction(async () => {
      await H.prepare(`UPDATE portfolio_programmes SET key = key || ? WHERE id=?`).run(suffix, sub.programme.id);
      for (const o of sub.objectives) await H.prepare(`UPDATE portfolio_objectives SET key = key || ? WHERE id=?`).run(suffix, o.id);
      for (const x of sub.projects) await H.prepare(`UPDATE portfolio_projects SET key = key || ? WHERE id=?`).run(suffix, x.id);
    });
    return suffix;
  },
};
module.exports.roadmapPublication = PUB;
