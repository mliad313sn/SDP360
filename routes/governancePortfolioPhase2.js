'use strict';
// PORTFOLIO LOT 6 (IT portfolio reconstruction spec §12, §13, §16, §17, §29, §33 — Phase 2) — registered on the
// governance router (routes/governance.js calls this with its OWN helpers, so the access rules are the SAME functions:
// readableProject / viewFor = A-15 site scope + B3 sensitive + W4 roles; refusePlanWrite = the plan-write rule;
// canSeeMoney = the amount rule). Every route answers 404 while its PROPOSED switch is '0' (= today).
//
//  ppm_structured_dependencies_enabled
//   GET    /api/governance/ppm/project/:id/dependencies              structured rows + legacy depends_on entries + flags
//   POST   /api/governance/ppm/project/:id/dependencies              create (plan-write rule; predecessor must be readable)
//   PUT    /api/governance/ppm/project/:id/dependencies/:depId       update            DELETE …/:depId  soft delete
//   GET    /api/governance/ppm/project/:id/risk-exposure             4-level exposure, residual, due date, rollup
//   PUT    /api/governance/ppm/project/:id/risks/:riskId/residual    {residual_probability, residual_impact, due_date}
//   GET    /api/governance/ppm/portfolio/dependencies                graph over the readable portfolio + loops + flags
//   GET    /api/governance/ppm/portfolio/risk-exposure               per project + totals per level
//  ppm_resource_demand_enabled
//   GET/POST /api/governance/ppm/project/:id/demand · PUT/DELETE …/demand/:lineId
//   GET    /api/governance/ppm/portfolio/capacity                    monthly load per skill vs ppm_capacity_fte (PROPOSED RAG)
//          view_partial (response) = the reader's scope misses demand → no colour; cell.partial = the cell holds
//          unknown_lines lines without an FTE (sum is a lower bound). Two meanings, two names (P11 r6 R6-4).
//  ppm_effort_scoring_enabled
//   GET/PUT /api/governance/ppm/project/:id/effort · GET /api/governance/ppm/portfolio/effort
//  ppm_documents_enabled
//   GET    /api/governance/ppm/project/:id/documents                 metadata (no blob path); money documents restricted
//   POST   /api/governance/ppm/project/:id/documents?doc_type=&title=   raw body, Content-Type = the file type (≤ 10 MB)
//   GET    /api/governance/ppm/project/:id/documents/:docId/download  read scope (+ amount rule for money documents)
//   DELETE /api/governance/ppm/project/:id/documents/:docId          soft delete (plan-write rule)
//  ppm_scenarios_enabled
//   POST   /api/governance/ppm/portfolio/scenario {shifts:[{project_id, months}], exclude:[ids]}   READ-ONLY what-if
// Nothing here carries an amount. Unknown stays null (capacity, score, level), never 0 / green.
const { fail: httpFail } = require('../services/httpError');
const xpGate = require('../services/exportPolicy').gate;   // P9 / B7 — the document download is an export (log + optional watermark + amount rule)
const SD = require('../services/ppm/structuredDependencies');
const RD = require('../services/ppm/resourceDemand');
const ES = require('../services/ppm/effortScoring');
const RX = require('../services/ppm/riskExposure');
const PD = require('../services/ppm/projectDocuments');
const SC = require('../services/ppm/portfolioScenario');

module.exports = function governancePortfolioPhase2Routes(router, h) {
  const { store, rdb, reportConfig, requireReportSession, json, viewFor, canSeeMoney, readableProject, refusePlanWrite, log } = h;
  const express = require('express');
  const rawDoc = express.raw({ type: () => true, limit: PD.MAX_BYTES + 1024 });
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false, ...(e && e.reason ? { code: e.reason } : {}) });
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });
  const cfg = async () => reportConfig.getConfig(rdb().db);
  const on = (c, k) => String(c[k]) === '1';
  const sw = (...keys) => async (req, res, next) => { try { const c = await cfg(); if (keys.every((k) => on(c, k))) { req.__p2cfg = c; return next(); } return notFound(res); } catch (e) { return fail(res, e); } };
  const p2 = () => require('../services/ppm/portfolioPhase2Store').makePhase2Store(rdb().pgHandle(), store);
  const today = () => new Date().toISOString().slice(0, 10);
  const project = async (req, res) => { const p = await readableProject(req.reportUser, req.params.id); if (!p) notFound(res); return p; };
  const writeGate = (req, res, p) => refusePlanWrite(req, res, 'task', { body: { project_id: p.id } });
  const money = (u) => !!canSeeMoney(u) && !u.__ppmClient;
  const intOr404 = (res, v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) { notFound(res); return null; } return n; };
  async function readable(req) { const { v } = await viewFor(req.reportUser); return v.projects || []; }

  // ---- §12 dependencies -------------------------------------------------------------------------------------------
  async function depsPayload(req, p) {
    const projects = await readable(req);
    const mine = await p2().listDependencies([p.id]);
    const byId = new Map(projects.map((x) => [Number(x.id), x]));
    if (!byId.has(Number(p.id))) byId.set(Number(p.id), p);
    const pv = SD.portfolioView([...byId.values()], mine, { today: today() });
    const items = pv.items.filter((i) => i.project_id === Number(p.id));
    const dependents = (await p2().listDependencies(projects.map((x) => x.id))).filter((d) => d.predecessor_project_id === Number(p.id)).map((d) => ({ id: d.id, project_id: d.project_id, label: byId.has(d.project_id) ? `${byId.get(d.project_id).key || ''} — ${byId.get(d.project_id).name || ''}` : null, status: d.status }));
    const loops = SD.findCycles(await p2().allEdges()).filter((c) => c.includes(Number(p.id)));
    return { items, dependents, in_cycle: loops.length > 0, categories: SD.EXTERNAL_CATEGORIES, statuses: SD.STATUSES, criticality: SD.CRITICALITY, projects: projects.filter((x) => Number(x.id) !== Number(p.id)).map((x) => ({ id: Number(x.id), label: `${x.key || ''} — ${x.name || ''}` })) };
  }
  router.get('/api/governance/ppm/project/:id/dependencies', requireReportSession, sw('ppm_structured_dependencies_enabled'), async (req, res) => {
    try { const p = await project(req, res); if (!p) return; res.json({ ok: true, ...(await depsPayload(req, p)), as_of: new Date().toISOString() }); } catch (e) { fail(res, e); }
  });
  async function saveDep(req, res, depId) {
    const p = await project(req, res); if (!p) return;
    const b = req.body || {};
    if (depId != null) { const ex = await p2().dependency(depId); if (!ex || ex.project_id !== Number(p.id)) return notFound(res); }
    if (await writeGate(req, res, p)) return;
    if (b.predecessor_project_id != null && b.predecessor_project_id !== '' && !(await readableProject(req.reportUser, b.predecessor_project_id))) return httpFail(res, Object.assign(new Error('predecessor project not found'), { reason: 'DEP_TARGET' }), 404, { ok: false, code: 'DEP_TARGET' });
    const id = await p2().saveDependency(p.id, b, { user: req.reportUser, id: depId });
    log(req, depId != null ? 'ppm_dependency_updated' : 'ppm_dependency_added', `project:${p.id}`, { dependency: id });
    res.json({ ok: true, id, ...(await depsPayload(req, p)) });
  }
  router.post('/api/governance/ppm/project/:id/dependencies', requireReportSession, sw('ppm_structured_dependencies_enabled'), json, async (req, res) => { try { await saveDep(req, res, null); } catch (e) { fail(res, e); } });
  router.put('/api/governance/ppm/project/:id/dependencies/:depId', requireReportSession, sw('ppm_structured_dependencies_enabled'), json, async (req, res) => { try { const d = intOr404(res, req.params.depId); if (d == null) return; await saveDep(req, res, d); } catch (e) { fail(res, e); } });
  router.delete('/api/governance/ppm/project/:id/dependencies/:depId', requireReportSession, sw('ppm_structured_dependencies_enabled'), async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return; const d = intOr404(res, req.params.depId); if (d == null) return;
      const ex = await p2().dependency(d); if (!ex || ex.project_id !== Number(p.id)) return notFound(res);
      if (await writeGate(req, res, p)) return;
      await p2().deleteDependency(d, { user: req.reportUser }); log(req, 'ppm_dependency_removed', `project:${p.id}`, { dependency: d });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/ppm/portfolio/dependencies', requireReportSession, sw('ppm_structured_dependencies_enabled'), async (req, res) => {
    try {
      const projects = await readable(req);
      const pv = SD.portfolioView(projects, await p2().listDependencies(projects.map((x) => x.id)), { today: today() });
      const readableIds = new Set(projects.map((x) => Number(x.id)));
      // a loop through a project this reader cannot see is reported as "a loop exists", never with that project's id
      const loops = SD.findCycles(await p2().allEdges()).map((c) => (c.every((x) => readableIds.has(x)) ? { projects: c } : { projects: c.filter((x) => readableIds.has(x)), partial: true })).filter((c) => c.projects.length);
      res.json({ ok: true, items: pv.items, edges: pv.edges, cycles: loops, flagged: pv.flagged, by_code: pv.by_code, as_of: new Date().toISOString() });
    } catch (e) { fail(res, e); }
  });

  // ---- §13 risk exposure ---------------------------------------------------------------------------------------------
  router.get('/api/governance/ppm/project/:id/risk-exposure', requireReportSession, sw('ppm_structured_dependencies_enabled'), async (req, res) => {
    try { const p = await project(req, res); if (!p) return; res.json({ ok: true, ...RX.rollup(await p2().listRisks([p.id]), { today: today() }), levels: RX.LEVELS, mapping: RX.MAPPING }); } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/project/:id/risks/:riskId/residual', requireReportSession, sw('ppm_structured_dependencies_enabled'), json, async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return; const rid = intOr404(res, req.params.riskId); if (rid == null) return;
      const ex = await p2().riskEntry(rid); if (!ex || ex.project_id !== Number(p.id)) return notFound(res);
      if (await refusePlanWrite(req, res, 'risk', { id: rid, body: { project_id: p.id } })) return;
      await p2().saveResidual(rid, req.body || {}, { user: req.reportUser }); log(req, 'ppm_risk_residual_set', `project:${p.id}`, { risk: rid });
      res.json({ ok: true, ...RX.rollup(await p2().listRisks([p.id]), { today: today() }) });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/ppm/portfolio/risk-exposure', requireReportSession, sw('ppm_structured_dependencies_enabled'), async (req, res) => {
    try { const projects = await readable(req); res.json({ ok: true, ...RX.portfolio(projects, await p2().listRisks(projects.map((x) => x.id)), { today: today() }), as_of: new Date().toISOString() }); } catch (e) { fail(res, e); }
  });

  // ---- §17 demand + capacity -------------------------------------------------------------------------------------------
  router.get('/api/governance/ppm/project/:id/demand', requireReportSession, sw('ppm_resource_demand_enabled'), async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return;
      const lines = await p2().listDemand([p.id]); const cap = RD.parseCapacity(req.__p2cfg.ppm_capacity_fte);
      const load = RD.monthlyLoad(lines.map((l) => ({ ...l })), { capacity: cap.map });
      // P11 r6 (PPM R6-1) — capacity is GROUP-wide: one project's demand in a skill × month that other projects also
      // demand is a partial of the group cell, so it gets no colour against that capacity (rag NA, utilisation null),
      // never a GREEN while the group cell is RED. The group lines are read server-side only (no other project's figure
      // is returned); a cell this project alone demands keeps its verdict.
      const others = (await p2().demandProjectIds()).filter((id) => id !== Number(p.id));
      // P11 r7 (PPM R7-2) — whether another project shares a cell is told ONLY to a reader who can read every project
      // carrying demand (portfolio-wide read). Anyone else gets no per-cell sharing flag and no colour except a certain
      // RED, plus a neutral response-level view_partial (as /portfolio/capacity does) — never which month or skill an
      // unreadable project demands, never its name or figure.
      const seen = new Set((await readable(req)).map((x) => Number(x.id)));
      const fullRead = others.every((id) => seen.has(id));
      // P11 r7 (PPM R7-1) — this project's OWN known demand already above capacity is a certain RED (the others can only
      // add to it, as resourceDemand.monthlyLoad treats unknown lines): it keeps its colour and counts in load.over.
      const certainRed = (c) => c.rag === 'RED';
      let shared = 0;
      if (others.length && load.cells.length && fullRead) {
        const group = RD.monthlyLoad(await p2().listDemand(others), { capacity: {} });
        const busy = new Set(group.cells.map((c) => c.skill + '|' + c.month));
        for (const c of load.cells) {
          c.shared_with_other_projects = busy.has(c.skill + '|' + c.month);
          if (c.shared_with_other_projects) { shared += 1; if (certainRed(c)) c.own_demand_over_capacity = true; else { c.rag = 'NA'; c.utilisation_pct = null; } }
        }
      } else if (others.length && load.cells.length) {
        for (const c of load.cells) { if (certainRed(c)) c.own_demand_over_capacity = true; else { c.rag = 'NA'; c.utilisation_pct = null; } }
        shared = load.cells.length;
      } else if (fullRead) { for (const c of load.cells) c.shared_with_other_projects = false; }
      load.over = load.cells.filter((c) => c.rag === 'RED').length;
      const note = fullRead
        ? 'other projects also demand these skills in these months; capacity is group-wide, so those months get no colour here (except where this project alone is already over capacity) — see the portfolio capacity view'
        : 'partial view — capacity is group-wide and you cannot read every project carrying demand, so no capacity verdict is shown here except where this project alone is already over capacity';
      res.json({ ok: true, lines, load, capacity_configured: cap.configured, sourcing: RD.SOURCING,
        view_partial: shared > 0, ...(shared > 0 ? { view_partial_note: note } : {}) });
    } catch (e) { fail(res, e); }
  });
  async function saveDemand(req, res, lineId) {
    const p = await project(req, res); if (!p) return;
    if (lineId != null) { const ex = await p2().demandLine(lineId); if (!ex || ex.project_id !== Number(p.id)) return notFound(res); }
    if (await writeGate(req, res, p)) return;
    const id = await p2().saveDemand(p.id, req.body || {}, { user: req.reportUser, id: lineId });
    log(req, lineId != null ? 'ppm_demand_updated' : 'ppm_demand_added', `project:${p.id}`, { line: id });
    res.json({ ok: true, id, lines: await p2().listDemand([p.id]) });
  }
  router.post('/api/governance/ppm/project/:id/demand', requireReportSession, sw('ppm_resource_demand_enabled'), json, async (req, res) => { try { await saveDemand(req, res, null); } catch (e) { fail(res, e); } });
  router.put('/api/governance/ppm/project/:id/demand/:lineId', requireReportSession, sw('ppm_resource_demand_enabled'), json, async (req, res) => { try { const l = intOr404(res, req.params.lineId); if (l == null) return; await saveDemand(req, res, l); } catch (e) { fail(res, e); } });
  router.delete('/api/governance/ppm/project/:id/demand/:lineId', requireReportSession, sw('ppm_resource_demand_enabled'), async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return; const l = intOr404(res, req.params.lineId); if (l == null) return;
      const ex = await p2().demandLine(l); if (!ex || ex.project_id !== Number(p.id)) return notFound(res);
      if (await writeGate(req, res, p)) return;
      await p2().deleteDemand(l, { user: req.reportUser }); log(req, 'ppm_demand_removed', `project:${p.id}`, { line: l });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  // P11 R5-3 — ppm_capacity_fte is ONE group-wide capacity. A reader who cannot see every project carrying demand would
  // compare a partial demand with the whole group's capacity (a GREEN while the group is RED): their view gets no colour
  // (capacity unknown for that comparison) and says it is partial. The group figures stay with the readers who see it all.
  async function partialCapacity(projects, cap) {
    const seen = new Set(projects.map((x) => Number(x.id)));
    const partial = (await p2().demandProjectIds()).some((id) => !seen.has(id));
    // P11 r6 (PPM R6-4) — view_partial = the READER's scope misses demand (whole response); a cell's own `partial` keeps
    // its meaning "the cell sum is a lower bound: unknown_lines lines without an FTE" (services/ppm/resourceDemand.js).
    return partial ? { map: {}, flags: { view_partial: true, view_partial_note: 'partial view — capacity is group-wide, so no capacity verdict is shown on the projects you can read' } } : { map: cap.map, flags: { view_partial: false } };
  }
  router.get('/api/governance/ppm/portfolio/capacity', requireReportSession, sw('ppm_resource_demand_enabled'), async (req, res) => {
    try {
      const projects = await readable(req); const cap = RD.parseCapacity(req.__p2cfg.ppm_capacity_fte);
      const pc = await partialCapacity(projects, cap);
      res.json({ ok: true, ...RD.monthlyLoad(await p2().listDemand(projects.map((x) => x.id)), { capacity: pc.map }), capacity_configured: cap.configured, capacity_problems: cap.problems, ...pc.flags, as_of: new Date().toISOString() });
    } catch (e) { fail(res, e); }
  });

  // ---- §16.2 effort scoring ------------------------------------------------------------------------------------------
  router.get('/api/governance/ppm/project/:id/effort', requireReportSession, sw('ppm_effort_scoring_enabled'), async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return; const w = ES.parseWeights(req.__p2cfg.ppm_effort_weights); const e = await p2().effort(p.id);
      const declared = on(req.__p2cfg, 'ppm_intake_register_enabled') ? ((await readable(req)).find((x) => Number(x.id) === Number(p.id)) || {}).delivery_effort || null : null;
      res.json({ ok: true, factors: e ? e.factors : Object.fromEntries(ES.FACTORS.map((f) => [f, null])), updated_by_name: e ? e.updated_by_name : null, updated_at: e ? e.updated_at : null, ...ES.score(e ? e.factors : {}, { weights: w.weights, declared }), weights: w.weights, weights_status: w.status, weights_problems: w.problems, factor_keys: ES.FACTORS, bands: ES.BANDS.map((b) => ({ band: b.band, below: Number.isFinite(b.max) ? b.max : null })) });
    } catch (e) { fail(res, e); }
  });
  router.put('/api/governance/ppm/project/:id/effort', requireReportSession, sw('ppm_effort_scoring_enabled'), json, async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return; if (await writeGate(req, res, p)) return;
      const f = await p2().saveEffort(p.id, req.body || {}, { user: req.reportUser }); log(req, 'ppm_effort_scored', `project:${p.id}`, {});
      res.json({ ok: true, factors: f, ...ES.score(f, { weights: ES.parseWeights(req.__p2cfg.ppm_effort_weights).weights }) });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/ppm/portfolio/effort', requireReportSession, sw('ppm_effort_scoring_enabled'), async (req, res) => {
    try {
      const projects = await readable(req); const w = ES.parseWeights(req.__p2cfg.ppm_effort_weights); const f = await p2().effortMany(projects.map((x) => x.id));
      const intake = on(req.__p2cfg, 'ppm_intake_register_enabled');
      res.json({ ok: true, rows: projects.map((x) => ({ project_id: Number(x.id), key: x.key, name: x.name, ...ES.score(f[Number(x.id)] || {}, { weights: w.weights, declared: intake ? x.delivery_effort || null : null }) })), weights_status: w.status });
    } catch (e) { fail(res, e); }
  });

  // ---- §29 documents -------------------------------------------------------------------------------------------------
  router.get('/api/governance/ppm/project/:id/documents', requireReportSession, sw('ppm_documents_enabled'), async (req, res) => {
    try { const p = await project(req, res); if (!p) return; const m = money(req.reportUser); res.json({ ok: true, documents: PD.latestFirst(await p2().listDocuments(p.id)).map((r) => ({ ...PD.view(r, { money: m }), latest: r.latest })), types: PD.DOC_TYPES, money_types: PD.MONEY_TYPES, max_bytes: PD.MAX_BYTES, mimes: Object.keys(PD.MIMES) }); } catch (e) { fail(res, e); }
  });
  router.post('/api/governance/ppm/project/:id/documents', requireReportSession, sw('ppm_documents_enabled'), rawDoc, async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return; if (await writeGate(req, res, p)) return;
      const doc_type = String((req.query && req.query.doc_type) || '');
      if (PD.isMoneyType(doc_type) && !money(req.reportUser)) return httpFail(res, Object.assign(new Error('a document carrying amounts is added by an amount reader'), { reason: 'MONEY_SCOPE' }), 403, { ok: false, code: 'MONEY_SCOPE' });
      const row = await p2().addDocument(p.id, { doc_type, title: req.query && req.query.title, mime: req.get('content-type'), buf: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0) }, { user: req.reportUser });
      log(req, 'ppm_document_added', `project:${p.id}`, { document: row.id, doc_type: row.doc_type, version: row.version });
      res.json({ ok: true, document: PD.view(row, { money: money(req.reportUser) }) });
    } catch (e) { fail(res, e); }
  });
  router.get('/api/governance/ppm/project/:id/documents/:docId/download', requireReportSession, sw('ppm_documents_enabled'), xpGate('governance.project_documents'), async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return; const d = intOr404(res, req.params.docId); if (d == null) return;
      const row = await p2().documentRow(d); if (!row || row.project_id !== Number(p.id)) return notFound(res);
      const xp = req.exportPolicy; const amountReader = (xp && typeof xp.money === 'boolean' ? xp.money : !!canSeeMoney(req.reportUser)) && !req.reportUser.__ppmClient;   // the export policy's amount rule (one source)
      if (PD.isMoneyType(row.doc_type) && !amountReader) return httpFail(res, Object.assign(new Error('this document carries amounts'), { reason: 'MONEY_SCOPE' }), 403, { ok: false, code: 'MONEY_SCOPE' });
      const buf = p2().readDocument(row); if (!buf) return notFound(res);
      log(req, 'ppm_document_downloaded', `project:${p.id}`, { document: row.id });
      res.setHeader('Content-Type', row.mime); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="${PD.downloadName(row)}"`);
      res.send(buf);
    } catch (e) { fail(res, e); }
  });
  router.delete('/api/governance/ppm/project/:id/documents/:docId', requireReportSession, sw('ppm_documents_enabled'), async (req, res) => {
    try {
      const p = await project(req, res); if (!p) return; const d = intOr404(res, req.params.docId); if (d == null) return;
      const row = await p2().documentRow(d); if (!row || row.project_id !== Number(p.id)) return notFound(res);
      if (await writeGate(req, res, p)) return;
      await p2().deleteDocument(d, { user: req.reportUser }); log(req, 'ppm_document_removed', `project:${p.id}`, { document: d });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // ---- §33 portfolio scenario (read-only) -------------------------------------------------------------------------------
  router.post('/api/governance/ppm/portfolio/scenario', requireReportSession, sw('ppm_scenarios_enabled'), json, async (req, res) => {
    try {
      const projects = await readable(req); const pids = projects.map((x) => Number(x.id));
      const scenario = SC.normalise(req.body, pids); const cap = RD.parseCapacity(req.__p2cfg.ppm_capacity_fte);
      const pv = SD.portfolioView(projects, await p2().listDependencies(pids), { today: today() });
      const pc = await partialCapacity(projects, cap);
      res.json({ ok: true, ...SC.simulate({ projects, lines: await p2().listDemand(pids), edges: pv.edges, capacity: pc.map, scenario }), capacity_configured: cap.configured, ...pc.flags });
    } catch (e) { fail(res, e); }
  });
};
