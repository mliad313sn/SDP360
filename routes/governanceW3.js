'use strict';
// W3-GOVERNANCE (PPM parity W3: F1–F5, G1–G3, H6, T9–T11) — registered by routes/governancePpm.js on the governance
// router with the SAME helpers (A-15 read scope, committee, plan-write rule). Every action exists only while its PROPOSED
// switch is '1' (404 while '0' = today). ADR: docs/ai-decisions/ADR-W3-GOVERNANCE-executive-governance.md.
//   ppm_simplified_view_enabled  GET /api/governance/ppm/project/:id/summary   KPI cards, phase strip, top risks, next
//                                milestones (budget burn: admin tier + finance-viewer only)
//                                GET/PUT /api/governance/ppm/view-mode {mode: simplified|expert}   per-user preference
//   ppm_project_rag_enabled      GET /api/governance/ppm/project/:id/rag   composite RAG with hysteresis (state stored)
//   ppm_dcma_enabled             GET /api/governance/ppm/project/:id/dcma[?status_date=]   DCMA 14-point check
//   ppm_gate_checklist_enabled   GET /api/governance/ppm/project/:id/gates            checklists + evaluation per gate
//                                PUT /api/governance/ppm/project/:id/gates/:gate      define (committee)
//                                POST …/gates/:gate/evidence {item_key, link, note, withdrawn}   plan-write rule
//                                POST …/gates/:gate/signoff {decision, reason}         a named approver, ≠ owner
//                                (the stage move itself — routes/governance.js — refuses while the checklist is incomplete)
//   ppm_raid_enabled             GET /api/governance/ppm/project/:id/raid · PUT /api/governance/ppm/project/:id/raid
//                                (amounts: admin tier + finance-viewer only — invariant 2, not the wider committee rule)
//   ppm_project_report_enabled   GET /api/governance/ppm/project/:id/report.html | report.xlsx   (export policy)
const { fail: httpFail } = require('../services/httpError');
const xpGate = require('../services/exportPolicy').gate;

module.exports = function governanceW3Routes(router, h) {
  const { store, rdb, reportConfig, requireReportSession, json, isCommittee, readableProject, refusePlanWrite, log } = h;
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false, ...(e && e.reason ? { code: e.reason } : {}) });
  const cfg = async () => reportConfig.getConfig(rdb().db);
  const on = (c, k) => String(c[k]) === '1';
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });
  const forbidden = (res, msg, code) => httpFail(res, Object.assign(new Error(msg), { reason: code }), 403, { ok: false, code });
  const w3 = () => require('../services/ppm/governanceW3Store').makeW3Store(rdb().pgHandle(), store);
  const ctxOf = (...a) => require('../services/ppm/w3Context').projectContext(...a);
  /** Invariant 2 — amounts for the admin tier and finance-viewer only. */
  const moneyStrict = (u) => !!(rdb().userHasRole(u, 'admin') || rdb().userHasRole(u, 'finance-viewer'));
  const sw = (key) => async (req, res, next) => { try { if (on(await cfg(), key)) return next(); return notFound(res); } catch (e) { return fail(res, e); } };
  const project = async (req, res) => { const p = await readableProject(req.reportUser, req.params.id); if (!p) notFound(res); return p; };
  const statusDate = (req, res) => {
    const s = req.query && req.query.status_date;
    if (s == null || s === '') return new Date().toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(s)) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s) return String(s);
    httpFail(res, Object.assign(new Error('status_date must be YYYY-MM-DD'), { reason: 'BAD_STATUS_DATE' }), 400, { ok: false, code: 'BAD_STATUS_DATE' }); return null;
  };

  // ---- simplified view ----------------------------------------------------------------------------------------
  router.get('/api/governance/ppm/view-mode', requireReportSession, sw('ppm_simplified_view_enabled'), async (req, res) => {
    try { res.json({ ok: true, mode: (await w3().viewMode(req.reportUser.id)) || 'expert' }); } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/view-mode', requireReportSession, sw('ppm_simplified_view_enabled'), json, async (req, res) => {
    try { const mode = await w3().setViewMode(req.reportUser.id, String((req.body && req.body.mode) || '')); res.json({ ok: true, mode }); } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/ppm/project/:id/summary', requireReportSession, sw('ppm_simplified_view_enabled'), async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      const c = await cfg(), money = moneyStrict(req.reportUser);
      const x = await ctxOf({ store, rdb: rdb(), cfg: c, projectId: p.id, money });
      if (!x) return notFound(res);
      res.json({ ok: true, project: { id: Number(x.d.project.id), key: x.d.project.key, name: x.d.project.name, stage: x.d.project.stage || 'proposal' }, ...x.summary,
        money_hidden: !money, rag_enabled: on(c, 'ppm_project_rag_enabled'), evm_enabled: on(c, 'ppm_evm_enabled'), mode: (await w3().viewMode(req.reportUser.id)) || 'expert', status_date: x.status_date });
    } catch (e) { fail(res, e); }
  });

  // ---- composite RAG ------------------------------------------------------------------------------------------
  router.get('/api/governance/ppm/project/:id/rag', requireReportSession, sw('ppm_project_rag_enabled'), async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      const x = await ctxOf({ store, rdb: rdb(), cfg: await cfg(), projectId: p.id, money: false, persistRag: true, user: req.reportUser });
      if (!x) return notFound(res);
      res.json({ ok: true, rag: x.rag.rag, components: x.rag.components, measured: x.rag.measured, thresholds: x.ragThresholds.thresholds, thresholds_status: x.ragThresholds.status, threshold_problems: x.ragThresholds.problems });
    } catch (e) { fail(res, e); }
  });

  // ---- DCMA 14 ------------------------------------------------------------------------------------------------
  router.get('/api/governance/ppm/project/:id/dcma', requireReportSession, sw('ppm_dcma_enabled'), async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      const sd = statusDate(req, res); if (!sd) return;
      const x = await ctxOf({ store, rdb: rdb(), cfg: await cfg(), projectId: p.id, money: false, statusDate: sd });
      if (!x) return notFound(res);
      res.json({ ok: true, ...x.dcma });
    } catch (e) { fail(res, e); }
  });

  // ---- stage-gate checklists ----------------------------------------------------------------------------------
  const GC = require('../services/ppm/gateChecklist');
  const gateParam = (req, res) => { const g = String(req.params.gate || ''); if (!GC.STAGES.includes(g)) { httpFail(res, Object.assign(new Error('unknown stage ' + g), { reason: 'STAGE_UNKNOWN' }), 400, { ok: false, code: 'STAGE_UNKNOWN' }); return null; } return g; };
  router.get('/api/governance/ppm/project/:id/gates', requireReportSession, sw('ppm_gate_checklist_enabled'), async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      const s = w3(); const gates = [];
      for (const g of GC.STAGES) gates.push(await s.evaluateGate(p.id, g));
      const defs = await s.listChecklists(p.id);
      res.json({ ok: true, can_define: !!isCommittee(req.reportUser), me: Number(req.reportUser.id), gates, definitions: defs.map((d) => ({ gate_to: d.gate_to, version: d.version, definition: d.definition })), note: GC.LEGAL_NOTE });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/project/:id/gates/:gate', requireReportSession, sw('ppm_gate_checklist_enabled'), json, async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      const g = gateParam(req, res); if (!g) return;
      if (!isCommittee(req.reportUser)) return forbidden(res, 'the committee defines a gate checklist', 'COMMITTEE_ONLY');
      const cl = await w3().saveChecklist(p.id, g, req.body || {}, { user: req.reportUser });
      log(req, 'gate_checklist_defined', `project:${p.id}`, { gate: g, version: cl.version });
      res.json({ ok: true, checklist: cl, evaluation: await w3().evaluateGate(p.id, g) });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/project/:id/gates/:gate/evidence', requireReportSession, sw('ppm_gate_checklist_enabled'), json, async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      const g = gateParam(req, res); if (!g) return;
      if (await refusePlanWrite(req, res, 'task', { body: { project_id: p.id } })) return;
      await w3().addEvidence(p.id, g, req.body || {}, { user: req.reportUser });
      log(req, 'gate_evidence', `project:${p.id}`, { gate: g, item: String((req.body && req.body.item_key) || '') });
      res.json({ ok: true, evaluation: await w3().evaluateGate(p.id, g) });
    } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/project/:id/gates/:gate/signoff', requireReportSession, sw('ppm_gate_checklist_enabled'), json, async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      const g = gateParam(req, res); if (!g) return;
      const dec = GC.normaliseDecision(req.body || {});
      const cl = await w3().getChecklist(p.id, g); if (!cl) return notFound(res);
      const u = req.reportUser;
      const isOwner = require('../services/portfolioAccess').ownerMatches(p, u);
      const el = GC.eligibleSlots(cl.definition, u, (role) => !!rdb().userHasRole(u, role), isOwner);
      if (el.error) return forbidden(res, el.error.error, el.error.code);
      const r = await w3().addSignoff(p.id, g, dec, { user: u, eligible: el.slots });
      log(req, 'gate_signoff', `project:${p.id}`, { gate: g, decision: dec.decision, slot: r.slot });
      res.json({ ok: true, slot: r.slot, evaluation: await w3().evaluateGate(p.id, g) });
    } catch (e) { fail(res, e); }
  });

  // ---- RAID ---------------------------------------------------------------------------------------------------
  const RAID = require('../services/ppm/raid');
  router.get('/api/governance/ppm/project/:id/raid', requireReportSession, sw('ppm_raid_enabled'), async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      const money = moneyStrict(req.reportUser), today = new Date().toISOString().slice(0, 10);
      const items = (await w3().listRaid(p.id)).map((r) => RAID.view(r.row, r.details, { today, money }));
      res.json({ ok: true, items, kinds: RAID.KINDS, responses: RAID.RESPONSES, money_hidden: !money, exposure_totals: money ? RAID.exposureTotals(items) : null, review_overdue: items.filter((i) => i.review_overdue).length });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/project/:id/raid', requireReportSession, sw('ppm_raid_enabled'), json, async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      const b = req.body || {};
      if (b.id != null) { const ex = await w3().raidEntry(b.id); if (!ex || ex.project_id !== Number(p.id)) return notFound(res); }
      if (await refusePlanWrite(req, res, 'risk', { id: b.id != null ? Number(b.id) : null, body: { ...b, project_id: p.id } })) return;
      const money = moneyStrict(req.reportUser);
      if (!money && (b.impact_amount != null && b.impact_amount !== '')) return forbidden(res, 'an amount is entered by the admin tier or finance-viewer', 'MONEY_SCOPE');
      const id = await w3().saveRaid(p.id, b, { user: req.reportUser, keepMoney: !money });
      log(req, b.id != null ? 'raid_updated' : 'raid_created', `project:${p.id}`, { raid: id });
      const today = new Date().toISOString().slice(0, 10);
      const it = (await w3().listRaid(p.id)).find((r) => Number(r.row.id) === id);
      res.json({ ok: true, item: RAID.view(it.row, it.details, { today, money }) });
    } catch (e) { fail(res, e); }
  });

  // ---- project status report (HTML printable + Excel) ---------------------------------------------------------
  const RP = require('../services/ppm/projectReport');
  async function reportData(req, res) {
    const p = await project(req, res); if (!p) return null;
    const money = !!(req.exportPolicy && req.exportPolicy.money);
    const x = await ctxOf({ store, rdb: rdb(), cfg: await cfg(), projectId: p.id, money });
    if (!x) { notFound(res); return null; }
    return { money, block: { project: x.project, summary: x.summary, rag: x.rag, dcma: x.dcma, raid: x.raid || [], gates: x.gates } };
  }
  router.get('/api/governance/ppm/project/:id/report.html', requireReportSession, sw('ppm_project_report_enabled'), xpGate('governance.project_report'), async (req, res) => {
    try {
      const r = await reportData(req, res); if (!r) return;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(RP.buildReportHtml({ title: `Project status — ${r.block.project.key || ''}`, asOf: new Date().toISOString().slice(0, 10), blocks: [r.block], money: r.money }));
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/ppm/project/:id/report.xlsx', requireReportSession, sw('ppm_project_report_enabled'), xpGate('governance.project_report'), async (req, res) => {
    try {
      const r = await reportData(req, res); if (!r) return;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="project-${String(r.block.project.key || r.block.project.id).replace(/[^A-Za-z0-9_-]/g, '_')}-status.xlsx"`);
      res.send(RP.buildReportWorkbook({ blocks: [r.block], money: r.money, asOf: new Date().toISOString().slice(0, 10) }));
    } catch (e) { fail(res, e); }
  });
};
