'use strict';
const xpGate = require('../services/exportPolicy').gate;   // P9 / B7 — one export policy (allow / mask / deny + export log + watermark)
// Plan E wave 2 (W2-PPM) — PPM additions registered on the governance router (routes/governance.js calls this with
// its own helpers, so the access rules are the SAME functions: committee, money-read rule, A-15 read scope, plan writes).
// Every action exists only while its PROPOSED switch is '1' (404 while '0' = today):
//   E-P03 ppm_capacity_view          GET  /api/governance/ppm/capacity                capacity per site × week + conflicts (no money)
//   E-P04 ppm_budget_periods_enabled GET/PUT /api/governance/ppm/project/:id/budget-periods  money readers / committee
//   E-P05 benefit_owner_link_enabled  (PUT /portfolio/benefit accepts owner_user_id; GET /api/me/work lists owned benefits)
//   E-P06 ppm_raci_enabled           GET/PUT /api/governance/ppm/project/:id/raci · GET …/raci.csv   read scope / plan-write rule
//   E-P06 ppm_templates_enabled      GET /api/governance/ppm/templates · POST /templates {project_id,name} · POST /templates/:id/approve
//                                    · POST /templates/:id/create-project {objective_id,key,name,site_id}       committee (approver ≠ author)
//   E-P08 ppm_annual_pack_enabled    GET /api/governance/ppm/annual-pack.xlsx?year=YYYY  DRAFT pack (money rule; RFI sheet committee)
//   R2-WORKBENCH (team, time, change requests): routes/governanceWorkbench.js, registered at the end of this file
//   W2-ENGINE ppm_calendars_enabled / ppm_resources_enabled / ppm_leveling_enabled / ppm_baseline_slots_enabled /
//                                    ppm_mspdi_enabled (+ GET …/schedule under ppm_schedule_engine_v2_ui): routes/ppmEngine.js
//   W1-EVM ppm_evm_enabled           earned value (project / portfolio / task fields): routes/governanceEvm.js, same
//   W4 ppm_project_roles_enabled / ppm_comments_enabled: routes/governanceCollab.js (roles, comments + @mentions)
//   GET  /api/governance/ppm/features  which of these switches are on (the pages show a tab / panel only then)
// Paths live under /api/governance/ppm/ so they never collide with /portfolio/:kind.
const { fail: httpFail } = require('../services/httpError');

module.exports = function governancePpmRoutes(router, h) {
  const { store, rdb, reportConfig, requireReportSession, json, viewFor, isCommittee, canSeeMoney, readableProject, refusePlanWrite, log } = h;
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false, ...(e && e.reason ? { code: e.reason } : {}) });
  const cfg = async () => reportConfig.getConfig(rdb().db);
  const on = (c, k) => String(c[k]) === '1';
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });
  const wbStore = () => require('../services/ppmWorkbenchStore').makeWorkbenchStore(rdb().pgHandle(), store);
  const forbidden = (res, msg, code) => httpFail(res, Object.assign(new Error(msg), { reason: code }), 403, { ok: false, ...(code ? { code } : {}) });

  router.get('/api/governance/ppm/features', requireReportSession, async (req, res) => {
    try {
      const c = await cfg();
      res.json({ ok: true, capacity: on(c, 'ppm_capacity_view'), budget_periods: on(c, 'ppm_budget_periods_enabled'), benefit_owner_link: on(c, 'benefit_owner_link_enabled'), benefit_value_class: on(c, 'benefit_value_class_enabled'), raci: on(c, 'ppm_raci_enabled'), templates: on(c, 'ppm_templates_enabled'), annual_pack: on(c, 'ppm_annual_pack_enabled'),
        team: on(c, 'ppm_project_team_enabled'), time_entries: on(c, 'ppm_time_entries_enabled'), change_requests: on(c, 'ppm_change_requests_enabled'), evm: on(c, 'ppm_evm_enabled'), portfolio_views: on(c, 'portfolio_views_enabled'), roadmap_publication: on(c, 'roadmap_publication_enabled'), schedule_v2: on(c, 'ppm_schedule_engine_v2_ui'), gantt_v2: on(c, 'ppm_gantt_v2_enabled'),
        timesheets: on(c, 'ppm_time_entries_enabled') && on(c, 'ppm_timesheet_approval_enabled'), cr_simulation: on(c, 'ppm_change_requests_enabled') && on(c, 'ppm_cr_simulation_enabled'),
        project_roles: on(c, 'ppm_project_roles_enabled'), comments: on(c, 'ppm_comments_enabled'), agile_board: on(c, 'ppm_agile_board_enabled'), roadmap_nnl: on(c, 'ppm_roadmap_nnl_enabled'), offline_edit: on(c, 'ppm_offline_edit_enabled'),   // W4
        calendars: on(c, 'ppm_calendars_enabled'), resources: on(c, 'ppm_resources_enabled'), leveling: on(c, 'ppm_leveling_enabled') && on(c, 'ppm_resources_enabled'), baseline_slots: on(c, 'ppm_baseline_slots_enabled'), mspdi: on(c, 'ppm_mspdi_enabled'),   // W2-ENGINE

        simplified_view: on(c, 'ppm_simplified_view_enabled'), project_rag: on(c, 'ppm_project_rag_enabled'), dcma: on(c, 'ppm_dcma_enabled'), gate_checklist: on(c, 'ppm_gate_checklist_enabled'), raid: on(c, 'ppm_raid_enabled'), project_report: on(c, 'ppm_project_report_enabled') });
    } catch (e) { fail(res, e); }
  });

  // ---- E-P03 capacity per site and week (no money, the reader's scoped portfolio) -------------------------------
  router.get('/api/governance/ppm/capacity', requireReportSession, async (req, res) => {
    try {
      if (!on(await cfg(), 'ppm_capacity_view')) return notFound(res);
      const PV = require('../public/lib/ppmVisuals');
      const { v } = await viewFor(req.reportUser);
      // R2-WB-04 — with the team switch on, a task of unknown allocation reads its owner's member allocation
      const members = on(await cfg(), 'ppm_project_team_enabled') ? await wbStore().listMembersFor((v.projects || []).map((p) => p.id)) : [];
      const capacity = PV.capacityBySite(v.tasks || [], (v.projects || []).map((p) => ({ id: p.id, site_id: p.site_id })), { today: new Date().toISOString().slice(0, 10), members });
      const site_names = {};
      for (const s of (await rdb().listSites({ includeInactive: true })) || []) site_names[String(s.id)] = s.name;
      res.json({ ok: true, capacity, site_names, as_of: new Date().toISOString() });
    } catch (e) { fail(res, e); }
  });

  // ---- E-P04 budget periods (money rule unchanged: committee, admin tier, finance-viewer read; the committee writes) --
  const BP = require('../services/ppmBudgetPeriods');
  router.get('/api/governance/ppm/project/:id/budget-periods', requireReportSession, async (req, res) => {
    try {
      if (!on(await cfg(), 'ppm_budget_periods_enabled')) return notFound(res);
      if (!(await readableProject(req.reportUser, req.params.id))) return notFound(res);
      if (!canSeeMoney(req.reportUser)) return res.json({ ok: true, money_hidden: true, view: null, certification: BP.CERTIFICATION });
      const view = BP.view(await store.listBudgetPeriods(req.params.id), { asOf: new Date().toISOString() });
      res.json({ ok: true, money_hidden: false, can_edit: !!isCommittee(req.reportUser), view, certification: BP.CERTIFICATION });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/project/:id/budget-periods', requireReportSession, json, async (req, res) => {
    try {
      if (!on(await cfg(), 'ppm_budget_periods_enabled')) return notFound(res);
      if (!isCommittee(req.reportUser)) return forbidden(res, 'committee-member or admin role required');
      if (!(await readableProject(req.reportUser, req.params.id))) return notFound(res);
      const rows = await store.saveBudgetPeriod(req.params.id, req.body || {}, { user: req.reportUser });
      log(req, 'budget_period_saved', `project:${req.params.id}`, { kind: req.body && req.body.kind, period: req.body && req.body.period, currency: req.body && req.body.currency });
      res.json({ ok: true, view: BP.view(rows, { asOf: new Date().toISOString() }), certification: BP.CERTIFICATION });
    } catch (e) { fail(res, e); }
  });

  // ---- E-P06 RACI (task × person, exactly one A per task) --------------------------------------------------------
  const RC = require('../services/ppmRaci');
  const raciMatrix = async (pid) => { const d = await store.projectDetail(pid); return RC.matrix(await store.getRaci(pid), (d && d.tasks) || []); };
  router.get('/api/governance/ppm/project/:id/raci', requireReportSession, async (req, res) => {
    try {
      if (!on(await cfg(), 'ppm_raci_enabled')) return notFound(res);
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      res.json({ ok: true, rows: await store.getRaci(p.id), matrix: await raciMatrix(p.id), letters: RC.LETTERS });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/ppm/project/:id/raci.csv', requireReportSession, xpGate('governance.raci'), async (req, res) => {
    try {
      if (!on(await cfg(), 'ppm_raci_enabled')) return notFound(res);
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="raci-project-${p.id}.csv"`);
      res.send('\ufeff' + RC.raciCsv(await raciMatrix(p.id)));
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/project/:id/raci', requireReportSession, json, async (req, res) => {
    try {
      if (!on(await cfg(), 'ppm_raci_enabled')) return notFound(res);
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      if (await refusePlanWrite(req, res, 'task', { body: { project_id: p.id } })) return;
      const rows = await store.saveRaci(p.id, (req.body && req.body.rows) || [], { user: req.reportUser });
      log(req, 'raci_saved', `project:${p.id}`, { rows: rows.length });
      res.json({ ok: true, rows, matrix: await raciMatrix(p.id) });
    } catch (e) { httpFail(res, e, undefined, { ok: false, ...(e.reason ? { code: e.reason } : {}), ...(e.errors ? { errors: e.errors } : {}) }); }
  });

  // ---- E-P06 project templates (structure only; draft until another committee member approves) -------------------
  const tplOn = async (res) => { if (!on(await cfg(), 'ppm_templates_enabled')) { notFound(res); return false; } return true; };
  const committeeOnly = (req, res) => { if (isCommittee(req.reportUser)) return true; forbidden(res, 'committee-member or admin role required'); return false; };
  router.get('/api/governance/ppm/templates', requireReportSession, async (req, res) => {
    try { if (!(await tplOn(res))) return; res.json({ ok: true, committee: !!isCommittee(req.reportUser), me: Number(req.reportUser.id), templates: await store.listTemplates() }); } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/templates', requireReportSession, json, async (req, res) => {
    try {
      if (!(await tplOn(res)) || !committeeOnly(req, res)) return;
      const pid = Number(req.body && req.body.project_id);
      if (!Number.isInteger(pid) || !(await readableProject(req.reportUser, pid))) return notFound(res);
      const t = await store.saveTemplateFromProject(pid, { name: req.body && req.body.name, user: req.reportUser });
      log(req, 'template_saved', `template:${t.id}`, { project_id: pid }); res.json({ ok: true, template: t });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/templates/:id/approve', requireReportSession, json, async (req, res) => {
    try {
      if (!(await tplOn(res)) || !committeeOnly(req, res)) return;
      const t = await store.approveTemplate(req.params.id, { user: req.reportUser, note: req.body && req.body.note });
      log(req, 'template_approved', `template:${t.id}`); res.json({ ok: true, template: t });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/templates/:id/create-project', requireReportSession, json, async (req, res) => {
    try {
      if (!(await tplOn(res)) || !committeeOnly(req, res)) return;
      const pid = await store.createProjectFromTemplate(req.params.id, req.body || {}, { user: req.reportUser, allocUnspecified: (await cfg()).ppm_alloc_unspecified });
      log(req, 'project_from_template', `template:${req.params.id}`, { project_id: pid }); res.json({ ok: true, project_id: pid });
    } catch (e) { fail(res, e); }
  });

  // ---- E-P08 annual planning DRAFT pack (R16) — the reader's scoped portfolio, money rule, no envelope ---------------
  router.get('/api/governance/ppm/annual-pack.xlsx', requireReportSession, xpGate('governance.annual_pack'), async (req, res) => {
    try {
      if (!on(await cfg(), 'ppm_annual_pack_enabled')) return notFound(res);
      const year = Number(req.query.year || new Date().getUTCFullYear() + 1);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) return httpFail(res, new Error('year must be YYYY'), 400, { ok: false });
      const AP = require('../services/annualPlanPack'), PV = require('../public/lib/ppmVisuals');
      const u = req.reportUser;
      const { v } = await viewFor(u);   // W4: read first — it marks a client project role, which never gets amounts
      const money = (req.exportPolicy ? !!req.exportPolicy.money : !!canSeeMoney(u)) && !u.__ppmClient, committee = !!isCommittee(u);
      const capacity = PV.capacityBySite(v.tasks || [], (v.projects || []).map((p) => ({ id: p.id, site_id: p.site_id })), { today: new Date().toISOString().slice(0, 10) });
      const pack = AP.buildAnnualPack({ year, view: { projects: (v.projects || []).map((p) => (money ? p : { ...p, budget: undefined, spent: undefined })) }, money, capacity, rfis: committee ? await store.listRfi({}) : [], rfiVisible: committee, asOf: new Date().toISOString() });
      log(req, 'annual_pack', `year:${year}`, { money });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="annual-plan-DRAFT-${year}.xlsx"`);
      res.send(AP.toWorkbookBuffer(pack));
    } catch (e) { fail(res, e); }
  });

  // R2-WORKBENCH (REBUILD-SPEC R5): team, time entries, change requests — routes/governanceWorkbench.js
  require('./governanceWorkbench')(router, h);
  // W1-EVM (PPM parity E-EVM-1): earned value — routes/governanceEvm.js (switch ppm_evm_enabled)
  require('./governanceEvm')(router, h);
  // W2-ENGINE (PPM parity W2): schedule contract, calendars, resource pool, levelling, baseline slots, MSPDI — routes/ppmEngine.js
  require('./ppmEngine')(router, h);
  // W4 (PPM parity, enterprise): project roles + comments with @mentions — routes/governanceCollab.js
  require('./governanceCollab')(router, h);
  // W3-GOVERNANCE (PPM parity W3): simplified view, RAG, DCMA, gate checklists, RAID, project report — routes/governanceW3.js
  require('./governanceW3')(router, h);
};
