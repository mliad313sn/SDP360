'use strict';
// W2-ENGINE (PPM parity W2) — the scheduling API the interactive Gantt (W2-ui) consumes: the full schedule of a project
// with calendars, resources, time-phased work, over-allocations and costs; calendars; the resource pool and its rate
// tables; assignments; levelling (proposal → explicit apply); baseline slots; MSPDI export / import. Registered by
// routes/governancePpm.js on the governance router with the SAME helpers (A-15 read scope, plan-write rule,
// committee, money-read rule). Contract: docs/ppm/W2-ENGINE-CONTRACT.md. Every action is gated by a PROPOSED switch
// (404 while '0' = today):
//   ppm_schedule_engine_v2_ui   GET  /api/governance/ppm/project/:id/schedule                  read scope
//   ppm_calendars_enabled       GET  /api/governance/ppm/calendars                             any session
//                               PUT  /api/governance/ppm/calendars                             committee
//                               POST /api/governance/ppm/calendars/:id/exceptions              committee
//                               DELETE /api/governance/ppm/calendars/:id/exceptions/:eid       committee
//                               PUT  /api/governance/ppm/project/:id/calendar                  plan write
//   (calendars or resources)    PUT  /api/governance/ppm/task/:id/engine                       plan write (calendar, priority)
//   ppm_resources_enabled       GET  /api/governance/ppm/resources                             session; site perimeter; rates = money rule
//                               PUT  /api/governance/ppm/resources                             committee
//                               PUT  /api/governance/ppm/resources/:id/rates                   committee (money write)
//                               GET  /api/governance/ppm/project/:id/assignments               read scope (costs = money rule)
//                               PUT  /api/governance/ppm/task/:id/assignments                  plan write (cost amounts: committee)
//   ppm_leveling_enabled        GET  /api/governance/ppm/project/:id/leveling                  read scope — a PROPOSAL, writes nothing
//   (+ ppm_resources_enabled)   POST /api/governance/ppm/project/:id/leveling/apply            plan write, the proposal fingerprint
//                               POST /api/governance/ppm/project/:id/leveling/clear            plan write
//   ppm_baseline_slots_enabled  GET  /api/governance/ppm/project/:id/baseline-slots            read scope (costs = money rule)
//                               POST /api/governance/ppm/project/:id/baseline-slots            plan write — immutable once saved
//   ppm_mspdi_enabled           GET  /api/governance/ppm/project/:id/mspdi.xml                 read scope (rates / costs = money rule)
//                               POST /api/governance/ppm/project/:id/mspdi/import[?apply=1]    plan write = dry run; apply = committee
const crypto = require('crypto');
const { fail: httpFail } = require('../services/httpError');

module.exports = function ppmEngineRoutes(router, h) {
  const { store, rdb, reportConfig, requireReportSession, json, isCommittee, canSeeMoney, readableProject, refusePlanWrite, log } = h;
  const ENGINE = require('../services/ppm/scheduleEngine');
  const CAL = require('../services/ppm/calendars');
  const RES = require('../services/ppm/resources');
  const SLOTS = require('../services/ppm/baselineSlots');
  const MSPDI = require('../services/ppm/mspdi');
  const { siteIds } = require('../services/userSites');
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false, ...(e && e.reason ? { code: e.reason } : {}) });
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });
  const forbidden = (res, msg, code) => httpFail(res, Object.assign(new Error(msg), { reason: code }), 403, { ok: false, code });
  const bad = (res, msg, code) => httpFail(res, Object.assign(new Error(msg), { reason: code }), 400, { ok: false, code });
  const cfg = async () => reportConfig.getConfig(rdb().db);
  const on = (c, k) => String(c[k]) === '1';
  const eng = () => require('../services/ppm/engineStore').makeEngineStore(rdb().pgHandle(), store);
  const isAdminTier = (u) => !!rdb().userHasRole(u, 'admin');
  const xmlBody = require('express').raw({ type: () => true, limit: '25mb' });
  const switches = (c) => ({ schedule_v2: on(c, 'ppm_schedule_engine_v2_ui'), calendars: on(c, 'ppm_calendars_enabled'), resources: on(c, 'ppm_resources_enabled'), leveling: on(c, 'ppm_leveling_enabled') && on(c, 'ppm_resources_enabled'), baseline_slots: on(c, 'ppm_baseline_slots_enabled'), mspdi: on(c, 'ppm_mspdi_enabled') });
  const gate = async (res, ...keys) => { const c = await cfg(); const s = switches(c); if (!keys.every((k) => s[k])) { notFound(res); return null; } return s; };
  const statusDate = (req, res) => { const v = req.query && req.query.status_date; if (v == null || v === '') return null; if (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'))) return String(v); bad(res, 'status_date must be YYYY-MM-DD', 'BAD_STATUS_DATE'); return undefined; };
  const writeProject = async (req, res, pid) => refusePlanWrite(req, res, 'task', { body: { project_id: Number(pid) } });
  /** Resources a user may see: admin tier and the committee (who maintain the pool) → all; else group-wide ones and those of the user's sites (site perimeter). */
  const visibleResource = (u, r) => isAdminTier(u) || !!isCommittee(u) || r.site_id == null || siteIds(u).includes(Number(r.site_id));

  /** Everything the schedule needs, read once. Calendars / resources / levelling only when their switch is on. */
  async function computeProject(pid, s, { money = false, statusDate: sd = null, levelingDelays = null, clearExisting = false } = {}) {
    const S = eng();
    const d = await store.projectDetail(pid); if (!d) return null;
    const tasks = d.tasks || [];
    const tids = tasks.map((t) => t.id);
    const tf = (s.calendars || s.resources) ? await S.taskFieldsFor(tids) : {};
    const assignments = s.resources ? await S.assignmentsFor(tids) : [];
    const resources = s.resources ? await S.resourcesByIds(assignments.map((a) => a.resource_id)) : [];
    const rates = s.resources && money ? await S.ratesFor(resources.map((r) => r.id)) : [];
    const pe = s.calendars ? await S.projectEngine(pid) : { calendar_id: null };
    const ctx = s.calendars ? await S.calendarsCtx() : { calendars: [], exceptions: [], siteHolidays: [] };
    const ec = CAL.engineCalendars({ tasks, projectCalendarId: pe.calendar_id, taskFields: s.calendars ? tf : {}, assignments: s.calendars ? assignments : [], resources: s.calendars ? resources : [], calendarsCtx: ctx });
    const hpd = ec.hours_per_day || 8;
    const engineTasks = tasks.map((t) => ({ ...t, calendar_id: ec.effective[t.id] && ec.effective[t.id].calendar_id != null ? ec.effective[t.id].calendar_id : null,
      leveling_delay_days: s.leveling && !clearExisting ? (tf[t.id] ? tf[t.id].leveling_delay_days : null) : null, priority: tf[t.id] ? tf[t.id].priority : null }));
    const sopts = { anchor: d.project.start_date || null, deadline: d.project.finish_deadline || null, calendar: ec.calendar, calendars: ec.calendars, statusDate: sd, hoursPerDay: hpd };
    const schedule = ENGINE.schedule(engineTasks, levelingDelays ? { ...sopts, levelingDelays } : sopts);
    const specOf = (tid) => { const e = ec.effective[tid]; return e && e.calendar_id != null ? ec.calendars[e.calendar_id] : ec.calendar; };
    const resCal = (r) => ENGINE.makeCalendar(r && s.calendars && r.calendar_id != null && ec.calendars[r.calendar_id] ? ec.calendars[r.calendar_id] : (r && s.calendars && r.calendar_id != null ? CAL.specOf(CAL.resolveCalendar(r.calendar_id, ctx)) : ec.calendar));
    return { d, tasks, engineTasks, tf, assignments, resources, rates, pe, ctx, ec, hpd, sopts, schedule, specOf, resCal };
  }
  /** Loads, over-allocations, per-assignment time-phasing and (money readers) costs. */
  function resourceView(x, money) {
    if (!x.schedule) return null;
    const L = RES.resourceLoads({ schedule: x.schedule, assignments: x.assignments, resources: x.resources, calendarOf: (tid) => ENGINE.makeCalendar(x.specOf(tid)), resourceCalendarOf: x.resCal, hoursPerDay: x.hpd });
    const resById = new Map(x.resources.map((r) => [r.id, r]));
    const rowOf = new Map(x.schedule.tasks.map((t) => [t.id, t]));
    const taskCost = {};
    const assignments = x.assignments.map((a) => {
      const tp = L.timephased[`${a.task_id}:${a.resource_id}`] || { days: [], work_hours: null, work_source: null };
      const out = { task_id: a.task_id, resource_id: a.resource_id, units_pct: a.units_pct, work_hours: a.work_hours, work_hours_effective: tp.work_hours, work_source: tp.work_source, contour: a.contour, rate_table: a.rate_table, timephased: tp.days };
      if (money) {
        const row = rowOf.get(a.task_id);
        const c = RES.assignmentCost(a, resById.get(a.resource_id), x.rates, tp, row && row.es_date);
        out.cost = c.by_currency; out.cost_unknown_reason = c.unknown_reason; out.cost_amount = a.cost_amount; out.cost_currency = a.cost_currency;
        const cur = taskCost[a.task_id] === undefined ? {} : taskCost[a.task_id];
        if (cur === null || c.by_currency == null) taskCost[a.task_id] = null;   // one unknown cost ⇒ the task's cost is unknown
        else { for (const [k, v] of Object.entries(c.by_currency)) cur[k] = Math.round(((cur[k] || 0) + v) * 100) / 100; taskCost[a.task_id] = cur; }
      }
      return out;
    });
    return { assignments, overallocations: L.overallocations, task_costs: money ? taskCost : undefined };
  }
  const resOut = (r, money, rates) => ({ id: r.id, name: r.name, kind: r.kind, generic: r.generic, site_id: r.site_id, max_units_pct: r.max_units_pct, calendar_id: r.calendar_id, material_label: r.material_label, active: r.active, ...(money ? { rates: rates.filter((q) => q.resource_id === r.id) } : {}) });

  // ---- the schedule (the W2-ui data contract) -------------------------------------------------------------------
  router.get('/api/governance/ppm/project/:id/schedule', requireReportSession, async (req, res) => {
    try {
      const s = await gate(res, 'schedule_v2'); if (!s) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      const sd = statusDate(req, res); if (sd === undefined) return;
      const money = !!canSeeMoney(req.reportUser);
      const x = await computeProject(p.id, s, { money, statusDate: sd });
      if (!x) return notFound(res);
      if (!x.schedule) return httpFail(res, Object.assign(new Error('the dependency network has a cycle'), { reason: 'CYCLE' }), 409, { ok: false, code: 'CYCLE' });
      const rv = s.resources ? resourceView(x, money) : null;
      for (const t of x.schedule.tasks) { t.calendar = x.ec.effective[t.id] || null; t.priority = x.tf[t.id] && x.tf[t.id].priority != null ? x.tf[t.id].priority : null; }
      res.json({ ok: true, contract: 'w2-engine/1', project_id: p.id, version_fingerprint: fingerprint(x.tasks, x.tf), switches: s, money_hidden: !money, hours_per_day: x.hpd,
        schedule: x.schedule,
        calendars: s.calendars ? { project_calendar_id: x.pe.calendar_id, resolved: Object.fromEntries(Object.entries(x.ec.resolved).filter(([, v]) => v).map(([k, v]) => [k, { id: v.id, name: v.name, workdays: v.workdays, hours_per_day: v.hours_per_day, holidays: v.holidays, exceptions: v.exceptions, loop: v.loop }])) } : null,
        // the project calendar in the shape public/lib/ganttCore.makeCal reads (ctx.calendar): working exceptions on a
        // non-working weekday cannot be expressed there (listed in working_exceptions for the screen to show)
        ui_calendar: x.ec.calendar ? { workdays: x.ec.calendar.workdays, holidays: [...new Set([...x.ec.calendar.holidays.filter((d) => !x.ec.calendar.exceptions.some((e) => e.date === d && e.working)), ...x.ec.calendar.exceptions.filter((e) => !e.working).map((e) => e.date)])].sort(), working_exceptions: x.ec.calendar.exceptions.filter((e) => e.working).map((e) => e.date) } : null,
        resources: s.resources ? x.resources.map((r) => resOut(r, false, [])) : null,
        assignments: rv ? rv.assignments : null, overallocations: rv ? rv.overallocations : null, task_costs: rv && money ? rv.task_costs : undefined });
    } catch (e) { fail(res, e); }
  });
  /** Plan fingerprint: task ids + versions + stored engine fields — a levelling proposal is applied only on the same plan. */
  function fingerprint(tasks, tf, extra = null) {
    const h = crypto.createHash('sha256');
    h.update(JSON.stringify(tasks.map((t) => [t.id, t.version || 1, tf[t.id] ? [tf[t.id].calendar_id, tf[t.id].priority, tf[t.id].leveling_delay_days] : null])));
    if (extra) h.update(JSON.stringify(extra));
    return h.digest('hex').slice(0, 32);
  }

  // ---- calendars ---------------------------------------------------------------------------------------------------
  router.get('/api/governance/ppm/calendars', requireReportSession, async (req, res) => {
    try {
      if (!(await gate(res, 'calendars'))) return;
      const S = eng(); const ctx = await S.calendarsCtx();
      res.json({ ok: true, can_edit: !!isCommittee(req.reportUser), calendars: ctx.calendars.map((c) => ({ ...c, resolved: (() => { const r = CAL.resolveCalendar(c.id, ctx); return r ? { workdays: r.workdays, hours_per_day: r.hours_per_day, holidays: r.holidays.length, exceptions: r.exceptions.length, loop: r.loop } : null; })() })) });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/calendars', requireReportSession, json, async (req, res) => {
    try {
      if (!(await gate(res, 'calendars'))) return;
      if (!isCommittee(req.reportUser)) return forbidden(res, 'committee-member or admin role required (shared calendars)', 'CALENDAR_SCOPE');
      const id = await eng().saveCalendar(req.body || {}, { user: req.reportUser });
      log(req, 'ppm_calendar_saved', `calendar:${id}`);
      res.json({ ok: true, id });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/calendars/:id/exceptions', requireReportSession, json, async (req, res) => {
    try {
      if (!(await gate(res, 'calendars'))) return;
      if (!Number.isInteger(Number(req.params.id))) return notFound(res);
      if (!isCommittee(req.reportUser)) return forbidden(res, 'committee-member or admin role required (shared calendars)', 'CALENDAR_SCOPE');
      const id = await eng().addException(req.params.id, req.body || {}, { user: req.reportUser });
      log(req, 'ppm_calendar_exception', `calendar:${req.params.id}`, { exception: id });
      res.json({ ok: true, id });
    } catch (e) { fail(res, e); }
  });
  router.delete('/api/governance/ppm/calendars/:id/exceptions/:eid', requireReportSession, json, async (req, res) => {
    try {
      if (!(await gate(res, 'calendars'))) return;
      if (!Number.isInteger(Number(req.params.id)) || !Number.isInteger(Number(req.params.eid))) return notFound(res);
      if (!isCommittee(req.reportUser)) return forbidden(res, 'committee-member or admin role required (shared calendars)', 'CALENDAR_SCOPE');
      await eng().removeException(req.params.id, req.params.eid, { user: req.reportUser });
      log(req, 'ppm_calendar_exception_removed', `calendar:${req.params.id}`, { exception: Number(req.params.eid) });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/project/:id/calendar', requireReportSession, json, async (req, res) => {
    try {
      if (!(await gate(res, 'calendars'))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await writeProject(req, res, p.id)) return;
      const r = await eng().setProjectCalendar(p.id, req.body ? req.body.calendar_id : null, { user: req.reportUser });
      log(req, 'ppm_project_calendar', `project:${p.id}`, { calendar_id: r.calendar_id });
      res.json({ ok: true, ...r });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/task/:id/engine', requireReportSession, json, async (req, res) => {
    try {
      const c = switches(await cfg()); if (!c.calendars && !c.resources) return notFound(res);
      if (!Number.isInteger(Number(req.params.id))) return notFound(res);
      const row = await store.planRow('task', Number(req.params.id)); if (!row) return notFound(res);
      if (!(await readableProject(req.reportUser, row.project_id))) return notFound(res);
      if (await refusePlanWrite(req, res, 'task', { id: row.id })) return;
      const b = { ...(req.body || {}) };
      if (!c.calendars) delete b.calendar_id;
      const fields = await eng().saveTaskFields(row.id, row.project_id, b, { user: req.reportUser });
      log(req, 'ppm_task_engine', `task:${row.id}`, fields);
      res.json({ ok: true, fields });
    } catch (e) { fail(res, e); }
  });

  // ---- resource pool ---------------------------------------------------------------------------------------------
  router.get('/api/governance/ppm/resources', requireReportSession, async (req, res) => {
    try {
      if (!(await gate(res, 'resources'))) return;
      const S = eng(); const u = req.reportUser; const money = !!canSeeMoney(u);
      const list = (await S.listResources({ includeInactive: req.query && req.query.all === '1' && isCommittee(u) })).filter((r) => visibleResource(u, r));
      const rates = money ? await S.ratesFor(list.map((r) => r.id)) : [];
      res.json({ ok: true, money_hidden: !money, can_edit: !!isCommittee(u), contours: RES.CONTOUR_NAMES, rate_tables: RES.RATE_TABLES, resources: list.map((r) => resOut(r, money, rates)) });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/resources', requireReportSession, json, async (req, res) => {
    try {
      if (!(await gate(res, 'resources'))) return;
      if (!isCommittee(req.reportUser)) return forbidden(res, 'committee-member or admin role required (enterprise resource pool)', 'POOL_SCOPE');
      const id = await eng().saveResource(req.body || {}, { user: req.reportUser });
      log(req, 'ppm_resource_saved', `resource:${id}`);
      res.json({ ok: true, id });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/resources/:id/rates', requireReportSession, json, async (req, res) => {
    try {
      if (!(await gate(res, 'resources'))) return;
      if (!Number.isInteger(Number(req.params.id))) return notFound(res);
      if (!isCommittee(req.reportUser)) return forbidden(res, 'committee-member or admin role required (rates are money writes)', 'MONEY_SCOPE');
      const rate = await eng().saveRate(req.params.id, req.body || {}, { user: req.reportUser });
      log(req, 'ppm_resource_rate', `resource:${req.params.id}`, { table: rate.rate_table, from: rate.effective_from });
      res.json({ ok: true, rate, certification: 'not certified — rates are a Finance input' });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/ppm/project/:id/assignments', requireReportSession, async (req, res) => {
    try {
      const s = await gate(res, 'resources'); if (!s) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      const money = !!canSeeMoney(req.reportUser);
      const x = await computeProject(p.id, s, { money });
      if (!x) return notFound(res);
      if (!x.schedule) return httpFail(res, Object.assign(new Error('the dependency network has a cycle'), { reason: 'CYCLE' }), 409, { ok: false, code: 'CYCLE' });
      const rv = resourceView(x, money);
      res.json({ ok: true, money_hidden: !money, resources: x.resources.map((r) => resOut(r, false, [])), assignments: rv.assignments, overallocations: rv.overallocations, task_costs: money ? rv.task_costs : undefined });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/task/:id/assignments', requireReportSession, json, async (req, res) => {
    try {
      if (!(await gate(res, 'resources'))) return;
      if (!Number.isInteger(Number(req.params.id))) return notFound(res);
      const row = await store.planRow('task', Number(req.params.id)); if (!row) return notFound(res);
      if (!(await readableProject(req.reportUser, row.project_id))) return notFound(res);
      if (await refusePlanWrite(req, res, 'task', { id: row.id })) return;
      const list = req.body && Array.isArray(req.body.assignments) ? req.body.assignments : null;
      if (!list) return bad(res, 'assignments must be a list', 'BAD_BODY');
      const committee = !!isCommittee(req.reportUser);
      if (!committee && list.some((a) => a && a.cost_amount != null && a.cost_amount !== '')) return forbidden(res, 'a cost amount is a money write (committee-member or admin role required)', 'MONEY_SCOPE');
      // site perimeter: a non-admin may assign only resources visible to them
      const S = eng(); const pool = new Map((await S.listResources({ includeInactive: true })).map((r) => [r.id, r]));
      if (list.some((a) => { const r = pool.get(Number(a && a.resource_id)); return r && !visibleResource(req.reportUser, r); })) return forbidden(res, 'a resource of another site cannot be assigned', 'RESOURCE_SCOPE');
      const out = await S.replaceTaskAssignments(row.id, row.project_id, list, { user: req.reportUser, withMoney: committee });
      log(req, 'ppm_task_assignments', `task:${row.id}`, { count: out.length });
      res.json({ ok: true, assignments: canSeeMoney(req.reportUser) ? out : out.map(({ cost_amount, cost_currency, ...a }) => a) });
    } catch (e) { fail(res, e); }
  });

  // ---- levelling: proposal (read) → explicit apply (write) -----------------------------------------------------------
  async function proposal(pid, s, { clearExisting = false } = {}) {
    const x = await computeProject(pid, s, { clearExisting });
    if (!x) return null;
    const out = RES.level({ tasks: x.engineTasks.map((t) => (clearExisting ? { ...t, leveling_delay_days: null } : t)), scheduleOpts: x.sopts, assignments: x.assignments, resources: x.resources,
      calendarSpecOf: x.specOf, resourceCalendarOf: x.resCal, priorityOf: (tid) => (x.tf[tid] ? x.tf[tid].priority : null), hoursPerDay: x.hpd, clearExisting });
    const fp = fingerprint(x.tasks, x.tf, { delays: out.delays || null, clear: !!clearExisting });
    return { x, out, fingerprint: fp };
  }
  router.get('/api/governance/ppm/project/:id/leveling', requireReportSession, async (req, res) => {
    try {
      const s = await gate(res, 'leveling'); if (!s) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      const pr = await proposal(p.id, s, { clearExisting: req.query && req.query.clear_existing === '1' });
      if (!pr) return notFound(res);
      if (!pr.out.ok) return httpFail(res, Object.assign(new Error(pr.out.error), { reason: 'CYCLE' }), 409, { ok: false, code: 'CYCLE' });
      const { schedule, ...rest } = pr.out;
      res.json({ ok: true, applied: false, fingerprint: pr.fingerprint, method: 'delay-only, priority-based serial levelling within the project (MS-Project "Level within available slack" off); a move is applied only by POST …/leveling/apply', ...rest });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/project/:id/leveling/apply', requireReportSession, json, async (req, res) => {
    try {
      const s = await gate(res, 'leveling'); if (!s) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await writeProject(req, res, p.id)) return;
      const clear = !!(req.body && (req.body.clear_existing === true || req.body.clear_existing === '1'));
      const pr = await proposal(p.id, s, { clearExisting: clear });
      if (!pr || !pr.out.ok) return httpFail(res, Object.assign(new Error('the dependency network has a cycle'), { reason: 'CYCLE' }), 409, { ok: false, code: 'CYCLE' });
      if (!req.body || req.body.fingerprint !== pr.fingerprint) return httpFail(res, Object.assign(new Error('the plan changed since the proposal was computed — read the proposal again'), { reason: 'STALE_PROPOSAL' }), 409, { ok: false, code: 'STALE_PROPOSAL' });
      const S = eng();
      if (clear) await S.applyLevelingDelays(p.id, {}, { user: req.reportUser, clear: true, note: 'clear before applying a fresh proposal' });
      const r = await S.applyLevelingDelays(p.id, pr.out.delays, { user: req.reportUser, note: `${pr.out.moves.length} task(s) delayed by levelling` });
      log(req, 'ppm_leveling_applied', `project:${p.id}`, { moves: pr.out.moves.length });
      res.json({ ok: true, applied: true, ...r, moves: pr.out.moves.length, project_finish: pr.out.after.project_finish });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/project/:id/leveling/clear', requireReportSession, json, async (req, res) => {
    try {
      if (!(await gate(res, 'leveling'))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await writeProject(req, res, p.id)) return;
      const r = await eng().applyLevelingDelays(p.id, {}, { user: req.reportUser, clear: true });
      log(req, 'ppm_leveling_cleared', `project:${p.id}`, r);
      res.json({ ok: true, ...r });
    } catch (e) { fail(res, e); }
  });

  // ---- baseline slots ----------------------------------------------------------------------------------------------
  async function currentPayload(pid, s, kind, money) {
    const x = await computeProject(pid, s, { money });
    if (!x || !x.schedule) return null;
    const work = {};
    for (const t of x.tasks) work[t.id] = t.effort_hours == null ? null : Number(t.effort_hours);
    let costs = null;
    if (s.resources) {
      const byTask = new Map(); for (const a of x.assignments) byTask.set(a.task_id, true);
      const rv = resourceView(x, money);
      // work of an assigned task = Σ assignment work when every assignment's work is known
      for (const tid of byTask.keys()) { const as = rv.assignments.filter((a) => a.task_id === tid); work[tid] = as.every((a) => a.work_hours_effective != null) ? Math.round(as.reduce((q, a) => q + a.work_hours_effective, 0) * 100) / 100 : null; }
      if (money) costs = rv.task_costs;
    }
    return SLOTS.slotPayload(kind, x.schedule, { tasks: x.tasks, workByTask: work, costByTask: costs });
  }
  router.get('/api/governance/ppm/project/:id/baseline-slots', requireReportSession, async (req, res) => {
    try {
      const s = await gate(res, 'baseline_slots'); if (!s) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      const money = !!canSeeMoney(req.reportUser);
      const slots = await eng().listSlots(p.id);
      const current = await currentPayload(p.id, s, 'baseline', money);
      const strip = (x) => (money ? x : SLOTS.stripCost(x));
      res.json({ ok: true, money_hidden: !money, names: { baseline: Array.from({ length: 11 }, (_, i) => SLOTS.slotName('baseline', i)), interim: Array.from({ length: 10 }, (_, i) => SLOTS.slotName('interim', i + 1)) },
        current: strip(current), slots: slots.map((x) => ({ ...x, payload: strip(x.payload), variance: current ? SLOTS.slotVariance(x.payload, current) : null })) });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/project/:id/baseline-slots', requireReportSession, json, async (req, res) => {
    try {
      const s = await gate(res, 'baseline_slots'); if (!s) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await writeProject(req, res, p.id)) return;
      const b = req.body || {};
      const prob = SLOTS.slotProblem(b.kind, b.slot); if (prob) return bad(res, prob, 'BAD_SLOT');
      if (!(b.reason && String(b.reason).trim().length >= SLOTS.MIN_REASON)) return bad(res, `a reason (${SLOTS.MIN_REASON}+ characters) is required`, 'REASON_REQUIRED');
      // the slot keeps cost only when its author may read money (a non-money author never stores amounts they cannot see)
      const payload = await currentPayload(p.id, s, b.kind, !!canSeeMoney(req.reportUser));
      if (!payload) return httpFail(res, Object.assign(new Error('the dependency network has a cycle'), { reason: 'CYCLE' }), 409, { ok: false, code: 'CYCLE' });
      const slot = await eng().saveSlot(p.id, b.kind, Number(b.slot), payload, { user: req.reportUser, reason: b.reason });
      log(req, 'ppm_baseline_slot_saved', `project:${p.id}`, { slot: slot.name });
      res.json({ ok: true, slot: canSeeMoney(req.reportUser) ? slot : { ...slot, payload: SLOTS.stripCost(slot.payload) } });
    } catch (e) { fail(res, e); }
  });

  // ---- MSPDI ---------------------------------------------------------------------------------------------------------
  /** The project as an MSPDI model (dates = the W2 schedule; rates / costs only for money readers). */
  async function exportModel(pid, s, money) {
    const s2 = { ...s, calendars: true, resources: s.resources };
    const x = await computeProject(pid, s2, { money });
    if (!x || !x.schedule) return { model: null, warnings: [] };
    const warnings = [];
    const rows = new Map(x.schedule.tasks.map((t) => [t.id, t]));
    // outline order (depth-first over the stored order)
    const kidsOf = new Map(); for (const t of x.tasks) { const k = t.parent_id == null ? 0 : t.parent_id; if (!kidsOf.has(k)) kidsOf.set(k, []); kidsOf.get(k).push(t); }
    const order = []; const walk = (k, lvl) => { for (const t of kidsOf.get(k) || []) { order.push([t, lvl]); walk(t.id, lvl + 1); } }; walk(0, 1);
    const ids = new Set(x.tasks.map((t) => t.id));
    for (const t of x.tasks) if (t.parent_id != null && !ids.has(t.parent_id) && !order.some(([o]) => o.id === t.id)) order.push([t, 1]);
    const slots = s.baseline_slots ? (await eng().listSlots(pid)).filter((q) => q.kind === 'baseline') : [];
    const currency = x.d.project.currency || null;
    const usedCals = new Set(); if (x.pe.calendar_id != null) usedCals.add(x.pe.calendar_id);
    const tasks = order.map(([t, lvl]) => {
      const r = rows.get(t.id) || {};
      const f = x.tf[t.id] || {};
      if (f.calendar_id != null) usedCals.add(f.calendar_id);
      const links = new Map((Array.isArray(t.dependency_links) ? t.dependency_links : []).map((l) => [Number(l.id), l]));
      return {
        uid: t.id, id: null, name: t.name, wbs: t.wbs_code, outline_level: lvl, start: r.es_date, finish: r.ef_date, duration_days: r.duration_days, milestone: !!r.milestone, summary: !!r.summary,
        manual: r.mode === 'manual', constraint_type: t.constraint_type, constraint_date: t.constraint_date, deadline: t.deadline, priority: f.priority == null ? 500 : f.priority,
        percent_complete: t.progress_pct == null ? null : Math.round(Number(t.progress_pct)), calendar_uid: f.calendar_id == null ? null : f.calendar_id, work_hours: t.effort_hours == null ? null : Number(t.effort_hours),
        leveling_delay_days: s.leveling && f.leveling_delay_days ? f.leveling_delay_days : 0,
        predecessors: (t.depends_on || []).filter((d) => ids.has(Number(d))).map((d) => { const l = links.get(Number(d)) || {}; return { uid: Number(d), type: l.type || 'FS', lag: l.lag || 0, lag_unit: ENGINE.lagUnit(l.lag_unit) }; }),
        baselines: slots.map((q) => { const bt = ((q.payload && q.payload.tasks) || []).find((y) => y.id === t.id); if (!bt) return null; let cost = null;
          if (money && bt.cost) { const keys = Object.keys(bt.cost); if (keys.length === 1 && keys[0] === currency) cost = bt.cost[currency]; else warnings.push({ code: 'BASELINE_COST_CURRENCY', task_id: t.id, slot: q.slot }); }
          return { number: q.slot, start: bt.start, finish: bt.finish, duration_days: bt.duration_days == null ? null : bt.duration_days, work_hours: bt.work_hours == null ? null : bt.work_hours, cost }; }).filter(Boolean),
      };
    });
    tasks.forEach((t, i) => { t.id = i + 1; });
    const resources = x.resources.map((r, i) => {
      if (r.calendar_id != null) usedCals.add(r.calendar_id);
      const rr = money ? x.rates.filter((q) => q.resource_id === r.id) : [];
      if (rr.some((q) => q.currency !== currency)) warnings.push({ code: 'RATE_CURRENCY', resource_id: r.id, message: 'a rate in another currency than the project\'s is written as a number in the file currency (MSPDI holds one currency)' });
      return { uid: r.id, id: i + 1, name: r.name, type: r.kind, generic: r.generic, material_label: r.material_label, max_units_pct: r.max_units_pct, calendar_uid: r.calendar_id,
        rates: rr.map((q) => ({ table: q.rate_table, from: q.effective_from, standard_rate: q.standard_rate, overtime_rate: q.overtime_rate, cost_per_use: q.cost_per_use })) };
    });
    if (!money && x.resources.length) warnings.push({ code: 'MONEY_OMITTED', message: 'rates and cost amounts are omitted: your account cannot read money' });
    const assignments = x.assignments.map((a, i) => ({ uid: i + 1, task_uid: a.task_id, resource_uid: a.resource_id, units_pct: a.units_pct, work_hours: a.work_hours, contour: a.contour, rate_table: a.rate_table, cost: money ? a.cost_amount : null }));
    const calendars = [...usedCals].map((cid) => {
      const r = CAL.resolveCalendar(cid, x.ctx); if (!r) return null;
      // flattened: the site holidays become non-working exceptions (merged into ranges); base chains are resolved
      const days = new Map(r.holidays.map((d) => [d, false])); for (const e of r.exceptions) days.set(e.date, e.working);
      const exc = []; for (const [d, w] of [...days].sort((a, b) => a[0].localeCompare(b[0]))) { const last = exc[exc.length - 1]; const next = last && new Date(Date.parse(last.to + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10); if (last && last.working === w && next === d) last.to = d; else exc.push({ from: d, to: d, working: w, name: null }); }
      return { uid: cid, name: r.name, is_base: true, base_uid: null, workdays: r.workdays, exceptions: exc };
    }).filter(Boolean);
    return { model: MSPDI.normalizeModel({ name: x.d.project.name, start_date: x.schedule.anchor, finish_date: x.schedule.project_finish, minutes_per_day: Math.round(x.hpd * 60), currency_code: currency, calendar_uid: x.pe.calendar_id, calendars, tasks, resources, assignments }), warnings };
  }
  router.get('/api/governance/ppm/project/:id/mspdi.xml', requireReportSession, async (req, res) => {
    try {
      const s = await gate(res, 'mspdi'); if (!s) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      const { model, warnings } = await exportModel(p.id, s, !!canSeeMoney(req.reportUser));
      if (!model) return httpFail(res, Object.assign(new Error('the dependency network has a cycle'), { reason: 'CYCLE' }), 409, { ok: false, code: 'CYCLE' });
      log(req, 'ppm_mspdi_export', `project:${p.id}`, { tasks: model.tasks.length, warnings: warnings.length });
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="project-${p.id}.xml"`);
      if (warnings.length) res.setHeader('X-MSPDI-Warnings', String(warnings.length));
      res.send(MSPDI.toXml(model));
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/project/:id/mspdi/import', requireReportSession, xmlBody, async (req, res) => {
    try {
      if (!(await gate(res, 'mspdi'))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await writeProject(req, res, p.id)) return;
      const apply = req.query && req.query.apply === '1';
      if (apply && !isCommittee(req.reportUser)) return forbidden(res, 'committee-member or admin role required to apply an import (it creates calendars, pool resources and rates)', 'IMPORT_SCOPE');
      const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : '';
      if (!text.trim()) return bad(res, 'send the MSPDI XML file as the request body', 'EMPTY_BODY');
      let model; try { model = MSPDI.fromXml(text); } catch (e) { return bad(res, e.message, 'MSPDI_PARSE'); }
      const { tasks, opts } = MSPDI.modelToEngine(model);
      const check = ENGINE.schedule(tasks, opts);
      const summary = { tasks: model.tasks.length, summaries: model.tasks.filter((t) => t.summary).length, links: model.tasks.reduce((a, t) => a + t.predecessors.length, 0), calendars: model.calendars.length, resources: model.resources.length,
        assignments: model.assignments.length, baselines: [...new Set(model.tasks.flatMap((t) => t.baselines.map((b) => b.number)))].sort((a, b) => a - b), currency: model.currency_code,
        cycle: !check, project_finish: check ? check.project_finish : null, warnings: check ? check.warnings.length : null };
      if (!apply) return res.json({ ok: true, dry_run: true, summary, apply_with: `POST …/mspdi/import?apply=1 (committee) into an empty project` });
      if (!check) return httpFail(res, Object.assign(new Error('the file\'s dependency network has a cycle'), { reason: 'CYCLE' }), 409, { ok: false, code: 'CYCLE' });
      const r = await eng().importModel(p.id, model, { user: req.reportUser });
      log(req, 'ppm_mspdi_import', `project:${p.id}`, { tasks: r.tasks, links: r.links });
      res.json({ ok: true, dry_run: false, summary, result: r });
    } catch (e) { fail(res, e); }
  });
};
